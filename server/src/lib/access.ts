import { and, eq, inArray } from 'drizzle-orm';
import {
  computeBasePermissions,
  computeChannelPermissions,
  DM_PERMISSIONS,
  has,
  highestPosition,
  P,
  type PermissionContext,
} from '@shared/permissions';
import type { Db } from '../db';
import {
  channelRecipients,
  channels,
  memberRoles,
  members,
  overwrites,
  roles,
  servers,
  type ChannelRow,
  type MemberRow,
  type OverwriteRow,
  type RoleRow,
  type ServerRow,
} from '../db/schema';
import { forbidden, notFound } from './errors';

export interface ServerAccess {
  server: ServerRow;
  member: MemberRow;
  roles: RoleRow[];
  memberRoleIds: number[];
  ctx: PermissionContext;
  /** Server-wide permissions. */
  perms: number;
  isOwner: boolean;
  /** Highest role position (owner = MAX_SAFE_INTEGER). */
  top: number;
}

export interface ChannelAccess {
  channel: ChannelRow;
  /** Parent text channel when the channel is a thread. */
  parent: ChannelRow | null;
  server: ServerAccess | null;
  perms: number;
  isDm: boolean;
  /** Recipient ids for DMs and group DMs. */
  recipientIds: number[];
}

function toCtx(server: ServerRow, member: MemberRow, allRoles: RoleRow[], memberRoleIds: number[]): PermissionContext {
  return {
    userId: member.userId,
    ownerId: server.ownerId,
    roles: allRoles,
    memberRoleIds,
    timeoutUntil: member.timeoutUntil,
  };
}

export async function loadServerAccess(db: Db, serverId: number, userId: number): Promise<ServerAccess | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId));
  if (!server) return null;
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.serverId, serverId), eq(members.userId, userId)));
  if (!member) return null;
  const allRoles = await db.select().from(roles).where(eq(roles.serverId, serverId));
  const mine = await db
    .select({ roleId: memberRoles.roleId })
    .from(memberRoles)
    .where(and(eq(memberRoles.serverId, serverId), eq(memberRoles.userId, userId)));
  const memberRoleIds = mine.map((r) => r.roleId);
  const ctx = toCtx(server, member, allRoles, memberRoleIds);
  return {
    server,
    member,
    roles: allRoles,
    memberRoleIds,
    ctx,
    perms: computeBasePermissions(ctx),
    isOwner: server.ownerId === userId,
    top: highestPosition(ctx),
  };
}

/** Loads membership or answers 404 (non-members must not learn the server exists). */
export async function requireServerAccess(db: Db, serverId: number, userId: number): Promise<ServerAccess> {
  const access = await loadServerAccess(db, serverId, userId);
  if (!access) throw notFound('unknown_server');
  return access;
}

export function requirePerm(perms: number, perm: number) {
  if (!has(perms, perm)) throw forbidden('missing_permissions');
}

export async function overwritesFor(db: Db, channelIds: number[]): Promise<OverwriteRow[]> {
  if (channelIds.length === 0) return [];
  return db.select().from(overwrites).where(inArray(overwrites.channelId, channelIds));
}

/** Permission for one channel from already-loaded server access. */
export function channelPermsFrom(access: ServerAccess, channel: ChannelRow, parent: ChannelRow | null, ows: OverwriteRow[]): number {
  const source = channel.type === 'thread' && parent ? parent : channel;
  const relevant = ows.filter((o) => o.channelId === source.id) as Parameters<typeof computeChannelPermissions>[1];
  let perms = computeChannelPermissions(access.ctx, relevant);
  if (channel.type === 'thread') {
    // In threads, "send in threads" replaces "send messages".
    perms = has(perms, P.SEND_IN_THREADS) ? perms | P.SEND_MESSAGES : perms & ~P.SEND_MESSAGES;
    if (channel.archived && !has(perms, P.MANAGE_CHANNELS)) perms &= ~P.SEND_MESSAGES;
  }
  if (channel.type === 'announcement' && !has(perms, P.MANAGE_MESSAGES)) perms &= ~P.SEND_MESSAGES;
  return perms;
}

