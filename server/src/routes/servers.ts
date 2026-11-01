import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import { DEFAULT_EVERYONE_PERMISSIONS, has, P } from '@shared/permissions';
import type { Bootstrap, DiscoverServer, ReadState, Relationship, RelationshipType } from '@shared/types';
import type { AppContext } from '../context';
import {
  bans,
  channels,
  members,
  readStates,
  relationships,
  roles,
  servers,
  users,
} from '../db/schema';
import { requirePerm, requireServerAccess } from '../lib/access';
import { audit } from '../lib/audit';
import { memberDto, memberDtos, serverBundle } from '../lib/bundles';
import { dmChannelsFor } from '../lib/dms';
import { badRequest, forbidden, intParam, notFound, parse } from '../lib/errors';
import { createMessage } from '../lib/messages';
import { publicUser, selfUser, serverDto } from '../lib/serialize';

type Template = 'default' | 'gaming' | 'friends';

const TEMPLATES: Record<'fa' | 'en', Record<Template, { category: string; channels: { name: string; type: 'text' | 'voice' }[] }[]>> = {
  fa: {
    default: [
      { category: 'کانال‌های متنی', channels: [{ name: 'عمومی', type: 'text' }] },
      { category: 'کانال‌های صوتی', channels: [{ name: 'عمومی', type: 'voice' }] },
    ],
    gaming: [
      {
        category: 'اطلاعات',
        channels: [
          { name: 'خوش‌آمدید', type: 'text' },
          { name: 'قوانین', type: 'text' },
        ],
      },
      {
        category: 'گفتگو',
        channels: [
          { name: 'عمومی', type: 'text' },
          { name: 'کلیپ-و-اسکرین‌شات', type: 'text' },
          { name: 'دنبال-هم‌تیمی', type: 'text' },
        ],
      },
      {
        category: 'صوتی',
        channels: [
          { name: 'لابی', type: 'voice' },
          { name: 'تیم ۱', type: 'voice' },
          { name: 'تیم ۲', type: 'voice' },
        ],
      },
    ],
    friends: [
      { category: 'گفتگو', channels: [{ name: 'عمومی', type: 'text' }, { name: 'بازی', type: 'text' }] },
      { category: 'صوتی', channels: [{ name: 'پاتوق', type: 'voice' }, { name: 'بازی', type: 'voice' }] },
    ],
  },
  en: {
    default: [
      { category: 'Text Channels', channels: [{ name: 'general', type: 'text' }] },
      { category: 'Voice Channels', channels: [{ name: 'General', type: 'voice' }] },
    ],
    gaming: [
      { category: 'Info', channels: [{ name: 'welcome', type: 'text' }, { name: 'rules', type: 'text' }] },
      {
        category: 'Chat',
        channels: [
          { name: 'general', type: 'text' },
          { name: 'clips-and-screenshots', type: 'text' },
          { name: 'looking-for-group', type: 'text' },
        ],
      },
      {
        category: 'Voice',
        channels: [
          { name: 'Lobby', type: 'voice' },
          { name: 'Squad 1', type: 'voice' },
          { name: 'Squad 2', type: 'voice' },
        ],
      },
    ],
    friends: [
      { category: 'Chat', channels: [{ name: 'general', type: 'text' }, { name: 'games', type: 'text' }] },
      { category: 'Voice', channels: [{ name: 'Hangout', type: 'voice' }, { name: 'Gaming', type: 'voice' }] },
    ],
  },
};

/** Add a member, post the welcome message and notify everyone. Used by invites and public joins. */
export async function addMember(ctx: AppContext, serverId: number, userId: number) {
  const { db } = ctx;
  const [banned] = await db
    .select()
    .from(bans)
    .where(and(eq(bans.serverId, serverId), eq(bans.userId, userId)));
  if (banned) throw forbidden('banned', 'You are banned from this server');
  const inserted = await db.insert(members).values({ serverId, userId }).onConflictDoNothing().returning();
  if (inserted.length === 0) return serverBundle(ctx, serverId, userId);
  ctx.gateway.addToServer(userId, serverId);
  const member = await memberDto(ctx, serverId, userId);
  ctx.gateway.toServer(serverId, 'member:add', member);
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId));
  if (server?.systemChannelId) {
    const [sys] = await db.select().from(channels).where(eq(channels.id, server.systemChannelId));
    if (sys) await createMessage(ctx, { channel: sys, authorId: userId, content: '', type: 'join' });
  }
  const bundle = await serverBundle(ctx, serverId, userId);
  ctx.gateway.toUser(userId, 'server:create', bundle);
  return bundle;
}

