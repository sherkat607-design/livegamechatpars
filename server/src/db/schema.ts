import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Column names are converted to snake_case by the `casing` option in db/index.ts and drizzle.config.ts.

const id = () => integer().primaryKey().generatedAlwaysAsIdentity();
const ts = () => timestamp({ withTimezone: true, mode: 'date' });
const createdAt = () => ts().defaultNow().notNull();

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text().notNull(),
    displayName: text().notNull(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    tokenVersion: integer().notNull().default(0),
    avatar: text(),
    bannerColor: text(),
    bio: text().notNull().default(''),
    status: text().notNull().default('online'),
    customStatus: text().notNull().default(''),
    activity: text().notNull().default(''),
    locale: text().notNull().default('fa'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username), uniqueIndex('users_email_uq').on(t.email)],
);

export const servers = pgTable('servers', {
  id: id(),
  name: text().notNull(),
  icon: text(),
  description: text().notNull().default(''),
  ownerId: integer()
    .notNull()
    .references(() => users.id),
  isPublic: boolean().notNull().default(false),
  systemChannelId: integer(),
  createdAt: createdAt(),
});

export const channels = pgTable(
  'channels',
  {
    id: id(),
    serverId: integer().references(() => servers.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    name: text().notNull().default(''),
    topic: text().notNull().default(''),
    position: integer().notNull().default(0),
    parentId: integer(),
    slowmode: integer().notNull().default(0),
    ownerId: integer().references(() => users.id, { onDelete: 'set null' }),
    icon: text(),
    lastMessageId: integer(),
    archived: boolean().notNull().default(false),
    starterMessageId: integer(),
    dmKey: text(),
    createdAt: createdAt(),
  },
  (t) => [index('channels_server_idx').on(t.serverId), uniqueIndex('channels_dm_key_uq').on(t.dmKey)],
);

export const channelRecipients = pgTable(
  'channel_recipients',
  {
    channelId: integer()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hidden: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] }), index('recipients_user_idx').on(t.userId)],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    color: text(),
    position: integer().notNull().default(0),
    permissions: integer().notNull().default(0),
    hoist: boolean().notNull().default(false),
    mentionable: boolean().notNull().default(false),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('roles_server_idx').on(t.serverId)],
);

export const members = pgTable(
  'members',
  {
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text(),
    joinedAt: ts().defaultNow().notNull(),
    timeoutUntil: ts(),
    notifyLevel: text().notNull().default('all'),
    muted: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.userId] }), index('members_user_idx').on(t.userId)],
);

export const memberRoles = pgTable(
  'member_roles',
  {
    serverId: integer().notNull(),
    userId: integer().notNull(),
    roleId: integer()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.serverId, t.userId, t.roleId] }),
    foreignKey({ columns: [t.serverId, t.userId], foreignColumns: [members.serverId, members.userId] }).onDelete(
      'cascade',
    ),
  ],
);

export const overwrites = pgTable(
  'permission_overwrites',
  {
    channelId: integer()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    targetType: text().notNull(),
    targetId: integer().notNull(),
    allow: integer().notNull().default(0),
    deny: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.targetType, t.targetId] })],
);

export const bans = pgTable(
  'bans',
  {
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text().notNull().default(''),
    moderatorId: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.userId] })],
);

export const invites = pgTable(
  'invites',
  {
    code: text().primaryKey(),
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    channelId: integer().references(() => channels.id, { onDelete: 'set null' }),
    inviterId: integer().references(() => users.id, { onDelete: 'set null' }),
    maxUses: integer().notNull().default(0),
    uses: integer().notNull().default(0),
    expiresAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('invites_server_idx').on(t.serverId)],
);

export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    channelId: integer()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    avatar: text(),
    token: text().notNull(),
    creatorId: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('webhooks_server_idx').on(t.serverId)],
);

export interface PollData {
  question: string;
  options: string[];
  multi: boolean;
  expiresAt: string | null;
}

export const messages = pgTable(
  'messages',
  {
    id: id(),
    channelId: integer()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    authorId: integer().references(() => users.id, { onDelete: 'set null' }),
    webhookId: integer().references(() => webhooks.id, { onDelete: 'set null' }),
    webhookName: text(),
    webhookAvatar: text(),
    type: text().notNull().default('default'),
    content: text().notNull().default(''),
    replyToId: integer(),
    threadId: integer(),
    editedAt: ts(),
    pinned: boolean().notNull().default(false),
    mentionEveryone: boolean().notNull().default(false),
    mentions: integer().array().notNull().default(sql`'{}'::integer[]`),
    mentionRoles: integer().array().notNull().default(sql`'{}'::integer[]`),
    poll: jsonb().$type<PollData>(),
    createdAt: createdAt(),
  },
  (t) => [index('messages_channel_idx').on(t.channelId, t.id), index('messages_author_idx').on(t.authorId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    messageId: integer()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    filename: text().notNull(),
    url: text().notNull(),
    contentType: text().notNull(),
    size: integer().notNull(),
  },
  (t) => [index('attachments_message_idx').on(t.messageId)],
);

export const reactions = pgTable(
  'reactions',
  {
    messageId: integer()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

export const pollVotes = pgTable(
  'poll_votes',
  {
    messageId: integer()
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    option: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.option] })],
);

export const emojis = pgTable(
  'emojis',
  {
    id: id(),
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    url: text().notNull(),
    animated: boolean().notNull().default(false),
    creatorId: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('emojis_server_name_uq').on(t.serverId, t.name)],
);

export const readStates = pgTable(
  'read_states',
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: integer()
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    lastReadId: integer().notNull().default(0),
    mentionCount: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

export const relationships = pgTable(
  'relationships',
  {
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.targetId] }), index('relationships_target_idx').on(t.targetId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    serverId: integer()
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    actorId: integer().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    targetId: integer(),
    targetType: text(),
    reason: text().notNull().default(''),
    details: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_server_idx').on(t.serverId, t.id)],
);

export type UserRow = typeof users.$inferSelect;
export type ServerRow = typeof servers.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type MemberRow = typeof members.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type OverwriteRow = typeof overwrites.$inferSelect;
