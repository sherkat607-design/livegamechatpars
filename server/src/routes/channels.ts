import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import { CHANNEL_PERMISSIONS, has, P } from '@shared/permissions';
import type { AppContext } from '../context';
import { channels, messages, overwrites, readStates, roles, servers, type ChannelRow } from '../db/schema';
import {
  channelPermsFrom,
  filterViewers,
  loadChannelAccess,
  overwritesFor,
  requirePerm,
  requireServerAccess,
  type ServerAccess,
} from '../lib/access';
import { audit } from '../lib/audit';
import { refreshServer } from '../lib/bundles';
import { badRequest, forbidden, intParam, notFound, parse } from '../lib/errors';
import { createMessage } from '../lib/messages';
import { channelDto } from '../lib/serialize';

/** Discord-style text channel names: lowercase, dashes instead of spaces. Keeps Persian letters. */
export function normalizeChannelName(name: string, type: string): string {
  const trimmed = name.trim().slice(0, LIMITS.channelNameMax);
  if (type !== 'text' && type !== 'announcement') return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\p{M}_‌-]/gu, '')
    .replace(/-+/g, '-')
    .slice(0, LIMITS.channelNameMax);
}

const permBits = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31 - 1);

export default async function channelRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  /** Send a channel object to members who can see it and a removal to those who cannot. */
  async function publishChannel(channel: ChannelRow, event: 'channel:create' | 'channel:update') {
    if (!channel.serverId) return;
    const ows = await overwritesFor(db, [channel.type === 'thread' && channel.parentId ? channel.parentId : channel.id, channel.id]);
    const dto = channelDto(channel, ows);
    const online = await ctx.gateway.onlineUserIds(`server:${channel.serverId}`);
    if (channel.type === 'category') {
      ctx.gateway.toUser(online, event, dto);
      return;
    }
    const viewers = await filterViewers(db, channel, online);
    ctx.gateway.toUser(viewers, event, dto);
    const hidden = online.filter((id) => !viewers.includes(id));
    if (event === 'channel:update' && hidden.length) {
      ctx.gateway.toUser(hidden, 'channel:delete', { id: channel.id, serverId: channel.serverId });
    }
  }

  async function serverChannel(channelId: number, userId: number): Promise<{ channel: ChannelRow; access: ServerAccess; perms: number }> {
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel || !channel.serverId) throw notFound('unknown_channel');
    const access = await requireServerAccess(db, channel.serverId, userId);
    let parent: ChannelRow | null = null;
    if (channel.type === 'thread' && channel.parentId) {
      [parent] = await db.select().from(channels).where(eq(channels.id, channel.parentId));
    }
    const ows = await overwritesFor(db, [parent?.id ?? channel.id]);
    const perms = channel.type === 'category' ? computeCategoryPerms(access, channel, ows) : channelPermsFrom(access, channel, parent ?? null, ows);
    if (!has(perms, P.VIEW_CHANNEL) && channel.type !== 'category') throw notFound('unknown_channel');
    return { channel, access, perms };
  }

  function computeCategoryPerms(access: ServerAccess, channel: ChannelRow, ows: Awaited<ReturnType<typeof overwritesFor>>) {
    const p = channelPermsFrom(access, channel, null, ows);
    // Managing a category only needs server-level Manage Channels.
    return p | (access.perms & P.MANAGE_CHANNELS);
  }

  app.post('/api/servers/:id/channels', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_CHANNELS);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(LIMITS.channelNameMax),
        type: z.enum(['text', 'voice', 'category', 'announcement']),
        parentId: z.number().int().positive().nullable().optional(),
        topic: z.string().max(LIMITS.topicMax).optional(),
        private: z.boolean().optional(),
        allowedRoleIds: z.array(z.number().int().positive()).max(50).optional(),
      }),
      req.body,
    );
    const name = normalizeChannelName(body.name, body.type);
    if (!name) throw badRequest('invalid_name');
    let parentId: number | null = null;
    if (body.parentId && body.type !== 'category') {
      const [parent] = await db
        .select()
        .from(channels)
        .where(and(eq(channels.id, body.parentId), eq(channels.serverId, serverId)));
      if (!parent || parent.type !== 'category') throw badRequest('invalid_parent');
      parentId = parent.id;
    }
    const [{ max }] = await db
      .select({ max: sql<number>`coalesce(max(${channels.position}), -1)` })
      .from(channels)
      .where(
        and(
          eq(channels.serverId, serverId),
          parentId ? eq(channels.parentId, parentId) : sql`${channels.parentId} is null`,
        ),
      );
    const [channel] = await db
      .insert(channels)
      .values({ serverId, type: body.type, name, parentId, topic: body.topic ?? '', position: Number(max) + 1 })
      .returning();
    if (body.private) {
      const everyone = access.roles.find((r) => r.isDefault)!;
      const rows = [
        { channelId: channel.id, targetType: 'role', targetId: everyone.id, allow: 0, deny: P.VIEW_CHANNEL },
        { channelId: channel.id, targetType: 'member', targetId: req.user.id, allow: P.VIEW_CHANNEL, deny: 0 },
        ...(body.allowedRoleIds ?? [])
          .filter((id) => access.roles.some((r) => r.id === id && !r.isDefault))
          .map((id) => ({ channelId: channel.id, targetType: 'role', targetId: id, allow: P.VIEW_CHANNEL, deny: 0 })),
      ];
      await db.insert(overwrites).values(rows);
    }
    await audit(db, {
      serverId,
      actorId: req.user.id,
      action: 'channel_create',
      targetId: channel.id,
      targetType: 'channel',
      details: { name, type: body.type },
    });
    await publishChannel(channel, 'channel:create');
    return channelDto(channel, await overwritesFor(db, [channel.id]));
  });

  app.patch('/api/channels/:id', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const { channel, perms } = await serverChannel(channelId, req.user.id);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(LIMITS.channelNameMax).optional(),
        topic: z.string().max(LIMITS.topicMax).optional(),
        slowmode: z.number().int().min(0).max(LIMITS.slowmodeMax).optional(),
        parentId: z.number().int().positive().nullable().optional(),
        archived: z.boolean().optional(),
        type: z.enum(['text', 'announcement']).optional(),
      }),
      req.body,
    );
    const isThreadOwner = channel.type === 'thread' && channel.ownerId === req.user.id;
    if (!has(perms, P.MANAGE_CHANNELS) && !isThreadOwner) throw forbidden('missing_permissions');
    const patch: Partial<ChannelRow> = {};
    if (body.name !== undefined) patch.name = normalizeChannelName(body.name, channel.type === 'thread' ? 'thread' : channel.type);
    if (body.topic !== undefined && channel.type !== 'category') patch.topic = body.topic;
    if (body.slowmode !== undefined && channel.type !== 'category' && channel.type !== 'voice') patch.slowmode = body.slowmode;
    if (body.archived !== undefined && channel.type === 'thread') patch.archived = body.archived;
    if (body.type !== undefined && (channel.type === 'text' || channel.type === 'announcement')) patch.type = body.type;
    if (body.parentId !== undefined && channel.type !== 'category' && channel.type !== 'thread') {
      if (body.parentId === null) patch.parentId = null;
      else {
        const [parent] = await db
          .select()
          .from(channels)
          .where(and(eq(channels.id, body.parentId), eq(channels.serverId, channel.serverId!)));
        if (!parent || parent.type !== 'category') throw badRequest('invalid_parent');
        patch.parentId = parent.id;
      }
    }
    if (Object.keys(patch).length === 0) return channelDto(channel, await overwritesFor(db, [channel.id]));
    const [updated] = await db.update(channels).set(patch).where(eq(channels.id, channelId)).returning();
    await audit(db, {
      serverId: channel.serverId!,
      actorId: req.user.id,
      action: channel.type === 'thread' ? 'thread_update' : 'channel_update',
      targetId: channelId,
      targetType: 'channel',
      details: { changed: Object.keys(patch) },
    });
    if (updated.type === 'thread' && updated.archived && !channel.archived) {
      // Archived threads disappear from sidebars but stay readable from the thread list.
      await ctx.gateway.toChannel(updated, 'channel:update', channelDto(updated));
    } else {
      await publishChannel(updated, 'channel:update');
    }
    if (patch.parentId !== undefined) await refreshServer(ctx, updated.serverId!);
    return channelDto(updated, await overwritesFor(db, [updated.id]));
  });

  app.delete('/api/channels/:id', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const { channel, perms, access } = await serverChannel(channelId, req.user.id);
    const isThreadOwner = channel.type === 'thread' && channel.ownerId === req.user.id;
    if (!has(perms, P.MANAGE_CHANNELS) && !isThreadOwner) throw forbidden('missing_permissions');
    const serverId = channel.serverId!;
    if (channel.type === 'voice') await ctx.gateway.voice.closeChannel(channelId);
    await db.transaction(async (tx) => {
      if (channel.type === 'category') {
        await tx.update(channels).set({ parentId: null }).where(eq(channels.parentId, channelId));
      } else if (channel.type !== 'thread') {
        await tx.delete(channels).where(and(eq(channels.parentId, channelId), eq(channels.type, 'thread')));
      } else if (channel.starterMessageId) {
        await tx.update(messages).set({ threadId: null }).where(eq(messages.id, channel.starterMessageId));
      }
      if (access.server.systemChannelId === channelId) {
        await tx.update(servers).set({ systemChannelId: null }).where(eq(servers.id, serverId));
      }
      await tx.delete(channels).where(eq(channels.id, channelId));
    });
    await audit(db, {
      serverId,
      actorId: req.user.id,
      action: 'channel_delete',
      targetId: channelId,
      targetType: 'channel',
      details: { name: channel.name, type: channel.type },
    });
    ctx.gateway.toServer(serverId, 'channel:delete', { id: channelId, serverId });
    if (channel.type === 'category') await refreshServer(ctx, serverId);
    return { ok: true };
  });

  // Drag-and-drop ordering: [{ id, position, parentId }]
  app.put('/api/servers/:id/channels/order', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_CHANNELS);
    const body = parse(
      z
        .array(
          z.object({
            id: z.number().int().positive(),
            position: z.number().int().min(0).max(10000),
            parentId: z.number().int().positive().nullable().optional(),
          }),
        )
        .max(500),
      req.body,
    );
    const rows = await db.select().from(channels).where(eq(channels.serverId, serverId));
    const byId = new Map(rows.map((c) => [c.id, c]));
    await db.transaction(async (tx) => {
      for (const item of body) {
        const ch = byId.get(item.id);
        if (!ch || ch.type === 'thread') continue;
        const patch: Partial<ChannelRow> = { position: item.position };
        if (item.parentId !== undefined && ch.type !== 'category') {
          const parent = item.parentId === null ? null : byId.get(item.parentId);
          if (item.parentId !== null && (!parent || parent.type !== 'category')) continue;
          patch.parentId = item.parentId;
        }
        await tx.update(channels).set(patch).where(eq(channels.id, item.id));
      }
    });
    await refreshServer(ctx, serverId);
    return { ok: true };
  });

  // Permission overwrites ("channel permissions").
  app.put('/api/channels/:id/overwrites/:type/:targetId', authed, async (req) => {
    const params = req.params as { id: string; type: string; targetId: string };
    const channelId = intParam(params.id);
    const targetType = params.type === 'role' ? 'role' : params.type === 'member' ? 'member' : null;
    if (!targetType) throw badRequest('invalid_target');
    const targetId = intParam(params.targetId);
    const { channel, perms, access } = await serverChannel(channelId, req.user.id);
    if (channel.type === 'thread') throw badRequest('threads_use_parent_permissions');
    if (!has(perms, P.MANAGE_ROLES) && !has(access.perms, P.MANAGE_ROLES)) throw forbidden('missing_permissions');
    const body = parse(z.object({ allow: permBits, deny: permBits }), req.body);
    const allow = body.allow & CHANNEL_PERMISSIONS;
    const deny = body.deny & CHANNEL_PERMISSIONS & ~allow;
    // You can only grant or take away what you have yourself.
    if (!access.isOwner && !has(access.perms, P.ADMINISTRATOR) && ((allow | deny) & ~perms) !== 0) {
      throw forbidden('cannot_grant_permissions_you_lack');
    }
    if (targetType === 'role') {
      const [role] = await db
        .select()
        .from(roles)
        .where(and(eq(roles.id, targetId), eq(roles.serverId, channel.serverId!)));
      if (!role) throw badRequest('unknown_role');
    }
    await db
      .insert(overwrites)
      .values({ channelId, targetType, targetId, allow, deny })
      .onConflictDoUpdate({ target: [overwrites.channelId, overwrites.targetType, overwrites.targetId], set: { allow, deny } });
    await audit(db, {
      serverId: channel.serverId!,
      actorId: req.user.id,
      action: 'overwrite_update',
      targetId: channelId,
      targetType: 'channel',
      details: { targetType, targetId, allow, deny },
    });
    await refreshServer(ctx, channel.serverId!);
    return channelDto(channel, await overwritesFor(db, [channelId]));
  });

  app.delete('/api/channels/:id/overwrites/:type/:targetId', authed, async (req) => {
    const params = req.params as { id: string; type: string; targetId: string };
    const channelId = intParam(params.id);
    const targetId = intParam(params.targetId);
    const { channel, perms, access } = await serverChannel(channelId, req.user.id);
    if (!has(perms, P.MANAGE_ROLES) && !has(access.perms, P.MANAGE_ROLES)) throw forbidden('missing_permissions');
    await db
      .delete(overwrites)
      .where(and(eq(overwrites.channelId, channelId), eq(overwrites.targetType, params.type), eq(overwrites.targetId, targetId)));
    await audit(db, {
      serverId: channel.serverId!,
      actorId: req.user.id,
      action: 'overwrite_delete',
      targetId: channelId,
      targetType: 'channel',
      details: { targetType: params.type, targetId },
    });
    await refreshServer(ctx, channel.serverId!);
    return channelDto(channel, await overwritesFor(db, [channelId]));
  });

  // ---------- threads ----------

  app.post('/api/channels/:id/threads', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const access = await loadChannelAccess(db, channelId, req.user.id);
    const parent = access.channel;
    if (parent.type !== 'text' && parent.type !== 'announcement') throw badRequest('threads_not_supported');
    requirePerm(access.perms, P.CREATE_THREADS);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(LIMITS.channelNameMax), messageId: z.number().int().positive().optional() }),
      req.body,
    );
    let starter = null;
    if (body.messageId) {
      [starter] = await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, body.messageId), eq(messages.channelId, channelId)));
      if (!starter) throw badRequest('unknown_message');
      if (starter.threadId) throw badRequest('thread_exists');
    }
    const [thread] = await db
      .insert(channels)
      .values({
        serverId: parent.serverId,
        type: 'thread',
        name: body.name,
        parentId: parent.id,
        ownerId: req.user.id,
        starterMessageId: starter?.id ?? null,
      })
      .returning();
    await ctx.gateway.toChannel(thread, 'channel:create', channelDto(thread));
    if (starter) {
      await db.update(messages).set({ threadId: thread.id }).where(eq(messages.id, starter.id));
      ctx.gateway.toChannel(parent, 'message:thread', { messageId: starter.id, channelId: parent.id, thread: { id: thread.id, name: thread.name } });
    } else {
      await createMessage(ctx, { channel: parent, authorId: req.user.id, type: 'thread_created', content: `${thread.id}` });
    }
    return channelDto(thread);
  });

  app.get('/api/channels/:id/threads', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    await loadChannelAccess(db, channelId, req.user.id);
    const rows = await db
      .select()
      .from(channels)
      .where(and(eq(channels.parentId, channelId), eq(channels.type, 'thread')))
      .orderBy(desc(sql`coalesce(${channels.lastMessageId}, 0)`), desc(channels.id))
      .limit(100);
    return rows.map((r) => channelDto(r));
  });

  // ---------- read state ----------

  app.post('/api/channels/:id/ack', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const access = await loadChannelAccess(db, channelId, req.user.id);
    const { messageId } = parse(z.object({ messageId: z.number().int().min(0).optional() }), req.body ?? {});
    const lastReadId = messageId ?? access.channel.lastMessageId ?? 0;
    const [state] = await db
      .insert(readStates)
      .values({ userId: req.user.id, channelId, lastReadId, mentionCount: 0 })
      .onConflictDoUpdate({
        target: [readStates.userId, readStates.channelId],
        set: { lastReadId: sql`greatest(${readStates.lastReadId}, ${lastReadId})`, mentionCount: 0 },
      })
      .returning();
    const dto = { channelId, lastReadId: state.lastReadId, mentionCount: 0 };
    ctx.gateway.toUser(req.user.id, 'readstate:update', dto);
    return dto;
  });

  // Get one channel (used when opening a thread link).
  app.get('/api/channels/:id', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const access = await loadChannelAccess(db, channelId, req.user.id);
    if (access.isDm) return channelDto(access.channel);
    return { ...channelDto(access.channel, await overwritesFor(db, [channelId])), permissions: access.perms };
  });

  void inArray;
  void asc;
}
