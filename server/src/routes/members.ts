import { and, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import { has, P } from '@shared/permissions';
import type { Ban } from '@shared/types';
import type { AppContext } from '../context';
import { bans, channels, memberRoles, members, messages, roles, users } from '../db/schema';
import { loadChannelAccess, memberContext, outranks, requirePerm, requireServerAccess } from '../lib/access';
import { audit } from '../lib/audit';
import { memberDto, refreshServer } from '../lib/bundles';
import { badRequest, forbidden, intParam, notFound, parse } from '../lib/errors';
import { publicUser } from '../lib/serialize';

export default async function memberRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  async function moderation(serverIdParam: string, userIdParam: string, actorId: number) {
    const serverId = intParam(serverIdParam);
    const userId = intParam(userIdParam);
    const access = await requireServerAccess(db, serverId, actorId);
    const target = await memberContext(db, access, userId);
    return { serverId, userId, access, target };
  }

  async function publishMember(serverId: number, userId: number) {
    const dto = await memberDto(ctx, serverId, userId);
    if (dto) ctx.gateway.toServer(serverId, 'member:update', dto);
    return dto;
  }

  // Nickname and timeout.
  app.patch('/api/servers/:id/members/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    const selfTarget = params.userId === '@me';
    const { serverId, userId, access, target } = await moderation(params.id, selfTarget ? String(req.user.id) : params.userId, req.user.id);
    if (!target) throw notFound('unknown_member');
    const body = parse(
      z.object({
        nickname: z.string().trim().max(LIMITS.nicknameMax).nullable().optional(),
        timeoutUntil: z.string().datetime().nullable().optional(),
        reason: z.string().max(512).optional(),
      }),
      req.body,
    );
    const patch: { nickname?: string | null; timeoutUntil?: Date | null } = {};
    if (body.nickname !== undefined) {
      if (userId === req.user.id) requirePerm(access.perms, P.CHANGE_NICKNAME);
      else {
        requirePerm(access.perms, P.MANAGE_NICKNAMES);
        if (!outranks(access, target)) throw forbidden('role_hierarchy');
      }
      patch.nickname = body.nickname || null;
    }
    if (body.timeoutUntil !== undefined) {
      requirePerm(access.perms, P.MODERATE_MEMBERS);
      if (userId === req.user.id || !outranks(access, target)) throw forbidden('role_hierarchy');
      const targetAccess = await requireServerAccess(db, serverId, userId);
      if (has(targetAccess.perms, P.ADMINISTRATOR)) throw forbidden('cannot_timeout_admin');
      if (body.timeoutUntil) {
        const until = new Date(body.timeoutUntil);
        const max = Date.now() + LIMITS.timeoutMaxDays * 86400_000;
        if (until.getTime() > max) throw badRequest('timeout_too_long');
        patch.timeoutUntil = until.getTime() <= Date.now() ? null : until;
      } else patch.timeoutUntil = null;
    }
    if (Object.keys(patch).length === 0) return memberDto(ctx, serverId, userId);
    await db.update(members).set(patch).where(and(eq(members.serverId, serverId), eq(members.userId, userId)));
    if (patch.timeoutUntil !== undefined) {
      await audit(db, {
        serverId,
        actorId: req.user.id,
        action: 'member_timeout',
        targetId: userId,
        targetType: 'user',
        reason: body.reason ?? '',
        details: { until: patch.timeoutUntil?.toISOString() ?? null },
      });
      if (patch.timeoutUntil) await ctx.gateway.voice.kick(userId, serverId);
      await refreshServer(ctx, serverId, [userId]);
    } else if (userId !== req.user.id) {
      await audit(db, { serverId, actorId: req.user.id, action: 'member_update', targetId: userId, targetType: 'user', details: { nickname: patch.nickname } });
    }
    return publishMember(serverId, userId);
  });

  // Kick.
  app.delete('/api/servers/:id/members/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    if (params.userId === '@me') throw badRequest('use_leave_endpoint');
    const { serverId, userId, access, target } = await moderation(params.id, params.userId, req.user.id);
    if (!target) throw notFound('unknown_member');
    requirePerm(access.perms, P.KICK_MEMBERS);
    if (userId === req.user.id || !outranks(access, target)) throw forbidden('role_hierarchy');
    const reason = parse(z.object({ reason: z.string().max(512).optional() }), req.query).reason ?? '';
    await ctx.gateway.voice.kick(userId, serverId);
    await db.delete(members).where(and(eq(members.serverId, serverId), eq(members.userId, userId)));
    ctx.gateway.removeFromServer(userId, serverId);
    ctx.gateway.toUser(userId, 'server:delete', { id: serverId, reason: 'kicked' });
    ctx.gateway.toServer(serverId, 'member:remove', { serverId, userId });
    await audit(db, { serverId, actorId: req.user.id, action: 'member_kick', targetId: userId, targetType: 'user', reason });
    return { ok: true };
  });

  app.get('/api/servers/:id/bans', authed, async (req): Promise<Ban[]> => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.BAN_MEMBERS);
    const rows = await db
      .select({ ban: bans, user: users })
      .from(bans)
      .innerJoin(users, eq(users.id, bans.userId))
      .where(eq(bans.serverId, serverId))
      .orderBy(desc(bans.createdAt));
    return rows.map((r) => ({ user: publicUser(r.user, ctx.presence), reason: r.ban.reason, createdAt: r.ban.createdAt.toISOString() }));
  });

  app.put('/api/servers/:id/bans/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    const { serverId, userId, access, target } = await moderation(params.id, params.userId, req.user.id);
    requirePerm(access.perms, P.BAN_MEMBERS);
    if (userId === req.user.id) throw badRequest('cannot_ban_self');
    if (userId === access.server.ownerId) throw forbidden('role_hierarchy');
    if (target && !outranks(access, target)) throw forbidden('role_hierarchy');
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!exists) throw notFound('unknown_user');
    const body = parse(
      z.object({ reason: z.string().max(512).optional(), deleteMessageSeconds: z.number().int().min(0).max(604800).optional() }),
      req.body ?? {},
    );
    await db
      .insert(bans)
      .values({ serverId, userId, reason: body.reason ?? '', moderatorId: req.user.id })
      .onConflictDoUpdate({ target: [bans.serverId, bans.userId], set: { reason: body.reason ?? '' } });
    if (target) {
      await ctx.gateway.voice.kick(userId, serverId);
      await db.delete(members).where(and(eq(members.serverId, serverId), eq(members.userId, userId)));
      ctx.gateway.removeFromServer(userId, serverId);
      ctx.gateway.toUser(userId, 'server:delete', { id: serverId, reason: 'banned' });
      ctx.gateway.toServer(serverId, 'member:remove', { serverId, userId });
    }
    if (body.deleteMessageSeconds) {
      const since = new Date(Date.now() - body.deleteMessageSeconds * 1000);
      const serverChannels = await db.select({ id: channels.id }).from(channels).where(eq(channels.serverId, serverId));
      for (const ch of serverChannels) {
        const removed = await db
          .delete(messages)
          .where(and(eq(messages.channelId, ch.id), eq(messages.authorId, userId), gt(messages.createdAt, since)))
          .returning({ id: messages.id });
        for (const m of removed) ctx.gateway.toServer(serverId, 'message:delete', { id: m.id, channelId: ch.id });
      }
    }
    await audit(db, { serverId, actorId: req.user.id, action: 'member_ban', targetId: userId, targetType: 'user', reason: body.reason ?? '' });
    return { ok: true };
  });

  app.delete('/api/servers/:id/bans/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    const serverId = intParam(params.id);
    const userId = intParam(params.userId);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.BAN_MEMBERS);
    const removed = await db.delete(bans).where(and(eq(bans.serverId, serverId), eq(bans.userId, userId))).returning();
    if (!removed.length) throw notFound('unknown_ban');
    await audit(db, { serverId, actorId: req.user.id, action: 'member_unban', targetId: userId, targetType: 'user' });
    return { ok: true };
  });

  // Give / take a role.
  async function changeRole(req: { params: unknown; user: { id: number } }, add: boolean) {
    const params = req.params as { id: string; userId: string; roleId: string };
    const { serverId, userId, access, target } = await moderation(params.id, params.userId, req.user.id);
    if (!target) throw notFound('unknown_member');
    requirePerm(access.perms, P.MANAGE_ROLES);
    const roleId = intParam(params.roleId);
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.serverId, serverId)));
    if (!role || role.isDefault) throw notFound('unknown_role');
    if (!access.isOwner && role.position >= access.top) throw forbidden('role_hierarchy');
    if (add) {
      await db.insert(memberRoles).values({ serverId, userId, roleId }).onConflictDoNothing();
    } else {
      await db
        .delete(memberRoles)
        .where(and(eq(memberRoles.serverId, serverId), eq(memberRoles.userId, userId), eq(memberRoles.roleId, roleId)));
    }
    await audit(db, {
      serverId,
      actorId: req.user.id,
      action: add ? 'member_role_add' : 'member_role_remove',
      targetId: userId,
      targetType: 'user',
      details: { roleId, roleName: role.name },
    });
    const dto = await publishMember(serverId, userId);
    await refreshServer(ctx, serverId, [userId]);
    return dto;
  }

  app.put('/api/servers/:id/members/:userId/roles/:roleId', authed, (req) => changeRole(req, true));
  app.delete('/api/servers/:id/members/:userId/roles/:roleId', authed, (req) => changeRole(req, false));

  // Voice moderation: server mute / deafen / disconnect.
  app.post('/api/voice/:channelId/members/:userId', authed, async (req) => {
    const params = req.params as { channelId: string; userId: string };
    const channelId = intParam(params.channelId);
    const userId = intParam(params.userId);
    const access = await loadChannelAccess(db, channelId, req.user.id);
    if (!access.server) throw badRequest('not_server_channel');
    const target = await memberContext(db, access.server, userId);
    if (!target) throw notFound('unknown_member');
    const body = parse(
      z.object({ serverMute: z.boolean().optional(), serverDeaf: z.boolean().optional(), disconnect: z.boolean().optional() }),
      req.body,
    );
    const session = ctx.gateway.voice.sessionOf(userId);
    if (!session || session.channelId !== channelId) throw badRequest('not_in_channel');
    if (userId !== req.user.id && !outranks(access.server, target) && !access.server.isOwner) {
      throw forbidden('role_hierarchy');
    }
    if (body.serverMute !== undefined) requirePerm(access.perms, P.MUTE_MEMBERS);
    if (body.serverDeaf !== undefined) requirePerm(access.perms, P.DEAFEN_MEMBERS);
    if (body.disconnect) requirePerm(access.perms, P.MOVE_MEMBERS);
    if (body.disconnect) await ctx.gateway.voice.kick(userId);
    else await ctx.gateway.voice.moderate(userId, { serverMute: body.serverMute, serverDeaf: body.serverDeaf });
    await audit(db, {
      serverId: access.server.server.id,
      actorId: req.user.id,
      action: 'member_voice_update',
      targetId: userId,
      targetType: 'user',
      details: body,
    });
    return { ok: true };
  });
}