export async function loadChannel(db: Db, channelId: number): Promise<ChannelRow> {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) throw notFound('unknown_channel');
  return channel;
}

/** Loads a channel the user can view, with their permissions in it; 404 otherwise. */
export async function loadChannelAccess(db: Db, channelId: number, userId: number): Promise<ChannelAccess> {
  const channel = await loadChannel(db, channelId);
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    const rec = await db.select().from(channelRecipients).where(eq(channelRecipients.channelId, channelId));
    const recipientIds = rec.map((r) => r.userId);
    if (!recipientIds.includes(userId)) throw notFound('unknown_channel');
    return { channel, parent: null, server: null, perms: DM_PERMISSIONS, isDm: true, recipientIds };
  }
  const server = await loadServerAccess(db, channel.serverId!, userId);
  if (!server) throw notFound('unknown_channel');
  let parent: ChannelRow | null = null;
  if (channel.type === 'thread' && channel.parentId) {
    [parent] = await db.select().from(channels).where(eq(channels.id, channel.parentId));
    parent = parent ?? null;
  }
  const ows = await overwritesFor(db, [parent?.id ?? channel.id]);
  const perms = channelPermsFrom(server, channel, parent, ows);
  if (!has(perms, P.VIEW_CHANNEL)) throw notFound('unknown_channel');
  return { channel, parent, server, perms, isDm: false, recipientIds: [] };
}

/**
 * Which of the given users can view a server channel. Loads roles, member roles and
 * overwrites once, then computes permissions per user.
 */
export async function filterViewers(db: Db, channel: ChannelRow, userIds: number[]): Promise<number[]> {
  if (userIds.length === 0 || !channel.serverId) return [];
  const [server] = await db.select().from(servers).where(eq(servers.id, channel.serverId));
  if (!server) return [];
  let parent: ChannelRow | null = null;
  if (channel.type === 'thread' && channel.parentId) {
    [parent] = await db.select().from(channels).where(eq(channels.id, channel.parentId));
  }
  const source = parent ?? channel;
  const [allRoles, ows, memberRows, roleRows] = await Promise.all([
    db.select().from(roles).where(eq(roles.serverId, server.id)),
    db.select().from(overwrites).where(eq(overwrites.channelId, source.id)),
    db
      .select()
      .from(members)
      .where(and(eq(members.serverId, server.id), inArray(members.userId, userIds))),
    db
      .select()
      .from(memberRoles)
      .where(and(eq(memberRoles.serverId, server.id), inArray(memberRoles.userId, userIds))),
  ]);
  const byUser = new Map<number, number[]>();
  for (const r of roleRows) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r.roleId);
    byUser.set(r.userId, list);
  }
  const result: number[] = [];
  for (const m of memberRows) {
    const ctx = toCtx(server, m, allRoles, byUser.get(m.userId) ?? []);
    const perms = computeChannelPermissions(ctx, ows as Parameters<typeof computeChannelPermissions>[1]);
    if (has(perms, P.VIEW_CHANNEL)) result.push(m.userId);
  }
  return result;
}

/** Permission context for another member (for hierarchy checks). */
export async function memberContext(db: Db, access: ServerAccess, userId: number): Promise<PermissionContext | null> {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.serverId, access.server.id), eq(members.userId, userId)));
  if (!member) return null;
  const mine = await db
    .select({ roleId: memberRoles.roleId })
    .from(memberRoles)
    .where(and(eq(memberRoles.serverId, access.server.id), eq(memberRoles.userId, userId)));
  return toCtx(
    access.server,
    member,
    access.roles,
    mine.map((r) => r.roleId),
  );
}

/** Can the actor moderate the target (kick, ban, timeout, nickname, roles)? */
export function outranks(actor: ServerAccess, target: PermissionContext): boolean {
  if (target.userId === target.ownerId) return false;
  if (actor.isOwner) return true;
  return actor.top > highestPosition(target);
}
