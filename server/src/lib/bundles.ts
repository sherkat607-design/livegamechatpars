import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { has, P } from '@shared/permissions';
import type { Channel, Member, ServerBundle } from '@shared/types';
import type { AppContext } from '../context';
import { channels, emojis, memberRoles, members, roles, users, type ChannelRow } from '../db/schema';
import { channelPermsFrom, overwritesFor, requireServerAccess, type ServerAccess } from './access';
import { channelDto, publicUser, roleDto, serverDto } from './serialize';

/** Server channels (and open threads) the member can view, as API objects. */
export async function visibleChannels(app: AppContext, access: ServerAccess): Promise<Channel[]> {
  const rows = await app.db
    .select()
    .from(channels)
    .where(eq(channels.serverId, access.server.id))
    .orderBy(asc(channels.position), asc(channels.id));
  const ows = await overwritesFor(
    app.db,
    rows.map((c) => c.id),
  );
  const byId = new Map(rows.map((c) => [c.id, c]));
  const canView = (c: ChannelRow) => {
    const parent = c.type === 'thread' && c.parentId ? (byId.get(c.parentId) ?? null) : null;
    if (c.type === 'thread' && !parent) return false;
    return has(channelPermsFrom(access, c, parent, ows), P.VIEW_CHANNEL);
  };
  const visible = rows.filter((c) => c.type !== 'category' && !(c.type === 'thread' && c.archived) && canView(c));
  const categoryIds = new Set(visible.map((c) => c.parentId).filter((x): x is number => x !== null));
  const categories = rows.filter((c) => c.type === 'category' && (categoryIds.has(c.id) || canView(c)));
  return [...categories, ...visible].map((c) => channelDto(c, ows));
}

export async function memberDtos(app: AppContext, serverId: number, userIds?: number[]): Promise<Member[]> {
  const { db, presence } = app;
  const where = userIds
    ? and(eq(members.serverId, serverId), inArray(members.userId, userIds))
    : eq(members.serverId, serverId);
  const rows = await db.select({ member: members, user: users }).from(members).innerJoin(users, eq(users.id, members.userId)).where(where);
  if (rows.length === 0) return [];
  const roleRows = await db
    .select()
    .from(memberRoles)
    .where(
      userIds
        ? and(eq(memberRoles.serverId, serverId), inArray(memberRoles.userId, userIds))
        : eq(memberRoles.serverId, serverId),
    );
  const byUser = new Map<number, number[]>();
  for (const r of roleRows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.roleId]);
  return rows.map(({ member, user }) => ({
    serverId,
    userId: member.userId,
    nickname: member.nickname,
    roles: byUser.get(member.userId) ?? [],
    joinedAt: member.joinedAt.toISOString(),
    timeoutUntil: member.timeoutUntil && member.timeoutUntil.getTime() > Date.now() ? member.timeoutUntil.toISOString() : null,
    user: publicUser(user, presence),
  }));
}

export async function memberDto(app: AppContext, serverId: number, userId: number): Promise<Member | null> {
  const [m] = await memberDtos(app, serverId, [userId]);
  return m ?? null;
}

export async function serverBundle(app: AppContext, serverId: number, userId: number): Promise<ServerBundle> {
  const access = await requireServerAccess(app.db, serverId, userId);
  const [chans, roleRows, emojiRows, [{ value: memberCount }], me] = await Promise.all([
    visibleChannels(app, access),
    app.db.select().from(roles).where(eq(roles.serverId, serverId)).orderBy(asc(roles.position)),
    app.db.select().from(emojis).where(eq(emojis.serverId, serverId)).orderBy(asc(emojis.id)),
    app.db.select({ value: count() }).from(members).where(eq(members.serverId, serverId)),
    memberDto(app, serverId, userId),
  ]);
  return {
    server: serverDto(access.server),
    channels: chans,
    roles: roleRows.map(roleDto),
    emojis: emojiRows.map((e) => ({ id: e.id, serverId: e.serverId, name: e.name, url: e.url, animated: e.animated })),
    member: me!,
    settings: { notifyLevel: access.member.notifyLevel as 'all' | 'mentions' | 'none', muted: access.member.muted },
    memberCount,
  };
}

/** Ask every online member of a server to re-fetch it (after permission-affecting changes). */
export async function refreshServer(app: AppContext, serverId: number, userIds?: number[]) {
  if (userIds) app.gateway.toUser(userIds, 'server:refresh', { id: serverId });
  else app.gateway.toServer(serverId, 'server:refresh', { id: serverId });
  await app.gateway.voice.recheckServer(serverId);
}
