import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EMOJI_NAME_RE, LIMITS } from '@shared/constants';
import { P } from '@shared/permissions';
import type { Webhook } from '@shared/types';
import type { AppContext } from '../context';
import { channels, emojis, webhooks } from '../db/schema';
import { requirePerm, requireServerAccess } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, conflict, intParam, notFound, parse } from '../lib/errors';
import { createMessage } from '../lib/messages';

export default async function emojiWebhookRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  async function publishEmojis(serverId: number) {
    const rows = await db.select().from(emojis).where(eq(emojis.serverId, serverId)).orderBy(asc(emojis.id));
    ctx.gateway.toServer(serverId, 'emojis:update', {
      serverId,
      emojis: rows.map((e) => ({ id: e.id, serverId, name: e.name, url: e.url, animated: e.animated })),
    });
  }

  // ---------- custom emojis ----------

  app.post('/api/servers/:id/emojis', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_EMOJIS);
    let name = '';
    let buf: Buffer | null = null;
    for await (const part of req.parts({ limits: { fileSize: LIMITS.emojiMaxBytes + 1, files: 1 } })) {
      if (part.type === 'file') buf = await part.toBuffer();
      else if (part.fieldname === 'name' && typeof part.value === 'string') name = part.value.trim();
    }
    if (!buf) throw badRequest('missing_file');
    if (!EMOJI_NAME_RE.test(name)) throw badRequest('invalid_emoji_name', 'Use 2-32 letters, digits or _');
    const [{ value }] = await db.select({ value: count() }).from(emojis).where(eq(emojis.serverId, serverId));
    if (value >= LIMITS.emojisPerServer) throw badRequest('too_many_emojis');
    const [dup] = await db
      .select()
      .from(emojis)
      .where(and(eq(emojis.serverId, serverId), eq(emojis.name, name)));
    if (dup) throw conflict('emoji_name_taken');
    const stored = await ctx.uploads.saveImage(buf, name, LIMITS.emojiMaxBytes);
    const [row] = await db
      .insert(emojis)
      .values({ serverId, name, url: stored.url, animated: stored.animated, creatorId: req.user.id })
      .returning();
    await audit(db, { serverId, actorId: req.user.id, action: 'emoji_create', targetId: row.id, targetType: 'emoji', details: { name } });
    await publishEmojis(serverId);
    return { id: row.id, serverId, name: row.name, url: row.url, animated: row.animated };
  });

  app.patch('/api/emojis/:id', authed, async (req) => {
    const [row] = await db.select().from(emojis).where(eq(emojis.id, intParam((req.params as { id: string }).id)));
    if (!row) throw notFound('unknown_emoji');
    const access = await requireServerAccess(db, row.serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_EMOJIS);
    const { name } = parse(z.object({ name: z.string().trim().regex(EMOJI_NAME_RE) }), req.body);
    const [dup] = await db
      .select()
      .from(emojis)
      .where(and(eq(emojis.serverId, row.serverId), eq(emojis.name, name)));
    if (dup && dup.id !== row.id) throw conflict('emoji_name_taken');
    await db.update(emojis).set({ name }).where(eq(emojis.id, row.id));
    await audit(db, { serverId: row.serverId, actorId: req.user.id, action: 'emoji_update', targetId: row.id, targetType: 'emoji', details: { name } });
    await publishEmojis(row.serverId);
    return { ok: true };
  });

  app.delete('/api/emojis/:id', authed, async (req) => {
    const [row] = await db.select().from(emojis).where(eq(emojis.id, intParam((req.params as { id: string }).id)));
    if (!row) throw notFound('unknown_emoji');
    const access = await requireServerAccess(db, row.serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_EMOJIS);
    await db.delete(emojis).where(eq(emojis.id, row.id));
    await ctx.uploads.remove(row.url);
    await audit(db, { serverId: row.serverId, actorId: req.user.id, action: 'emoji_delete', targetId: row.id, targetType: 'emoji', details: { name: row.name } });
    await publishEmojis(row.serverId);
    return { ok: true };
  });

  // ---------- webhooks ----------

  const webhookDto = (w: typeof webhooks.$inferSelect): Webhook => ({
    id: w.id,
    serverId: w.serverId,
    channelId: w.channelId,
    name: w.name,
    avatar: w.avatar,
    token: w.token,
    url: `/api/webhooks/${w.id}/${w.token}`,
    createdAt: w.createdAt.toISOString(),
  });

  app.get('/api/servers/:id/webhooks', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_WEBHOOKS);
    const rows = await db.select().from(webhooks).where(eq(webhooks.serverId, serverId)).orderBy(asc(webhooks.id));
    return rows.map(webhookDto);
  });

  app.post('/api/channels/:id/webhooks', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel?.serverId || (channel.type !== 'text' && channel.type !== 'announcement')) throw notFound('unknown_channel');
    const access = await requireServerAccess(db, channel.serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_WEBHOOKS);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    const [row] = await db
      .insert(webhooks)
      .values({ serverId: channel.serverId, channelId, name, token: randomBytes(32).toString('hex'), creatorId: req.user.id })
      .returning();
    await audit(db, { serverId: channel.serverId, actorId: req.user.id, action: 'webhook_create', targetId: row.id, targetType: 'webhook', details: { name } });
    return webhookDto(row);
  });

  app.patch('/api/webhooks/:id', authed, async (req) => {
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, intParam((req.params as { id: string }).id)));
    if (!row) throw notFound('unknown_webhook');
    const access = await requireServerAccess(db, row.serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_WEBHOOKS);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(80).optional(), channelId: z.number().int().positive().optional() }),
      req.body,
    );
    if (body.channelId) {
      const [ch] = await db
        .select()
        .from(channels)
        .where(and(eq(channels.id, body.channelId), eq(channels.serverId, row.serverId)));
      if (!ch || (ch.type !== 'text' && ch.type !== 'announcement')) throw badRequest('invalid_channel');
    }
    const [updated] = await db.update(webhooks).set(body).where(eq(webhooks.id, row.id)).returning();
    await audit(db, { serverId: row.serverId, actorId: req.user.id, action: 'webhook_update', targetId: row.id, targetType: 'webhook' });
    return webhookDto(updated);
  });

  app.delete('/api/webhooks/:id', authed, async (req) => {
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, intParam((req.params as { id: string }).id)));
    if (!row) throw notFound('unknown_webhook');
    const access = await requireServerAccess(db, row.serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_WEBHOOKS);
    await db.delete(webhooks).where(eq(webhooks.id, row.id));
    await audit(db, { serverId: row.serverId, actorId: req.user.id, action: 'webhook_delete', targetId: row.id, targetType: 'webhook', details: { name: row.name } });
    return { ok: true };
  });

  // Execute a webhook: anyone with the URL can post (for bots, game servers, CI...).
  app.post(
    '/api/webhooks/:id/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const params = req.params as { id: string; token: string };
      const [row] = await db.select().from(webhooks).where(eq(webhooks.id, intParam(params.id)));
      const given = Buffer.from(params.token ?? '');
      if (!row || given.length !== row.token.length || !timingSafeEqual(given, Buffer.from(row.token))) {
        throw notFound('unknown_webhook');
      }
      const body = parse(
        z.object({
          content: z.string().trim().min(1).max(LIMITS.messageMax),
          username: z.string().trim().min(1).max(80).optional(),
        }),
        req.body,
      );
      const [channel] = await db.select().from(channels).where(eq(channels.id, row.channelId));
      if (!channel) throw notFound('unknown_channel');
      const message = await createMessage(ctx, {
        channel,
        authorId: null,
        webhook: { id: row.id, name: body.username ?? row.name, avatar: row.avatar },
        content: body.content,
        canMentionEveryone: false,
      });
      reply.code(200);
      return message;
    },
  );
}
