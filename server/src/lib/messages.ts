import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Attachment, Message, MessageType, Poll, ReactionSummary } from '@shared/types';
import {
  attachments,
  channels,
  memberRoles,
  members,
  messages,
  pollVotes,
  reactions,
  readStates,
  roles,
  users,
  type ChannelRow,
  type MessageRow,
  type PollData,
  type UserRow,
} from '../db/schema';
import type { AppContext } from '../context';
import { filterViewers } from './access';
import { publicUser } from './serialize';
import type { StoredFile } from './uploads';

const MAX_REACTION_USERS = 100;

/** Turn message rows into API objects, loading everything they reference in a few queries. */
export async function hydrateMessages(app: AppContext, rows: MessageRow[], viewerId: number): Promise<Message[]> {
  if (rows.length === 0) return [];
  const { db, presence } = app;
  const ids = rows.map((m) => m.id);
  const replyIds = [...new Set(rows.map((m) => m.replyToId).filter((x): x is number => x !== null))];
  const threadIds = [...new Set(rows.map((m) => m.threadId).filter((x): x is number => x !== null))];
  const channelIds = [...new Set(rows.map((m) => m.channelId))];
  const pollIds = rows.filter((m) => m.poll).map((m) => m.id);

  const [replies, files, reacts, threads, chans, votes] = await Promise.all([
    replyIds.length ? db.select().from(messages).where(inArray(messages.id, replyIds)) : [],
    db.select().from(attachments).where(inArray(attachments.messageId, ids)),
    db
      .select({ messageId: reactions.messageId, emoji: reactions.emoji, userId: reactions.userId })
      .from(reactions)
      .where(inArray(reactions.messageId, ids))
      .orderBy(reactions.createdAt),
    threadIds.length ? db.select().from(channels).where(inArray(channels.id, threadIds)) : [],
    db.select({ id: channels.id, serverId: channels.serverId }).from(channels).where(inArray(channels.id, channelIds)),
    pollIds.length ? db.select().from(pollVotes).where(inArray(pollVotes.messageId, pollIds)) : [],
  ]);

  const userIds = new Set<number>();
  for (const m of [...rows, ...replies]) if (m.authorId) userIds.add(m.authorId);
  const userRows: UserRow[] = userIds.size ? await db.select().from(users).where(inArray(users.id, [...userIds])) : [];
  const userMap = new Map(userRows.map((u) => [u.id, publicUser(u, presence)]));
  const replyMap = new Map(replies.map((r) => [r.id, r]));
  const replyFiles = replyIds.length
    ? new Set(
        (await db.select({ messageId: attachments.messageId }).from(attachments).where(inArray(attachments.messageId, replyIds))).map(
          (a) => a.messageId,
        ),
      )
    : new Set<number>();
  const threadMap = new Map(threads.map((t) => [t.id, t]));
  const serverOf = new Map(chans.map((c) => [c.id, c.serverId]));

  const filesBy = new Map<number, Attachment[]>();
  for (const f of files) {
    const list = filesBy.get(f.messageId) ?? [];
    list.push({ id: f.id, filename: f.filename, url: f.url, contentType: f.contentType, size: f.size });
    filesBy.set(f.messageId, list);
  }

  const reactBy = new Map<number, Map<string, number[]>>();
  for (const r of reacts) {
    const perMsg = reactBy.get(r.messageId) ?? new Map<string, number[]>();
    const list = perMsg.get(r.emoji) ?? [];
    list.push(r.userId);
    perMsg.set(r.emoji, list);
    reactBy.set(r.messageId, perMsg);
  }

  const votesBy = new Map<number, { option: number; userId: number }[]>();
  for (const v of votes) {
    const list = votesBy.get(v.messageId) ?? [];
    list.push(v);
    votesBy.set(v.messageId, list);
  }

  return rows.map((m) => {
    const reply = m.replyToId ? replyMap.get(m.replyToId) : undefined;
    const thread = m.threadId ? threadMap.get(m.threadId) : undefined;
    const reactions: ReactionSummary[] = [...(reactBy.get(m.id) ?? new Map()).entries()].map(([emoji, list]) => ({
      emoji,
      count: list.length,
      me: list.includes(viewerId),
      users: list.slice(0, MAX_REACTION_USERS),
    }));
    return {
      id: m.id,
      channelId: m.channelId,
      serverId: serverOf.get(m.channelId) ?? null,
      type: m.type as MessageType,
      author: m.authorId ? (userMap.get(m.authorId) ?? null) : null,
      webhook: m.webhookId || m.webhookName ? { id: m.webhookId ?? 0, name: m.webhookName ?? 'Webhook', avatar: m.webhookAvatar } : null,
      content: m.content,
      replyToId: m.replyToId,
      replyTo: reply
        ? {
            id: reply.id,
            author: reply.authorId ? (userMap.get(reply.authorId) ?? null) : null,
            webhookName: reply.webhookName,
            content: reply.content.slice(0, 300),
            hasAttachments: replyFiles.has(reply.id),
          }
        : null,
      thread: thread ? { id: thread.id, name: thread.name } : null,
      editedAt: m.editedAt?.toISOString() ?? null,
      pinned: m.pinned,
      mentionEveryone: m.mentionEveryone,
      mentions: m.mentions,
      mentionRoles: m.mentionRoles,
      attachments: filesBy.get(m.id) ?? [],
      reactions,
      poll: m.poll ? pollDto(m.poll, votesBy.get(m.id) ?? [], viewerId) : null,
      createdAt: m.createdAt.toISOString(),
    } satisfies Message;
  });
}

