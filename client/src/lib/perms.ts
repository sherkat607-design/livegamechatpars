import {
  computeBasePermissions,
  computeChannelPermissions,
  DM_PERMISSIONS,
  has,
  highestPosition,
  P,
  type PermissionContext,
} from '@shared/permissions';
import type { Channel } from '@shared/types';
import { useStore } from '../store';

type S = ReturnType<typeof useStore.getState>;

function ctxFor(s: S, serverId: number, userId?: number): PermissionContext | null {
  const entry = s.servers[serverId];
  const me = s.me;
  if (!entry || !me) return null;
  const uid = userId ?? me.id;
  const member = s.members[serverId]?.[uid];
  if (!member) return null;
  return {
    userId: uid,
    ownerId: entry.server.ownerId,
    roles: entry.roles,
    memberRoleIds: member.roles,
    timeoutUntil: member.timeoutUntil,
  };
}

export function serverPerms(s: S, serverId: number): number {
  const ctx = ctxFor(s, serverId);
  return ctx ? computeBasePermissions(ctx) : 0;
}

export function channelPerms(s: S, channel: Channel | undefined): number {
  if (!channel) return 0;
  if (channel.type === 'dm' || channel.type === 'group_dm') return DM_PERMISSIONS;
  if (!channel.serverId) return 0;
  const ctx = ctxFor(s, channel.serverId);
  if (!ctx) return 0;
  const source = channel.type === 'thread' && channel.parentId ? s.channels[channel.parentId] : channel;
  let perms = computeChannelPermissions(ctx, (source ?? channel).overwrites);
  if (channel.type === 'thread') {
    perms = has(perms, P.SEND_IN_THREADS) ? perms | P.SEND_MESSAGES : perms & ~P.SEND_MESSAGES;
    if (channel.archived && !has(perms, P.MANAGE_CHANNELS)) perms &= ~P.SEND_MESSAGES;
  }
  if (channel.type === 'announcement' && !has(perms, P.MANAGE_MESSAGES)) perms &= ~P.SEND_MESSAGES;
  return perms;
}

/** Highest role position of a member in a server (owner = infinite). */
export function topPosition(s: S, serverId: number, userId?: number): number {
  const ctx = ctxFor(s, serverId, userId);
  return ctx ? highestPosition(ctx) : 0;
}

/** Can I moderate this member (kick, ban, timeout, roles)? */
export function outranks(s: S, serverId: number, targetId: number): boolean {
  const entry = s.servers[serverId];
  if (!entry || !s.me || targetId === entry.server.ownerId || targetId === s.me.id) return false;
  if (entry.server.ownerId === s.me.id) return true;
  return topPosition(s, serverId) > topPosition(s, serverId, targetId);
}

export function useServerPerms(serverId: number | null | undefined): number {
  return useStore((s) => (serverId ? serverPerms(s, serverId) : 0));
}

export function useChannelPerms(channelId: number | null | undefined): number {
  return useStore((s) => (channelId ? channelPerms(s, s.channels[channelId]) : 0));
}

export { has, P };
