// Permission bit flags, shared by the server (enforcement) and the client (UI).
// Values stay below 2^31 so they fit a Postgres integer and JS bitwise operators.

export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  READ_HISTORY: 1 << 2,
  MANAGE_MESSAGES: 1 << 3,
  ATTACH_FILES: 1 << 4,
  ADD_REACTIONS: 1 << 5,
  MENTION_EVERYONE: 1 << 6,
  MANAGE_CHANNELS: 1 << 7,
  MANAGE_ROLES: 1 << 8,
  MANAGE_SERVER: 1 << 9,
  KICK_MEMBERS: 1 << 10,
  BAN_MEMBERS: 1 << 11,
  MODERATE_MEMBERS: 1 << 12,
  CREATE_INVITE: 1 << 13,
  CHANGE_NICKNAME: 1 << 14,
  MANAGE_NICKNAMES: 1 << 15,
  MANAGE_EMOJIS: 1 << 16,
  MANAGE_WEBHOOKS: 1 << 17,
  VIEW_AUDIT_LOG: 1 << 18,
  CONNECT: 1 << 19,
  SPEAK: 1 << 20,
  VIDEO: 1 << 21,
  MUTE_MEMBERS: 1 << 22,
  DEAFEN_MEMBERS: 1 << 23,
  MOVE_MEMBERS: 1 << 24,
  CREATE_THREADS: 1 << 25,
  SEND_IN_THREADS: 1 << 26,
  ADMINISTRATOR: 1 << 27,
} as const;

export type PermissionName = keyof typeof P;

export const ALL_PERMISSIONS = (1 << 28) - 1;

export const DEFAULT_EVERYONE_PERMISSIONS =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.READ_HISTORY |
  P.ATTACH_FILES |
  P.ADD_REACTIONS |
  P.CREATE_INVITE |
  P.CHANGE_NICKNAME |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO |
  P.CREATE_THREADS |
  P.SEND_IN_THREADS;

/** What every recipient may do in a DM or group DM. */
export const DM_PERMISSIONS =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.READ_HISTORY |
  P.ATTACH_FILES |
  P.ADD_REACTIONS |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO;

/** Permissions a timed-out member keeps. */
export const TIMEOUT_PERMISSIONS = P.VIEW_CHANNEL | P.READ_HISTORY;

/** Bits that can be set per channel through permission overwrites. */
export const CHANNEL_PERMISSIONS =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.READ_HISTORY |
  P.MANAGE_MESSAGES |
  P.ATTACH_FILES |
  P.ADD_REACTIONS |
  P.MENTION_EVERYONE |
  P.MANAGE_CHANNELS |
  P.MANAGE_ROLES |
  P.CREATE_INVITE |
  P.MANAGE_WEBHOOKS |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO |
  P.MUTE_MEMBERS |
  P.DEAFEN_MEMBERS |
  P.MOVE_MEMBERS |
  P.CREATE_THREADS |
  P.SEND_IN_THREADS;

/** Grouping used by permission editors in the UI. */
export const PERMISSION_GROUPS: { key: string; perms: PermissionName[] }[] = [
  {
    key: 'general',
    perms: [
      'VIEW_CHANNEL',
      'MANAGE_CHANNELS',
      'MANAGE_ROLES',
      'MANAGE_EMOJIS',
      'VIEW_AUDIT_LOG',
      'MANAGE_WEBHOOKS',
      'MANAGE_SERVER',
    ],
  },
  {
    key: 'membership',
    perms: ['CREATE_INVITE', 'CHANGE_NICKNAME', 'MANAGE_NICKNAMES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS'],
  },
  {
    key: 'text',
    perms: [
      'SEND_MESSAGES',
      'SEND_IN_THREADS',
      'CREATE_THREADS',
      'ATTACH_FILES',
      'ADD_REACTIONS',
      'MENTION_EVERYONE',
      'MANAGE_MESSAGES',
      'READ_HISTORY',
    ],
  },
  { key: 'voice', perms: ['CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS'] },
  { key: 'advanced', perms: ['ADMINISTRATOR'] },
];

export function has(perms: number, perm: number): boolean {
  return (perms & perm) === perm;
}

export interface RoleLike {
  id: number;
  permissions: number;
  position: number;
  isDefault: boolean;
}

export interface OverwriteLike {
  targetType: 'role' | 'member';
  targetId: number;
  allow: number;
  deny: number;
}

export interface PermissionContext {
  userId: number;
  ownerId: number;
  /** All roles of the server, including the default (@everyone) role. */
  roles: RoleLike[];
  /** Role ids the member has (not including @everyone). */
  memberRoleIds: number[];
  /** Timeout end, if any. */
  timeoutUntil?: Date | string | null;
}

function isTimedOut(ctx: PermissionContext, now: number): boolean {
  if (!ctx.timeoutUntil) return false;
  return new Date(ctx.timeoutUntil).getTime() > now;
}

/** Server-wide permissions of a member (before channel overwrites). */
export function computeBasePermissions(ctx: PermissionContext, now = Date.now()): number {
  if (ctx.userId === ctx.ownerId) return ALL_PERMISSIONS;
  const everyone = ctx.roles.find((r) => r.isDefault);
  let perms = everyone ? everyone.permissions : 0;
  const mine = new Set(ctx.memberRoleIds);
  for (const role of ctx.roles) {
    if (mine.has(role.id)) perms |= role.permissions;
  }
  if (has(perms, P.ADMINISTRATOR)) return ALL_PERMISSIONS;
  if (isTimedOut(ctx, now)) perms &= TIMEOUT_PERMISSIONS;
  return perms;
}

/** Permissions of a member in one channel, applying overwrites in Discord-like order. */
export function computeChannelPermissions(
  ctx: PermissionContext,
  overwrites: OverwriteLike[],
  now = Date.now(),
): number {
  const base = computeBasePermissions(ctx, now);
  if (has(base, P.ADMINISTRATOR) || ctx.userId === ctx.ownerId) return ALL_PERMISSIONS;

  let perms = base;
  const everyone = ctx.roles.find((r) => r.isDefault);
  if (everyone) {
    const ow = overwrites.find((o) => o.targetType === 'role' && o.targetId === everyone.id);
    if (ow) {
      perms &= ~ow.deny;
      perms |= ow.allow;
    }
  }

  let roleAllow = 0;
  let roleDeny = 0;
  const mine = new Set(ctx.memberRoleIds);
  for (const ow of overwrites) {
    if (ow.targetType === 'role' && mine.has(ow.targetId)) {
      roleAllow |= ow.allow;
      roleDeny |= ow.deny;
    }
  }
  perms &= ~roleDeny;
  perms |= roleAllow;

  const memberOw = overwrites.find((o) => o.targetType === 'member' && o.targetId === ctx.userId);
  if (memberOw) {
    perms &= ~memberOw.deny;
    perms |= memberOw.allow;
  }

  if (isTimedOut(ctx, now)) perms &= TIMEOUT_PERMISSIONS;
  if (!has(perms, P.VIEW_CHANNEL)) return 0;
  return perms;
}

/** Highest role position of a member; the owner outranks everyone. */
export function highestPosition(ctx: PermissionContext): number {
  if (ctx.userId === ctx.ownerId) return Number.MAX_SAFE_INTEGER;
  const mine = new Set(ctx.memberRoleIds);
  let top = 0;
  for (const role of ctx.roles) {
    if (mine.has(role.id) && role.position > top) top = role.position;
  }
  return top;
}
