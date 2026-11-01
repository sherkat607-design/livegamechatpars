import { and, arrayContains, arrayOverlaps, count, desc, eq, exists, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import { has, P } from '@shared/permissions';
import type { AuditLogEntry, SearchResult } from '@shared/types';
import type { AppContext } from '../context';
import { attachments, auditLogs, memberRoles, members, messages, users } from '../db/schema';
import { loadChannelAccess, requirePerm, requireServerAccess } from '../lib/access';
import { visibleChannels } from '../lib/bundles';
import { badRequest, intParam, parse } from '../lib/errors';
import { hydrateMessages } from '../lib/messages';
import { publicUser } from '../lib/serialize';

export default async function searchRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  app.get('/api/search', authed, async (req): Promise<SearchResult> => {
    const q = parse(
      z.object({
        serverId: z.coerce.number().int().positive().optional(),
        channelId: z.coerce.number().int().positive().optional(),
        q: z.string().trim().max(200).default(''),
        authorId: z.coerce.number().int().positive().optional(),
        has: z.enum(['file', 'image', 'link', 'poll']).optional(),
        mentions: z.coerce.number().int().positive().optional(),
        pinned: z.enum(['true', 'false']).optional(),
        offset: z.coerce.number().int().min(0).max(5000).default(0),
      }),
      req.query,
    );
    let channelIds: number[] = [];
    if (q.channelId) {
      const access = await loadChannelAccess(db, q.channelId, req.user.id);
      if (has(access.perms, P.READ_HISTORY)) channelIds = [q.channelId];
    } else if (q.serverId) {
      const access = await requireServerAccess(db, q.serverId, req.user.id);
      const chans = await visibleChannels(ctx, access);
      channelIds = chans.filter((c) => c.type !== 'category' && c.type !== 'voice').map((c) => c.id);
    } else {
      throw badRequest('missing_scope', 'Pass serverId or channelId');
    }
    if (channelIds.length === 0) return { total: 0, messages: [] };
    const conds: SQL[] = [inArray(messages.channelId, channelIds), eq(messages.type, 'default')];
    if (q.q) {
      const pattern = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conds.push(or(ilike(messages.content, pattern), sql`${messages.poll}->>'question' ilike ${pattern}`)!);
    }
    if (q.authorId) conds.push(eq(messages.authorId, q.authorId));
    if (q.mentions) conds.push(arrayContains(messages.mentions, [q.mentions]));
    if (q.pinned) conds.push(eq(messages.pinned, q.pinned === 'true'));
    if (q.has === 'link') conds.push(sql`${messages.content} ~* 'https?://'`);
    if (q.has === 'poll') conds.push(sql`${messages.poll} is not null`);
    if (q.has === 'file' || q.has === 'image') {
      conds.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(attachments)
            .where(
              q.has === 'image'
                ? and(eq(attachments.messageId, messages.id), ilike(attachments.contentType, 'image/%'))
                : eq(attachments.messageId, messages.id),
            ),
        ),
      );
    }
    const where = and(...conds);
    const [{ value: total }] = await db.select({ value: count() }).from(messages).where(where);
    const rows = await db
      .select()
      .from(messages)
      .where(where)
      .orderBy(desc(messages.id))
      .limit(LIMITS.searchPageSize)
      .offset(q.offset);
    return { total, messages: await hydrateMessages(ctx, rows, req.user.id) };
  });

  // Recent messages that mention me (directly, by role or @everyone) across my servers.
  app.get('/api/me/mentions', authed, async (req) => {
    const { before } = parse(z.object({ before: z.coerce.number().int().positive().optional() }), req.query);
    const myServers = await db.select({ serverId: members.serverId }).from(members).where(eq(members.userId, req.user.id));
    const visible: number[] = [];
    for (const { serverId } of myServers) {
      const access = await requireServerAccess(db, serverId, req.user.id);
      const chans = await visibleChannels(ctx, access);
      visible.push(...chans.filter((c) => c.type !== 'category' && c.type !== 'voice').map((c) => c.id));
    }
    if (visible.length === 0) return [];
    const myRoles = await db.select({ roleId: memberRoles.roleId }).from(memberRoles).where(eq(memberRoles.userId, req.user.id));
    const roleIds = myRoles.map((r) => r.roleId);
    const mentionConds: SQL[] = [arrayContains(messages.mentions, [req.user.id]), eq(messages.mentionEveryone, true)];
    if (roleIds.length) mentionConds.push(arrayOverlaps(messages.mentionRoles, roleIds));
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          inArray(messages.channelId, visible),
          or(...mentionConds),
          before ? lt(messages.id, before) : undefined,
        ),
      )
      .orderBy(desc(messages.id))
      .limit(25);
    return hydrateMessages(ctx, rows, req.user.id);
  });

  app.get('/api/servers/:id/audit-log', authed, async (req): Promise<AuditLogEntry[]> => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.VIEW_AUDIT_LOG);
    const { before } = parse(z.object({ before: z.coerce.number().int().positive().optional() }), req.query);
    const rows = await db
      .select({ log: auditLogs, actor: users })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(before ? and(eq(auditLogs.serverId, serverId), lt(auditLogs.id, before)) : eq(auditLogs.serverId, serverId))
      .orderBy(desc(auditLogs.id))
      .limit(50);
    return rows.map(({ log, actor }) => ({
      id: log.id,
      serverId,
      actor: actor ? publicUser(actor, ctx.presence) : null,
      action: log.action,
      targetId: log.targetId,
      targetType: log.targetType,
      reason: log.reason,
      details: log.details,
      createdAt: log.createdAt.toISOString(),
    }));
  });
}