export default async function serverRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  app.get('/api/bootstrap', authed, async (req): Promise<Bootstrap> => {
    const me = req.user.id;
    const memberships = await db.select({ serverId: members.serverId }).from(members).where(eq(members.userId, me));
    const bundles = await Promise.all(memberships.map((m) => serverBundle(ctx, m.serverId, me)));
    const [dms, rels, reads] = await Promise.all([
      dmChannelsFor(ctx, me),
      db
        .select({ rel: relationships, user: users })
        .from(relationships)
        .innerJoin(users, eq(users.id, relationships.targetId))
        .where(eq(relationships.userId, me)),
      db.select().from(readStates).where(eq(readStates.userId, me)),
    ]);
    const voiceChannelIds = [
      ...bundles.flatMap((b) => b.channels.filter((c) => c.type === 'voice').map((c) => c.id)),
      ...dms.map((d) => d.id),
    ];
    return {
      user: selfUser(req.user, ctx.presence),
      servers: bundles.sort((a, b) => a.member.joinedAt.localeCompare(b.member.joinedAt)),
      dms,
      relationships: rels.map(
        (r): Relationship => ({ type: r.rel.type as RelationshipType, user: publicUser(r.user, ctx.presence) }),
      ),
      readStates: reads.map((r): ReadState => ({ channelId: r.channelId, lastReadId: r.lastReadId, mentionCount: r.mentionCount })),
      voiceStates: ctx.gateway.voice.participantsIn(voiceChannelIds),
      config: { iceServers: ctx.config.iceServers, maxUploadMB: ctx.config.maxUploadMB },
    };
  });

  app.post('/api/servers', authed, async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(LIMITS.serverNameMax),
        template: z.enum(['default', 'gaming', 'friends']).default('gaming'),
      }),
      req.body,
    );
    const locale = req.user.locale === 'en' ? 'en' : 'fa';
    const serverId = await db.transaction(async (tx) => {
      const [server] = await tx.insert(servers).values({ name: body.name, ownerId: req.user.id }).returning();
      await tx.insert(roles).values({
        serverId: server.id,
        name: '@everyone',
        position: 0,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        isDefault: true,
      });
      await tx.insert(members).values({ serverId: server.id, userId: req.user.id });
      let systemChannelId: number | null = null;
      let position = 0;
      for (const group of TEMPLATES[locale][body.template]) {
        const [category] = await tx
          .insert(channels)
          .values({ serverId: server.id, type: 'category', name: group.category, position: position++ })
          .returning();
        let childPos = 0;
        for (const ch of group.channels) {
          const [row] = await tx
            .insert(channels)
            .values({ serverId: server.id, type: ch.type, name: ch.name, parentId: category.id, position: childPos++ })
            .returning();
          const generalName = locale === 'fa' ? 'عمومی' : 'general';
          if (ch.type === 'text' && (systemChannelId === null || ch.name === generalName)) {
            if (systemChannelId === null || ch.name === generalName) systemChannelId = row.id;
          }
        }
      }
      await tx.update(servers).set({ systemChannelId }).where(eq(servers.id, server.id));
      return server.id;
    });
    ctx.gateway.addToServer(req.user.id, serverId);
    const bundle = await serverBundle(ctx, serverId, req.user.id);
    ctx.gateway.toUser(req.user.id, 'server:create', bundle);
    return bundle;
  });

  app.get('/api/servers/:id', authed, async (req) => {
    return serverBundle(ctx, intParam((req.params as { id: string }).id), req.user.id);
  });

  app.get('/api/servers/:id/members', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    await requireServerAccess(db, serverId, req.user.id);
    return memberDtos(ctx, serverId);
  });

  app.patch('/api/servers/:id', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(LIMITS.serverNameMax).optional(),
        description: z.string().trim().max(LIMITS.serverDescriptionMax).optional(),
        isPublic: z.boolean().optional(),
        systemChannelId: z.number().int().positive().nullable().optional(),
        ownerId: z.number().int().positive().optional(),
      }),
      req.body,
    );
    if (body.ownerId !== undefined && body.ownerId !== access.server.ownerId) {
      if (!access.isOwner) throw forbidden('not_owner');
      const [target] = await db
        .select()
        .from(members)
        .where(and(eq(members.serverId, serverId), eq(members.userId, body.ownerId)));
      if (!target) throw badRequest('unknown_member');
      await audit(db, {
        serverId,
        actorId: req.user.id,
        action: 'ownership_transfer',
        targetId: body.ownerId,
        targetType: 'user',
      });
    } else {
      requirePerm(access.perms, P.MANAGE_SERVER);
    }
    if (body.systemChannelId) {
      const [ch] = await db
        .select()
        .from(channels)
        .where(and(eq(channels.id, body.systemChannelId), eq(channels.serverId, serverId)));
      if (!ch || ch.type !== 'text') throw badRequest('invalid_channel');
    }
    const [server] = await db.update(servers).set(body).where(eq(servers.id, serverId)).returning();
    const changed = Object.keys(body).filter((k) => k !== 'ownerId');
    if (changed.length) {
      await audit(db, { serverId, actorId: req.user.id, action: 'server_update', details: { changed } });
    }
    ctx.gateway.toServer(serverId, 'server:update', serverDto(server));
    if (body.ownerId !== undefined) ctx.gateway.toServer(serverId, 'server:refresh', { id: serverId });
    return serverDto(server);
  });

  app.put('/api/servers/:id/icon', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_SERVER);
    const file = await req.file({ limits: { fileSize: LIMITS.imageMaxBytes + 1 } });
    if (!file) throw badRequest('missing_file');
    const stored = await ctx.uploads.saveImage(await file.toBuffer(), 'icon', LIMITS.imageMaxBytes);
    await ctx.uploads.remove(access.server.icon);
    const [server] = await db.update(servers).set({ icon: stored.url }).where(eq(servers.id, serverId)).returning();
    await audit(db, { serverId, actorId: req.user.id, action: 'server_update', details: { changed: ['icon'] } });
    ctx.gateway.toServer(serverId, 'server:update', serverDto(server));
    return serverDto(server);
  });

  app.delete('/api/servers/:id/icon', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_SERVER);
    await ctx.uploads.remove(access.server.icon);
    const [server] = await db.update(servers).set({ icon: null }).where(eq(servers.id, serverId)).returning();
    ctx.gateway.toServer(serverId, 'server:update', serverDto(server));
    return serverDto(server);
  });

  app.delete('/api/servers/:id', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    if (!access.isOwner) throw forbidden('not_owner');
    const voiceChannels = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.serverId, serverId), eq(channels.type, 'voice')));
    for (const c of voiceChannels) await ctx.gateway.voice.closeChannel(c.id);
    ctx.gateway.toServer(serverId, 'server:delete', { id: serverId });
    ctx.gateway.io.socketsLeave(`server:${serverId}`);
    await ctx.uploads.remove(access.server.icon);
    await db.delete(servers).where(eq(servers.id, serverId));
    return { ok: true };
  });

  // Mark every channel in a server as read.
  app.post('/api/servers/:id/ack', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    await requireServerAccess(db, serverId, req.user.id);
    const chans = await db
      .select({ id: channels.id, last: channels.lastMessageId })
      .from(channels)
      .where(and(eq(channels.serverId, serverId), sql`${channels.lastMessageId} is not null`));
    if (chans.length) {
      await db
        .insert(readStates)
        .values(chans.map((c) => ({ userId: req.user.id, channelId: c.id, lastReadId: c.last!, mentionCount: 0 })))
        .onConflictDoUpdate({
          target: [readStates.userId, readStates.channelId],
          set: { lastReadId: sql`excluded.last_read_id`, mentionCount: 0 },
        });
      ctx.gateway.toUser(
        req.user.id,
        'readstate:bulk',
        chans.map((c) => ({ channelId: c.id, lastReadId: c.last!, mentionCount: 0 })),
      );
    }
    return { ok: true };
  });

  app.patch('/api/servers/:id/settings', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    await requireServerAccess(db, serverId, req.user.id);
    const body = parse(
      z.object({ notifyLevel: z.enum(['all', 'mentions', 'none']).optional(), muted: z.boolean().optional() }),
      req.body,
    );
    const [m] = await db
      .update(members)
      .set(body)
      .where(and(eq(members.serverId, serverId), eq(members.userId, req.user.id)))
      .returning();
    const settings = { serverId, notifyLevel: m.notifyLevel, muted: m.muted };
    ctx.gateway.toUser(req.user.id, 'settings:update', settings);
    return settings;
  });

  // ---------- discovery ----------

  app.get('/api/discover', authed, async (req): Promise<DiscoverServer[]> => {
    const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await db
      .select({ server: servers, memberCount: count(members.userId) })
      .from(servers)
      .leftJoin(members, eq(members.serverId, servers.id))
      .where(
        pattern
          ? and(eq(servers.isPublic, true), or(ilike(servers.name, pattern), ilike(servers.description, pattern)))
          : eq(servers.isPublic, true),
      )
      .groupBy(servers.id)
      .orderBy(desc(count(members.userId)))
      .limit(50);
    const ids = rows.map((r) => r.server.id);
    const memberRows = ids.length
      ? await db.select({ serverId: members.serverId, userId: members.userId }).from(members).where(inArray(members.serverId, ids))
      : [];
    return rows.map(({ server, memberCount }) => {
      const userIds = memberRows.filter((m) => m.serverId === server.id).map((m) => m.userId);
      return {
        id: server.id,
        name: server.name,
        icon: server.icon,
        description: server.description,
        memberCount,
        onlineCount: ctx.presence.onlineCount(userIds),
        joined: userIds.includes(req.user.id),
      };
    });
  });

  app.post('/api/discover/:id/join', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId));
    if (!server || !server.isPublic) throw notFound('unknown_server');
    return addMember(ctx, serverId, req.user.id);
  });

  // Leave a server.
  app.delete('/api/servers/:id/members/@me', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    if (access.isOwner) throw badRequest('owner_cannot_leave', 'Transfer ownership or delete the server first');
    await ctx.gateway.voice.kick(req.user.id, serverId);
    await db.delete(members).where(and(eq(members.serverId, serverId), eq(members.userId, req.user.id)));
    ctx.gateway.removeFromServer(req.user.id, serverId);
    ctx.gateway.toUser(req.user.id, 'server:delete', { id: serverId });
    ctx.gateway.toServer(serverId, 'member:remove', { serverId, userId: req.user.id });
    return { ok: true };
  });

  // Used by the member list to know who can see what (cheap check for clients).
  app.get('/api/servers/:id/permissions', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    return { permissions: access.perms, admin: has(access.perms, P.ADMINISTRATOR) };
  });
}
