import { and, eq, inArray } from 'drizzle-orm';
import type { Channel } from '@shared/types';
import type { AppContext } from '../context';
import { channelRecipients, channels, relationships, users, type ChannelRow } from '../db/schema';
import { channelDto, publicUser } from './serialize';

/** DM / group DM channels with their recipients, for one viewer (hidden ones excluded unless asked). */
export async function dmChannelsFor(app: AppContext, userId: number, channelIds?: number[]): Promise<Channel[]> {
  const { db } = app;
  const mine = await db
    .select()
    .from(channelRecipients)
    .where(
      channelIds
        ? and(eq(channelRecipients.userId, userId), inArray(channelRecipients.channelId, channelIds))
        : and(eq(channelRecipients.userId, userId), eq(channelRecipients.hidden, false)),
    );
  if (mine.length === 0) return [];
  const ids = mine.map((r) => r.channelId);
  const [chans, recs] = await Promise.all([
    db.select().from(channels).where(inArray(channels.id, ids)),
    db.select().from(channelRecipients).where(inArray(channelRecipients.channelId, ids)),
  ]);
  return buildDtos(app, chans, recs);
}

export async function dmChannelDto(app: AppContext, channel: ChannelRow): Promise<Channel> {
  const recs = await app.db.select().from(channelRecipients).where(eq(channelRecipients.channelId, channel.id));
  const [dto] = await buildDtos(app, [channel], recs);
  return dto;
}

async function buildDtos(
  app: AppContext,
  chans: ChannelRow[],
  recs: { channelId: number; userId: number }[],
): Promise<Channel[]> {
  const userIds = [...new Set(recs.map((r) => r.userId))];
  const userRows = userIds.length ? await app.db.select().from(users).where(inArray(users.id, userIds)) : [];
  const map = new Map(userRows.map((u) => [u.id, publicUser(u, app.presence)]));
  return chans
    .map((c) =>
      channelDto(
        c,
        [],
        recs.filter((r) => r.channelId === c.id).map((r) => map.get(r.userId)!).filter(Boolean),
      ),
    )
    .sort((a, b) => (b.lastMessageId ?? b.id) - (a.lastMessageId ?? a.id));
}

/** True when either user has blocked the other. */
export async function isBlockedBetween(app: AppContext, a: number, b: number): Promise<boolean> {
  const rows = await app.db
    .select()
    .from(relationships)
    .where(
      and(
        inArray(relationships.userId, [a, b]),
        inArray(relationships.targetId, [a, b]),
        eq(relationships.type, 'blocked'),
      ),
    );
  return rows.some((r) => r.userId !== r.targetId);
}