export function pollDto(poll: PollData, votes: { option: number; userId: number }[], viewerId: number): Poll {
  const counts = poll.options.map(() => 0);
  const voters = new Set<number>();
  const mine: number[] = [];
  for (const v of votes) {
    if (v.option >= 0 && v.option < counts.length) counts[v.option]++;
    voters.add(v.userId);
    if (v.userId === viewerId) mine.push(v.option);
  }
  return {
    question: poll.question,
    options: poll.options.map((text, i) => ({ text, votes: counts[i] })),
    multi: poll.multi,
    expiresAt: poll.expiresAt,
    totalVoters: voters.size,
    myVotes: mine.sort((a, b) => a - b),
  };
}

export interface ParsedMentions {
  users: number[];
  roles: number[];
  everyone: boolean;
}

export function parseMentions(content: string): ParsedMentions {
  const usersFound = new Set<number>();
  const rolesFound = new Set<number>();
  for (const m of content.matchAll(/<@(\d{1,10})>/g)) usersFound.add(Number(m[1]));
  for (const m of content.matchAll(/<@&(\d{1,10})>/g)) rolesFound.add(Number(m[1]));
  // Ignore @everyone inside inline code or code blocks.
  const withoutCode = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const everyone = /(^|[^\w])@(everyone|here)\b/.test(withoutCode);
  return { users: [...usersFound].slice(0, 50), roles: [...rolesFound].slice(0, 20), everyone };
}

/** Handle the /roll dice command; returns the new content or null. */
export function rollDice(content: string, random = Math.random): string | null {
  const m = /^\/roll(?:\s+(\d{1,2})?d(\d{1,4}))?\s*$/i.exec(content.trim());
  if (!m) return null;
  const count = Math.min(Math.max(Number(m[1] ?? 1), 1), 20);
  const sides = Math.min(Math.max(Number(m[2] ?? 6), 2), 1000);
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0);
  return `🎲 **${count}d${sides}** → ${rolls.join(' + ')}${count > 1 ? ` = **${total}**` : ''}`;
}

export interface CreateMessageInput {
  channel: ChannelRow;
  authorId: number | null;
  webhook?: { id: number; name: string; avatar: string | null };
  content: string;
  type?: MessageType;
  replyToId?: number | null;
  /** Ping the author of the replied message. */
  mentionReplied?: boolean;
  files?: StoredFile[];
  poll?: PollData | null;
  /** Whether the author may use @everyone / mention any role. */
  canMentionEveryone?: boolean;
  /** DM recipients (for DMs and group DMs). */
  recipientIds?: number[];
  /** Client-generated id echoed back for optimistic UI. */
  nonce?: string;
}

/** Keep only mentions that point at people and roles in this channel's scope. */
export async function resolveMentions(
  app: AppContext,
  channel: ChannelRow,
  content: string,
  canMentionEveryone: boolean,
  recipientIds?: number[],
): Promise<ParsedMentions> {
  const { db } = app;
  const parsed = parseMentions(content);
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    return { users: parsed.users.filter((id) => recipientIds?.includes(id)), roles: [], everyone: false };
  }
  if (!channel.serverId) return { users: [], roles: [], everyone: false };
  let mentionUsers: number[] = [];
  let mentionRoleIds: number[] = [];
  if (parsed.users.length) {
    const rows = await db
      .select({ userId: members.userId })
      .from(members)
      .where(and(eq(members.serverId, channel.serverId), inArray(members.userId, parsed.users)));
    mentionUsers = rows.map((r) => r.userId);
  }
  if (parsed.roles.length) {
    const rows = await db
      .select()
      .from(roles)
      .where(and(eq(roles.serverId, channel.serverId), inArray(roles.id, parsed.roles)));
    mentionRoleIds = rows.filter((r) => !r.isDefault && (r.mentionable || canMentionEveryone)).map((r) => r.id);
  }
  return { users: mentionUsers, roles: mentionRoleIds, everyone: parsed.everyone && canMentionEveryone };
}

