import { and, count, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import { has, P } from '@shared/permissions';
import type { AppContext } from '../context';
import { attachments, emojis, messages, pollVotes, reactions, type MessageRow, type PollData } from '../db/schema';
import { loadChannelAccess, requirePerm, type ChannelAccess } from '../lib/access';
import { audit } from '../lib/audit';
import { isBlockedBetween } from '../lib/dms';
import { badRequest, forbidden, HttpError, intParam, notFound, parse, tooMany } from '../lib/errors';
import { createMessage, hydrateMessages, pollDto, resolveMentions, rollDice } from '../lib/messages';
import type { StoredFile } from '../lib/uploads';

const sendSchema = z.object({
  content: z.string().max(LIMITS.messageMax).default(''),
  replyToId: z.number().int().positive().nullable().optional(),
  mentionReplied: z.boolean().optional(),
  poll: z
    .object({
      question: z.string().trim().min(1).max(LIMITS.pollQuestionMax),
      options: z.array(z.string().trim().min(1).max(LIMITS.pollOptionMax)).min(LIMITS.pollOptionsMin).max(LIMITS.pollOptionsMax),
      multi: z.boolean().default(false),
      durationHours: z.number().int().min(1).max(LIMITS.pollMaxHours).default(24),
    })
    .optional(),
});

/** Unicode emoji (no letters/digits beyond keycaps) or a custom emoji written as name:id. */
const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Presentation}|‍|️|[#*0-9]️?⃣)+$/u;
const CUSTOM_EMOJI = /^([a-zA-Z0-9_]{2,32}):(\d{1,10})$/;

export default async function messageRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;
  const sendLimit = { preHandler: ctx.auth.requireUser, config: { rateLimit: { max: 10, timeWindow: 5000 } } };

  async function loadMessage(messageId: number, userId: number): Promise<{ message: MessageRow; access: ChannelAccess }> {
    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    if (!message) throw notFound('unknown_message');
    const access = await loadChannelAccess(db, message.channelId, userId);
    if (!has(access.perms, P.READ_HISTORY)) throw notFound('unknown_message');
    return { message, access };
  }

  async function readSendBody(req: FastifyRequest): Promise<{ body: z.infer<typeof sendSchema>; files: StoredFile[] }> {
    if (!req.isMultipart()) return { body: parse(sendSchema, req.body ?? {}), files: [] };
    const files: StoredFile[] = [];
    let raw: unknown = {};
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (files.length >= LIMITS.attachmentsPerMessage) {
            part.file.resume();
            throw badRequest('too_many_files');
          }
          files.push(await ctx.uploads.saveStream(part.file, part.filename));
        } else if (part.fieldname === 'payload_json' && typeof part.value === 'string') {
          raw = JSON.parse(part.value);
        }
      }
    } catch (err) {
      for (const f of files) await ctx.uploads.remove(f.url);
      if (err instanceof SyntaxError) throw badRequest('invalid_json');
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'file_too_large');
      throw err;
    }
    return { body: parse(sendSchema, raw), files };
  }

  app.get('/api/channels/:id/messages', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const q = parse(
      z.object({
        before: z.coerce.number().int().positive().optional(),
        after: z.coerce.number().int().min(0).optional(),
        around: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(LIMITS.messagePageSize),
      }),
      req.query,
    );
    const access = await loadChannelAccess(db, channelId, req.user.id);
    if (!has(access.perms, P.READ_HISTORY)) return [];
    let rows: MessageRow[];
    if (q.around) {
      const half = Math.floor(q.limit / 2);
      const older = await db
        .select()
        .from(messages)
        .where(and(eq(messages.channelId, channelId), lt(messages.id, q.around + 1)))
        .orderBy(desc(messages.id))
        .limit(half + 1);
      const newer = await db
        .select()
        .from(messages)
        .where(and(eq(messages.channelId, channelId), gt(messages.id, q.around)))
        .orderBy(messages.id)
        .limit(half);
      rows = [...older.reverse(), ...newer];
    } else if (q.after !== undefined) {
      rows = await db
        .select()
        .from(messages)
        .where(and(eq(messages.channelId, channelId), gt(messages.id, q.after)))
        .orderBy(messages.id)
        .limit(q.limit);
    } else {
      rows = (
        await db
          .select()
          .from(messages)
          .where(q.before ? and(eq(messages.channelId, channelId), lt(messages.id, q.before)) : eq(messages.channelId, channelId))
          .orderBy(desc(messages.id))
          .limit(q.limit)
      ).reverse();
    }
    return hydrateMessages(ctx, rows, req.user.id);
  });

  app.post('/api/channels/:id/messages', sendLimit, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const access = await loadChannelAccess(db, channelId, req.user.id);
    const { channel } = access;
    if (channel.type === 'voice' || channel.type === 'category') throw badRequest('not_text_channel');
    const { body, files } = await readSendBody(req);
    try {
      requirePerm(access.perms, P.SEND_MESSAGES);
      if (files.length) requirePerm(access.perms, P.ATTACH_FILES);
      let content = body.content.trim();
      if (!content && files.length === 0 && !body.poll) throw badRequest('empty_message', 'Message is empty');

      if (access.isDm && channel.type === 'dm') {
        const other = access.recipientIds.find((id) => id !== req.user.id);
        if (other && (await isBlockedBetween(ctx, req.user.id, other))) throw forbidden('blocked', 'You cannot message this user');
      }

      // Slowmode, skipped for moderators.
      if (channel.slowmode > 0 && !has(access.perms, P.MANAGE_MESSAGES) && !has(access.perms, P.MANAGE_CHANNELS)) {
        const [last] = await db
          .select({ createdAt: messages.createdAt })
          .from(messages)
          .where(and(eq(messages.channelId, channelId), eq(messages.authorId, req.user.id)))
          .orderBy(desc(messages.id))
          .limit(1);
        if (last) {
          const wait = channel.slowmode * 1000 - (Date.now() - last.createdAt.getTime());
          if (wait > 0) throw tooMany('slowmode', Math.ceil(wait / 1000));
        }
      }

      if (body.replyToId) {
        const [target] = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.id, body.replyToId), eq(messages.channelId, channelId)));
        if (!target) throw badRequest('unknown_reply_target');
      }

      const rolled = rollDice(content);
      if (rolled) content = rolled;

      let poll: PollData | null = null;
      if (body.poll) {
        poll = {
          question: body.poll.question,
          options: body.poll.options,
          multi: body.poll.multi,
          expiresAt: new Date(Date.now() + body.poll.durationHours * 3600_000).toISOString(),
        };
      }

      return await createMessage(ctx, {
        channel,
        authorId: req.user.id,
        content,
        replyToId: body.replyToId ?? null,
        mentionReplied: body.mentionReplied,
        files,
        poll,
        canMentionEveryone: has(access.perms, P.MENTION_EVERYONE),
        recipientIds: access.isDm ? access.recipientIds : undefined,
      });
    } catch (err) {
      for (const f of files) await ctx.uploads.remove(f.url);
      throw err;
    }
  });

  app.patch('/api/messages/:id', authed, async (req) => {
    const { message, access } = await loadMessage(intParam((req.params as { id: string }).id), req.user.id);
    if (message.authorId !== req.user.id || message.type !== 'default') throw forbidden('not_author');
    const { content } = parse(z.object({ content: z.string().max(LIMITS.messageMax) }), req.body);
    const trimmed = content.trim();
    const [{ value: fileCount }] = await db.select({ value: count() }).from(attachments).where(eq(attachments.messageId, message.id));
    if (!trimmed && fileCount === 0 && !message.poll) throw badRequest('empty_message');
    // Re-validate mentions against the channel (highlights update, nobody is pinged again).
    const resolved = await resolveMentions(
      ctx,
      access.channel,
      trimmed,
      has(access.perms, P.MENTION_EVERYONE),
      access.isDm ? access.recipientIds : undefined,
    );
    const [updated] = await db
      .update(messages)
      .set({
        content: trimmed,
        editedAt: new Date(),
        mentions: resolved.users,
        mentionRoles: resolved.roles,
        mentionEveryone: resolved.everyone,
      })
      .where(eq(messages.id, message.id))
      .returning();
    const [dto] = await hydrateMessages(ctx, [updated], req.user.id);
    await ctx.gateway.toChannel(access.channel, 'message:update', dto, access.isDm ? access.recipientIds : undefined);
    return dto;
  });

  app.delete('/api/messages/:id', authed, async (req) => {
    const { message, access } = await loadMessage(intParam((req.params as { id: string }).id), req.user.id);
    const own = message.authorId === req.user.id;
    if (!own && !has(access.perms, P.MANAGE_MESSAGES)) throw forbidden('missing_permissions');
    const files = await db.select().from(attachments).where(eq(attachments.messageId, message.id));
    await db.delete(messages).where(eq(messages.id, message.id));
    for (const f of files) await ctx.uploads.remove(f.url);
    if (!own && access.server) {
      await audit(db, {
        serverId: access.server.server.id,
        actorId: req.user.id,
        action: 'message_delete',
        targetId: message.authorId,
        targetType: 'user',
        details: { channelId: message.channelId },
      });
    }
    await ctx.gateway.toChannel(access.channel, 'message:delete', { id: message.id, channelId: message.channelId }, access.isDm ? access.recipientIds : undefined);
    return { ok: true };
  });

  // ---------- reactions ----------

  async function validEmoji(emoji: string): Promise<string> {
    const decoded = emoji.normalize('NFC');
    if (decoded.length > 64) throw badRequest('invalid_emoji');
    const custom = CUSTOM_EMOJI.exec(decoded);
    if (custom) {
      const [row] = await db.select().from(emojis).where(eq(emojis.id, Number(custom[2])));
      if (!row) throw badRequest('unknown_emoji');
      return `${row.name}:${row.id}`;
    }
    if (!UNICODE_EMOJI.test(decoded) || /^[0-9#*]+$/.test(decoded)) throw badRequest('invalid_emoji');
    return decoded;
  }

  app.put('/api/messages/:id/reactions/:emoji', authed, async (req) => {
    const params = req.params as { id: string; emoji: string };
    const { message, access } = await loadMessage(intParam(params.id), req.user.id);
    const emoji = await validEmoji(params.emoji);
    const existing = await db
      .select({ emoji: reactions.emoji })
      .from(reactions)
      .where(eq(reactions.messageId, message.id))
      .groupBy(reactions.emoji);
    const isNew = !existing.some((r) => r.emoji === emoji);
    // Adding to an existing reaction only needs read access, like Discord.
    if (isNew) {
      requirePerm(access.perms, P.ADD_REACTIONS);
      if (existing.length >= LIMITS.reactionsPerMessage) throw badRequest('too_many_reactions');
    }
    if (access.isDm && access.channel.type === 'dm') {
      const other = access.recipientIds.find((id) => id !== req.user.id);
      if (other && (await isBlockedBetween(ctx, req.user.id, other))) throw forbidden('blocked');
    }
    const inserted = await db
      .insert(reactions)
      .values({ messageId: message.id, userId: req.user.id, emoji })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) {
      await ctx.gateway.toChannel(
        access.channel,
        'reaction:add',
        { messageId: message.id, channelId: message.channelId, emoji, userId: req.user.id },
        access.isDm ? access.recipientIds : undefined,
      );
    }
    return { ok: true };
  });

  async function removeReaction(req: FastifyRequest, userIdParam?: string) {
    const params = req.params as { id: string; emoji: string };
    const { message, access } = await loadMessage(intParam(params.id), req.user.id);
    const emoji = params.emoji.normalize('NFC');
    const userId = userIdParam ? intParam(userIdParam) : req.user.id;
    if (userId !== req.user.id) requirePerm(access.perms, P.MANAGE_MESSAGES);
    const removed = await db
      .delete(reactions)
      .where(and(eq(reactions.messageId, message.id), eq(reactions.userId, userId), eq(reactions.emoji, emoji)))
      .returning();
    if (removed.length) {
      await ctx.gateway.toChannel(
        access.channel,
        'reaction:remove',
        { messageId: message.id, channelId: message.channelId, emoji, userId },
        access.isDm ? access.recipientIds : undefined,
      );
    }
    return { ok: true };
  }

  app.delete('/api/messages/:id/reactions/:emoji', authed, (req) => removeReaction(req));
  app.delete('/api/messages/:id/reactions/:emoji/:userId', authed, (req) =>
    removeReaction(req, (req.params as { userId: string }).userId),
  );

  // ---------- pins ----------

  app.get('/api/channels/:id/pins', authed, async (req) => {
    const channelId = intParam((req.params as { id: string }).id);
    const access = await loadChannelAccess(db, channelId, req.user.id);
    if (!has(access.perms, P.READ_HISTORY)) return [];
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, channelId), eq(messages.pinned, true)))
      .orderBy(desc(messages.id))
      .limit(LIMITS.pinsPerChannel);
    return hydrateMessages(ctx, rows, req.user.id);
  });

  async function setPinned(req: FastifyRequest, pinned: boolean) {
    const { message, access } = await loadMessage(intParam((req.params as { id: string }).id), req.user.id);
    if (!access.isDm) requirePerm(access.perms, P.MANAGE_MESSAGES);
    if (message.type !== 'default') throw badRequest('cannot_pin_system_message');
    if (message.pinned === pinned) return { ok: true };
    if (pinned) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(messages)
        .where(and(eq(messages.channelId, message.channelId), eq(messages.pinned, true)));
      if (value >= LIMITS.pinsPerChannel) throw badRequest('too_many_pins');
    }
    const [updated] = await db.update(messages).set({ pinned }).where(eq(messages.id, message.id)).returning();
    const [dto] = await hydrateMessages(ctx, [updated], req.user.id);
    const recipients = access.isDm ? access.recipientIds : undefined;
    await ctx.gateway.toChannel(access.channel, 'message:update', dto, recipients);
    if (access.server) {
      await audit(db, {
        serverId: access.server.server.id,
        actorId: req.user.id,
        action: pinned ? 'message_pin' : 'message_unpin',
        targetId: message.id,
        targetType: 'message',
        details: { channelId: message.channelId },
      });
    }
    if (pinned) {
      await createMessage(ctx, {
        channel: access.channel,
        authorId: req.user.id,
        type: 'pin',
        content: '',
        replyToId: message.id,
        recipientIds: recipients,
      });
    }
    return { ok: true };
  }

  app.put('/api/messages/:id/pin', authed, (req) => setPinned(req, true));
  app.delete('/api/messages/:id/pin', authed, (req) => setPinned(req, false));

  // ---------- polls ----------

  app.put('/api/messages/:id/poll/votes', authed, async (req) => {
    const { message, access } = await loadMessage(intParam((req.params as { id: string }).id), req.user.id);
    if (!message.poll) throw badRequest('not_a_poll');
    if (message.poll.expiresAt && new Date(message.poll.expiresAt).getTime() < Date.now()) throw badRequest('poll_closed');
    const { options } = parse(
      z.object({ options: z.array(z.number().int().min(0).max(LIMITS.pollOptionsMax - 1)).max(LIMITS.pollOptionsMax) }),
      req.body,
    );
    const unique = [...new Set(options)].filter((o) => o < message.poll!.options.length);
    if (!message.poll.multi && unique.length > 1) throw badRequest('single_choice_poll');
    await db.transaction(async (tx) => {
      await tx.delete(pollVotes).where(and(eq(pollVotes.messageId, message.id), eq(pollVotes.userId, req.user.id)));
      if (unique.length) {
        await tx.insert(pollVotes).values(unique.map((option) => ({ messageId: message.id, userId: req.user.id, option })));
      }
    });
    const votes = await db.select().from(pollVotes).where(eq(pollVotes.messageId, message.id));
    const poll = pollDto(message.poll, votes, req.user.id);
    await ctx.gateway.toChannel(
      access.channel,
      'poll:update',
      {
        messageId: message.id,
        channelId: message.channelId,
        counts: poll.options.map((o) => o.votes),
        totalVoters: poll.totalVoters,
        voterId: req.user.id,
        voterOptions: poll.myVotes,
      },
      access.isDm ? access.recipientIds : undefined,
    );
    return poll;
  });

  // Who reacted with an emoji (for the reaction tooltip / list).
  app.get('/api/messages/:id/reactions/:emoji', authed, async (req) => {
    const params = req.params as { id: string; emoji: string };
    const { message } = await loadMessage(intParam(params.id), req.user.id);
    const rows = await db
      .select({ userId: reactions.userId })
      .from(reactions)
      .where(and(eq(reactions.messageId, message.id), eq(reactions.emoji, params.emoji.normalize('NFC'))))
      .orderBy(reactions.createdAt)
      .limit(100);
    return rows.map((r) => r.userId);
  });

  void inArray;
  void sql;
}
