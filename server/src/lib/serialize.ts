import type { Channel, PresenceStatus, PublicUser, Role, SelfUser, Server } from '@shared/types';
import type { ChannelRow, OverwriteRow, RoleRow, ServerRow, UserRow } from '../db/schema';
import type { PresenceTracker } from './presence';

export function publicUser(u: UserRow, presence: PresenceTracker): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatar: u.avatar,
    bannerColor: u.bannerColor,
    bio: u.bio,
    customStatus: u.customStatus,
    activity: u.activity,
    status: presence.statusOf(u.id),
    createdAt: u.createdAt.toISOString(),
  };
}

export function selfUser(u: UserRow, presence: PresenceTracker): SelfUser {
  return {
    ...publicUser(u, presence),
    // You always see yourself as your chosen status, even when invisible.
    status: presence.isOnline(u.id) ? (u.status as PresenceStatus) : 'offline',
    email: u.email,
    locale: u.locale,
    preferredStatus: u.status as PresenceStatus,
  };
}

export function serverDto(s: ServerRow): Server {
  return {
    id: s.id,
    name: s.name,
    icon: s.icon,
    description: s.description,
    ownerId: s.ownerId,
    isPublic: s.isPublic,
    systemChannelId: s.systemChannelId,
    createdAt: s.createdAt.toISOString(),
  };
}

export function channelDto(c: ChannelRow, ows: OverwriteRow[] = [], recipients?: PublicUser[]): Channel {
  return {
    id: c.id,
    serverId: c.serverId,
    type: c.type as Channel['type'],
    name: c.name,
    topic: c.topic,
    position: c.position,
    parentId: c.parentId,
    slowmode: c.slowmode,
    ownerId: c.ownerId,
    icon: c.icon,
    lastMessageId: c.lastMessageId,
    archived: c.archived,
    starterMessageId: c.starterMessageId,
    overwrites: ows
      .filter((o) => o.channelId === c.id)
      .map((o) => ({
        targetType: o.targetType as 'role' | 'member',
        targetId: o.targetId,
        allow: o.allow,
        deny: o.deny,
      })),
    ...(recipients ? { recipients } : {}),
    createdAt: c.createdAt.toISOString(),
  };
}

export function roleDto(r: RoleRow): Role {
  return {
    id: r.id,
    serverId: r.serverId,
    name: r.name,
    color: r.color,
    position: r.position,
    permissions: r.permissions,
    hoist: r.hoist,
    mentionable: r.mentionable,
    isDefault: r.isDefault,
  };
}