/** Insert a message, update read states and mention counts, and broadcast it. */
export async function createMessage(app: AppContext, input: CreateMessageInput): Promise<Message> {
  const { db, gateway } = app;
  const { channel } = input;
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const resolved =
    input.type && input.type !== 'default'
      ? { users: [], roles: [], everyone: false }
      : await resolveMentions(app, channel, input.content, !!input.canMentionEveryone, input.recipientIds);
  const mentionUsers = resolved.users;
  const mentionRoleIds = resolved.roles;
  const everyone = resolved.everyone;

  const row = await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(messages)
      .values({
        channelId: channel.id,
        authorId: input.authorId,
        webhookId: input.webhook?.id ?? null,
        webhookName: input.webhook?.name ?? null,
        webhookAvatar: input.webhook?.avatar ?? null,
        type: input.type ?? 'default',
        content: input.content,
        replyToId: input.replyToId ?? null,
        mentionEveryone: everyone,
        mentions: mentionUsers,
        mentionRoles: mentionRoleIds,
        poll: input.poll ?? null,
      })
      .returning();
    if (input.files?.length) {
      await tx.insert(attachments).values(
        input.files.map((f) => ({
          messageId: msg.id,
          filename: f.filename,
          url: f.url,
          contentType: f.contentType,
          size: f.size,
        })),
      );
    }
    await tx.update(channels).set({ lastMessageId: msg.id }).where(eq(channels.id, channel.id));
    if (input.authorId) {
      await tx
        .insert(readStates)
        .values({ userId: input.authorId, channelId: channel.id, lastReadId: msg.id, mentionCount: 0 })
        .onConflictDoUpdate({
          target: [readStates.userId, readStates.channelId],
          set: { lastReadId: msg.id, mentionCount: 0 },
        });
    }
    return msg;
  });
  channel.lastMessageId = row.id;
  if (input.authorId) gateway.clearTypingThrottle(input.authorId, channel.id);

  // Who gets a mention badge.
  const pinged = new Set<number>();
  if (isDm) {
    for (const id of input.recipientIds ?? []) pinged.add(id);
  } else if (channel.serverId) {
    for (const id of mentionUsers) pinged.add(id);
    if (mentionRoleIds.length) {
      const holders = await db
        .select({ userId: memberRoles.userId })
        .from(memberRoles)
        .where(and(eq(memberRoles.serverId, channel.serverId), inArray(memberRoles.roleId, mentionRoleIds)));
      for (const h of holders) pinged.add(h.userId);
    }
    if (everyone) {
      const all = await db.select({ userId: members.userId }).from(members).where(eq(members.serverId, channel.serverId));
      for (const m of all) pinged.add(m.userId);
    }
    if (input.replyToId && input.mentionReplied !== false) {
      const [target] = await db.select({ authorId: messages.authorId }).from(messages).where(eq(messages.id, input.replyToId));
      if (target?.authorId) pinged.add(target.authorId);
    }
  }
  if (input.authorId) pinged.delete(input.authorId);
  let targets = [...pinged];
  if (!isDm && targets.length) targets = await filterViewers(db, channel, targets);
  if (targets.length) {
    await db
      .insert(readStates)
      .values(targets.map((userId) => ({ userId, channelId: channel.id, lastReadId: 0, mentionCount: 1 })))
      .onConflictDoUpdate({
        target: [readStates.userId, readStates.channelId],
        set: { mentionCount: sql`${readStates.mentionCount} + 1` },
      });
  }

  const [hydrated] = await hydrateMessages(app, [row], input.authorId ?? 0);
  const dto: Message = input.nonce ? { ...hydrated, nonce: input.nonce } : hydrated;
  if (isDm) await gateway.revealDm(channel.id, input.recipientIds ?? []);
  await gateway.toChannel(channel, 'message:create', dto, input.recipientIds);
  return dto;
}
