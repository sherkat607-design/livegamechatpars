import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { INVITE_MAX_AGES, INVITE_MAX_USES } from '@shared/constants';
import { has, P } from '@shared/permissions';
import type { Invite, InvitePreview } from '@shared/types';
import type { AppContext } from '../context';
import { channels, invites, members, servers, users } from '../db/schema';
import { requirePerm, requireServerAccess } from '../lib/access';
import { audit } from '../lib/audit';
import { forbidden, notFound, parse } from '../lib/errors';
import { publicUser } from '../lib/serialize';
import { addMember } from './servers';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function newCode(): string {
  const bytes = randomBytes(10);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export default async function inviteRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  function dto(row: typeof invites.$inferSelect, inviter: typeof users.$inferSelect | null): Invite {
    return {
      code: row.code,
      serverId: row.serverId,
      channelId: row.channelId,
      inviter: inviter ? publicUser(inviter, ctx.presence) : null,
      maxUses: row.maxUses,
      uses: row.uses,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  function usable(row: typeof invites.$inferSelect): boolean {
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false;
    if (row.maxUses > 0 && row.uses >= row.maxUses) return false;
    return true;
  }

  app.post('/api/servers/:id/invites', authed, async (req) => {
    const serverId = Number((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.CREATE_INVITE);
    const body = parse(
      z.object({
        maxAgeSeconds: z
          .number()
          .int()
          .refine((v) => (INVITE_MAX_AGES as readonly number[]).includes(v))
          .default(604800),
        maxUses: z
          .number()
          .int()
          .refine((v) => (INVITE_MAX_USES as readonly number[]).includes(v))
          .default(0),
        channelId: z.number().int().positive().optional(),
      }),
      req.body ?? {},
    );
    let channelId: number | null = null;
    if (body.channelId) {
      const [ch] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.id, body.channelId), eq(channels.serverId, serverId)));
      channelId = ch?.id ?? null;
    }
    const [row] = await db
      .insert(invites)
      .values({
        code: newCode(),
        serverId,
        channelId,
        inviterId: req.user.id,
        maxUses: body.maxUses,
        expiresAt: body.maxAgeSeconds ? new Date(Date.now() + body.maxAgeSeconds * 1000) : null,
      })
      .returning();
    await audit(db, { serverId, actorId: req.user.id, action: 'invite_create', targetType: 'invite', details: { code: row.code } });
    return dto(row, req.user);
  });

  app.get('/api/servers/:id/invites', authed, async (req) => {
    const serverId = Number((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_SERVER);
    const rows = await db
      .select({ invite: invites, inviter: users })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.inviterId))
      .where(eq(invites.serverId, serverId))
      .orderBy(desc(invites.createdAt));
    return rows.filter((r) => usable(r.invite)).map((r) => dto(r.invite, r.inviter));
  });

  app.delete('/api/invites/:code', authed, async (req) => {
    const code = (req.params as { code: string }).code;
    const [row] = await db.select().from(invites).where(eq(invites.code, code));
    if (!row) throw notFound('unknown_invite');
    const access = await requireServerAccess(db, row.serverId, req.user.id);
    if (row.inviterId !== req.user.id && !has(access.perms, P.MANAGE_SERVER)) throw forbidden('missing_permissions');
    await db.delete(invites).where(eq(invites.code, code));
    await audit(db, { serverId: row.serverId, actorId: req.user.id, action: 'invite_delete', targetType: 'invite', details: { code } });
    return { ok: true };
  });

  // Public preview for the invite page (no login needed).
  app.get('/api/invites/:code', async (req): Promise<InvitePreview> => {
    const code = (req.params as { code: string }).code;
    const [row] = await db
      .select({ invite: invites, server: servers, inviter: users })
      .from(invites)
      .innerJoin(servers, eq(servers.id, invites.serverId))
      .leftJoin(users, eq(users.id, invites.inviterId))
      .where(eq(invites.code, code));
    if (!row || !usable(row.invite)) throw notFound('unknown_invite');
    const memberRows = await db.select({ userId: members.userId }).from(members).where(eq(members.serverId, row.server.id));
    return {
      code,
      server: { id: row.server.id, name: row.server.name, icon: row.server.icon, description: row.server.description },
      memberCount: memberRows.length,
      onlineCount: ctx.presence.onlineCount(memberRows.map((m) => m.userId)),
      inviter: row.inviter ? publicUser(row.inviter, ctx.presence) : null,
      expiresAt: row.invite.expiresAt?.toISOString() ?? null,
    };
  });

  app.post('/api/invites/:code', authed, async (req) => {
    const code = (req.params as { code: string }).code;
    const [row] = await db.select().from(invites).where(eq(invites.code, code));
    if (!row || !usable(row)) throw notFound('unknown_invite');
    const [already] = await db
      .select({ c: count() })
      .from(members)
      .where(and(eq(members.serverId, row.serverId), eq(members.userId, req.user.id)));
    const bundle = await addMember(ctx, row.serverId, req.user.id);
    if (!already?.c) {
      await db
        .update(invites)
        .set({ uses: sql`${invites.uses} + 1` })
        .where(eq(invites.code, code));
    }
    return bundle;
  });
}
