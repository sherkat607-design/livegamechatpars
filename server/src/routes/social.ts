import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import type { Relationship, RelationshipType } from '@shared/types';
import type { AppContext } from '../context';
import { channelRecipients, channels, members, relationships, users } from '../db/schema';
import { dmChannelDto, dmChannelsFor } from '../lib/dms';
import { badRequest, forbidden, intParam, notFound, parse } from '../lib/errors';
import { createMessage } from '../lib/messages';
import { publicUser } from '../lib/serialize';

export default async function socialRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  async function relationshipOf(userId: number, targetId: number): Promise<RelationshipType | null> {
    const [row] = await db
      .select()
      .from(relationships)
      .where(and(eq(relationships.userId, userId), eq(relationships.targetId, targetId)));
    return (row?.type as RelationshipType) ?? null;
  }

  async function setRelationship(userId: number, targetId: number, type: RelationshipType | null) {
    await db.delete(relationships).where(and(eq(relationships.userId, userId), eq(relationships.targetId, targetId)));
    if (type) await db.insert(relationships).values({ userId, targetId, type });
  }

  /** Tell both sides about their new relationship state. */
  async function notify(a: number, b: number) {
    const rows = await db.select().from(users).where(inArray(users.id, [a, b]));
    const byId = new Map(rows.map((u) => [u.id, u]));
    for (const [me, other] of [
      [a, b],
      [b, a],
    ]) {
      const user = byId.get(other);
      if (!user) continue;
      ctx.gateway.toUser(me, 'relationship:update', {
        userId: other,
        type: await relationshipOf(me, other),
        user: publicUser(user, ctx.presence),
      });
    }
  }

  app.get('/api/relationships', authed, async (req): Promise<Relationship[]> => {
    const rows = await db
      .select({ rel: relationships, user: users })
      .from(relationships)
      .innerJoin(users, eq(users.id, relationships.targetId))
      .where(eq(relationships.userId, req.user.id));
    return rows.map((r) => ({ type: r.rel.type as RelationshipType, user: publicUser(r.user, ctx.presence) }));
  });

  // Send a friend request by username (accepts an incoming request automatically).
  app.post('/api/relationships', authed, async (req) => {
    const { username } = parse(z.object({ username: z.string().trim().toLowerCase().min(1).max(32) }), req.body);
    const [target] = await db.select().from(users).where(eq(users.username, username));
    if (!target || target.id === req.user.id) throw badRequest('friend_request_failed', 'User not found');
    const mine = await relationshipOf(req.user.id, target.id);
    const theirs = await relationshipOf(target.id, req.user.id);
    if (theirs === 'blocked') throw badRequest('friend_request_failed', 'User not found');
    if (mine === 'friend') return { type: 'friend' };
    if (theirs === 'outgoing') {
      await setRelationship(req.user.id, target.id, 'friend');
      await setRelationship(target.id, req.user.id, 'friend');
    } else {
      await setRelationship(req.user.id, target.id, 'outgoing');
      await setRelationship(target.id, req.user.id, 'incoming');
    }
    await notify(req.user.id, target.id);
    return { type: await relationshipOf(req.user.id, target.id) };
  });

  // Accept an incoming request.
  app.put('/api/relationships/:userId', authed, async (req) => {
    const targetId = intParam((req.params as { userId: string }).userId);
    if ((await relationshipOf(req.user.id, targetId)) !== 'incoming') throw badRequest('no_pending_request');
    await setRelationship(req.user.id, targetId, 'friend');
    await setRelationship(targetId, req.user.id, 'friend');
    await notify(req.user.id, targetId);
    return { type: 'friend' };
  });

  // Remove a friend, cancel/decline a request, or unblock.
  app.delete('/api/relationships/:userId', authed, async (req) => {
    const targetId = intParam((req.params as { userId: string }).userId);
    const mine = await relationshipOf(req.user.id, targetId);
    if (!mine) throw notFound('no_relationship');
    await setRelationship(req.user.id, targetId, null);
    if (mine !== 'blocked' && (await relationshipOf(targetId, req.user.id)) !== 'blocked') {
      await setRelationship(targetId, req.user.id, null);
    }
    await notify(req.user.id, targetId);
    return { ok: true };
  });

  app.put('/api/relationships/:userId/block', authed, async (req) => {
    const targetId = intParam((req.params as { userId: string }).userId);
    if (targetId === req.user.id) throw badRequest('cannot_block_self');
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
    if (!target) throw notFound('unknown_user');
    await setRelationship(req.user.id, targetId, 'blocked');
    if ((await relationshipOf(targetId, req.user.id)) !== 'blocked') await setRelationship(targetId, req.user.id, null);
    await notify(req.user.id, targetId);
    return { type: 'blocked' };
  });

  // ---------- DMs ----------

  app.get('/api/dms', authed, async (req) => dmChannelsFor(ctx, req.user.id));

  /** Friends, or people who share a server, may DM each other. */
  async function canDm(a: number, b: number): Promise<boolean> {
    if ((await relationshipOf(a, b)) === 'friend') return true;
    const mine = await db.select({ s: members.serverId }).from(members).where(eq(members.userId, a));
    if (mine.length === 0) return false;
    const [shared] = await db
      .select({ s: members.serverId })
      .from(members)
      .where(and(eq(members.userId, b), inArray(members.serverId, mine.map((m) => m.s))))
      .limit(1);
    return !!shared;
  }

  app.post('/api/dms', authed, async (req) => {
    const { recipientIds, name } = parse(
      z.object({
        recipientIds: z.array(z.number().int().positive()).min(1).max(LIMITS.groupDmMax - 1),
        name: z.string().trim().max(100).optional(),
      }),
      req.body,
    );
    const ids = [...new Set(recipientIds.filter((id) => id !== req.user.id))];
    if (ids.length === 0) throw badRequest('invalid_recipients');
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
    if (found.length !== ids.length) throw badRequest('invalid_recipients');

    if (ids.length === 1) {
      const other = ids[0];
      if (!(await canDm(req.user.id, other))) throw forbidden('cannot_dm', 'You can only message friends or people in your servers');
      const key = [req.user.id, other].sort((a, b) => a - b).join(':');
      let [channel] = await db.select().from(channels).where(eq(channels.dmKey, key));
      if (!channel) {
        [channel] = await db.insert(channels).values({ type: 'dm', dmKey: key }).returning();
        await db.insert(channelRecipients).values([
          { channelId: channel.id, userId: req.user.id },
          { channelId: channel.id, userId: other, hidden: true },
        ]);
      } else {
        await db
          .update(channelRecipients)
          .set({ hidden: false })
          .where(and(eq(channelRecipients.channelId, channel.id), eq(channelRecipients.userId, req.user.id)));
      }
      const dto = await dmChannelDto(ctx, channel);
      ctx.gateway.toUser(req.user.id, 'channel:create', dto);
      return dto;
    }

    // Group DMs are for friends only.
    for (const id of ids) {
      if ((await relationshipOf(req.user.id, id)) !== 'friend') throw forbidden('not_friends', 'Group DMs are for friends');
    }
    const [channel] = await db
      .insert(channels)
      .values({ type: 'group_dm', name: name ?? '', ownerId: req.user.id })
      .returning();
    await db.insert(channelRecipients).values([req.user.id, ...ids].map((userId) => ({ channelId: channel.id, userId })));
    const dto = await dmChannelDto(ctx, channel);
    ctx.gateway.toUser([req.user.id, ...ids], 'channel:create', dto);
    return dto;
  });

  async function loadGroup(channelId: number, userId: number) {
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel || (channel.type !== 'group_dm' && channel.type !== 'dm')) throw notFound('unknown_channel');
    const recs = await db.select().from(channelRecipients).where(eq(channelRecipients.channelId, channelId));
    if (!recs.some((r) => r.userId === userId)) throw notFound('unknown_channel');
    return { channel, recipientIds: recs.map((r) => r.userId) };
  }

  app.patch('/api/dms/:id', authed, async (req) => {
    const { channel, recipientIds } = await loadGroup(intParam((req.params as { id: string }).id), req.user.id);
    if (channel.type !== 'group_dm') throw badRequest('not_group');
    const { name } = parse(z.object({ name: z.string().trim().max(100) }), req.body);
    const [updated] = await db.update(channels).set({ name }).where(eq(channels.id, channel.id)).returning();
    const dto = await dmChannelDto(ctx, updated);
    ctx.gateway.toUser(recipientIds, 'channel:update', dto);
    return dto;
  });

  app.put('/api/dms/:id/recipients/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    const { channel, recipientIds } = await loadGroup(intParam(params.id), req.user.id);
    const userId = intParam(params.userId);
    if (channel.type !== 'group_dm') throw badRequest('not_group');
    if (recipientIds.includes(userId)) return { ok: true };
    if (recipientIds.length >= LIMITS.groupDmMax) throw badRequest('group_full');
    if ((await relationshipOf(req.user.id, userId)) !== 'friend') throw forbidden('not_friends');
    await db.insert(channelRecipients).values({ channelId: channel.id, userId });
    const dto = await dmChannelDto(ctx, channel);
    ctx.gateway.toUser(recipientIds, 'channel:update', dto);
    ctx.gateway.toUser(userId, 'channel:create', dto);
    await createMessage(ctx, {
      channel,
      authorId: req.user.id,
      type: 'system',
      content: `add:${userId}`,
      recipientIds: [...recipientIds, userId],
    });
    return dto;
  });

  // Leave a group (self) or remove someone (owner). For 1:1 DMs this closes (hides) the DM.
  app.delete('/api/dms/:id/recipients/:userId', authed, async (req) => {
    const params = req.params as { id: string; userId: string };
    const { channel, recipientIds } = await loadGroup(intParam(params.id), req.user.id);
    const userId = intParam(params.userId);
    if (channel.type === 'dm') {
      if (userId !== req.user.id) throw forbidden();
      await db
        .update(channelRecipients)
        .set({ hidden: true })
        .where(and(eq(channelRecipients.channelId, channel.id), eq(channelRecipients.userId, userId)));
      ctx.gateway.toUser(userId, 'channel:delete', { id: channel.id, serverId: null });
      return { ok: true };
    }
    if (userId !== req.user.id && channel.ownerId !== req.user.id) throw forbidden('not_owner');
    if (!recipientIds.includes(userId)) throw notFound('unknown_user');
    await ctx.gateway.voice.kick(userId);
    await db
      .delete(channelRecipients)
      .where(and(eq(channelRecipients.channelId, channel.id), eq(channelRecipients.userId, userId)));
    ctx.gateway.toUser(userId, 'channel:delete', { id: channel.id, serverId: null });
    const remaining = recipientIds.filter((id) => id !== userId);
    if (remaining.length === 0) {
      await db.delete(channels).where(eq(channels.id, channel.id));
      return { ok: true };
    }
    let current = channel;
    if (channel.ownerId === userId) {
      [current] = await db.update(channels).set({ ownerId: remaining[0] }).where(eq(channels.id, channel.id)).returning();
    }
    await createMessage(ctx, {
      channel: current,
      authorId: req.user.id,
      type: 'system',
      content: userId === req.user.id ? 'leave' : `remove:${userId}`,
      recipientIds: remaining,
    });
    ctx.gateway.toUser(remaining, 'channel:update', await dmChannelDto(ctx, current));
    return { ok: true };
  });

  // Users that can be invited to a DM: friends + people sharing a server (for the "new DM" picker).
  app.get('/api/dms/candidates', authed, async (req) => {
    const friends = await db
      .select({ id: relationships.targetId })
      .from(relationships)
      .where(and(eq(relationships.userId, req.user.id), eq(relationships.type, 'friend')));
    const ids = friends.map((f) => f.id);
    if (!ids.length) return [];
    const rows = await db.select().from(users).where(or(inArray(users.id, ids)));
    return rows.map((u) => publicUser(u, ctx.presence));
  });
}
