import { create } from 'zustand';
import type {
  Bootstrap,
  Channel,
  ClientConfig,
  CustomEmoji,
  Member,
  MemberSettings,
  Message,
  PublicUser,
  ReadState,
  RelationshipType,
  Role,
  SelfUser,
  Server,
  ServerBundle,
  VoiceParticipant,
} from '@shared/types';

export interface ServerEntry {
  server: Server;
  roles: Role[];
  emojis: CustomEmoji[];
  settings: MemberSettings;
  memberCount: number;
}

export interface PendingMessage extends Message {
  pending?: boolean;
  failed?: boolean;
}

export interface ChannelMessages {
  list: PendingMessage[];
  /** More history exists above the first message. */
  hasMore: boolean;
  /** The list does not reach the newest message (after jumping to an old one). */
  hasNewer: boolean;
  loading: boolean;
  loaded: boolean;
}

const EMPTY_MESSAGES: ChannelMessages = { list: [], hasMore: true, hasNewer: false, loading: false, loaded: false };

// Selectors must return stable values: use these instead of `?? []` inside useStore(...).
export const NO_PARTICIPANTS: VoiceParticipant[] = [];
export const NO_ROLES: Role[] = [];
export const NO_EMOJIS: CustomEmoji[] = [];
const MAX_KEPT = 300;

interface State {
  ready: boolean;
  me: SelfUser | null;
  config: ClientConfig;
  users: Record<number, PublicUser>;
  servers: Record<number, ServerEntry>;
  serverOrder: number[];
  channels: Record<number, Channel>;
  members: Record<number, Record<number, Member>>;
  membersLoaded: Record<number, boolean>;
  relationships: Record<number, RelationshipType>;
  readStates: Record<number, ReadState>;
  messages: Record<number, ChannelMessages>;
  typing: Record<number, Record<number, number>>;
  voiceStates: Record<number, VoiceParticipant[]>;
  /** Channel currently on screen (for read state and notifications). */
  focusedChannelId: number | null;
  connected: boolean;
}

interface Actions {
  bootstrap: (b: Bootstrap) => void;
  reset: () => void;
  setConnected: (v: boolean) => void;
  setFocusedChannel: (id: number | null) => void;
  setMe: (u: SelfUser) => void;
  upsertUsers: (users: PublicUser[]) => void;
  applyServerBundle: (b: ServerBundle) => void;
  removeServer: (id: number) => void;
  updateServer: (s: Server) => void;
  setRoles: (serverId: number, roles: Role[]) => void;
  setEmojis: (serverId: number, emojis: CustomEmoji[]) => void;
  setSettings: (serverId: number, settings: MemberSettings) => void;
  upsertChannel: (c: Channel) => void;
  removeChannel: (id: number) => void;
  setMembers: (serverId: number, members: Member[]) => void;
  upsertMember: (m: Member) => void;
  removeMember: (serverId: number, userId: number) => void;
  setRelationship: (userId: number, type: RelationshipType | null, user?: PublicUser) => void;
  setReadState: (rs: ReadState) => void;
  setMessages: (channelId: number, list: Message[], opts: { mode: 'replace' | 'prepend' | 'append'; hasMore?: boolean; hasNewer?: boolean }) => void;
  setMessagesLoading: (channelId: number, loading: boolean) => void;
  addMessage: (m: PendingMessage) => void;
  replaceMessage: (channelId: number, id: number, m: PendingMessage) => void;
  updateMessage: (m: Message) => void;
  patchMessage: (channelId: number, id: number, patch: Partial<PendingMessage>) => void;
  deleteMessage: (channelId: number, id: number) => void;
  reaction: (e: { messageId: number; channelId: number; emoji: string; userId: number }, add: boolean) => void;
  pollUpdate: (e: { messageId: number; channelId: number; counts: number[]; totalVoters: number; voterId: number; voterOptions: number[] }) => void;
  setTyping: (channelId: number, userId: number) => void;
  clearTyping: (channelId: number, userId: number) => void;
  setVoiceState: (channelId: number, participants: VoiceParticipant[]) => void;
}

const initial: State = {
  ready: false,
  me: null,
  config: { iceServers: [], maxUploadMB: 25 },
  users: {},
  servers: {},
  serverOrder: [],
  channels: {},
  members: {},
  membersLoaded: {},
  relationships: {},
  readStates: {},
  messages: {},
  typing: {},
  voiceStates: {},
  focusedChannelId: null,
  connected: false,
};

function withUser(users: Record<number, PublicUser>, u: PublicUser | null | undefined) {
  if (!u) return users;
  return { ...users, [u.id]: u };
}

function sortMessages(list: PendingMessage[]): PendingMessage[] {
  return [...list].sort((a, b) => {
    if (a.pending && !b.pending) return 1;
    if (!a.pending && b.pending) return -1;
    return a.id - b.id;
  });
}

export const useStore = create<State & Actions>()((set, get) => ({
  ...initial,

  bootstrap: (b) => {
    const users: Record<number, PublicUser> = {};
    const servers: Record<number, ServerEntry> = {};
    const channels: Record<number, Channel> = {};
    const members: Record<number, Record<number, Member>> = {};
    users[b.user.id] = b.user;
    for (const s of b.servers) {
      servers[s.server.id] = { server: s.server, roles: s.roles, emojis: s.emojis, settings: s.settings, memberCount: s.memberCount };
      for (const c of s.channels) channels[c.id] = c;
      members[s.server.id] = { [b.user.id]: s.member };
    }
    for (const d of b.dms) {
      channels[d.id] = d;
      for (const u of d.recipients ?? []) users[u.id] = u;
    }
    const relationships: Record<number, RelationshipType> = {};
    for (const r of b.relationships) {
      relationships[r.user.id] = r.type;
      users[r.user.id] = r.user;
    }
    const readStates: Record<number, ReadState> = {};
    for (const r of b.readStates) readStates[r.channelId] = r;
    const voiceStates: Record<number, VoiceParticipant[]> = {};
    for (const p of b.voiceStates) (voiceStates[p.channelId] ??= []).push(p);
    set({
      ready: true,
      me: b.user,
      config: b.config,
      users: { ...get().users, ...users },
      servers,
      serverOrder: b.servers.map((s) => s.server.id),
      channels,
      members,
      membersLoaded: {},
      relationships,
      readStates,
      voiceStates,
      // Keep loaded message history across reconnects; it is refreshed when viewed.
      messages: Object.fromEntries(Object.entries(get().messages).map(([k, v]) => [k, { ...v, loaded: false }])),
    });
  },

  reset: () => set({ ...initial }),
  setConnected: (connected) => set({ connected }),
  setFocusedChannel: (focusedChannelId) => set({ focusedChannelId }),

  setMe: (me) => set((s) => ({ me, users: withUser(s.users, me) })),

  upsertUsers: (list) =>
    set((s) => {
      const users = { ...s.users };
      let me = s.me;
      for (const u of list) {
        users[u.id] = u;
        if (me && u.id === me.id) me = { ...me, ...u, status: me.status, preferredStatus: me.preferredStatus };
      }
      return { users, me };
    }),

  applyServerBundle: (b) =>
    set((s) => {
      const channels = { ...s.channels };
      for (const c of Object.values(channels)) if (c.serverId === b.server.id) delete channels[c.id];
      for (const c of b.channels) channels[c.id] = c;
      const me = s.me!;
      return {
        servers: {
          ...s.servers,
          [b.server.id]: { server: b.server, roles: b.roles, emojis: b.emojis, settings: b.settings, memberCount: b.memberCount },
        },
        serverOrder: s.serverOrder.includes(b.server.id) ? s.serverOrder : [...s.serverOrder, b.server.id],
        channels,
        members: { ...s.members, [b.server.id]: { ...(s.members[b.server.id] ?? {}), [me.id]: b.member } },
        users: withUser(s.users, b.member.user),
      };
    }),

  removeServer: (id) =>
    set((s) => {
      const servers = { ...s.servers };
      delete servers[id];
      const channels = Object.fromEntries(Object.entries(s.channels).filter(([, c]) => c.serverId !== id));
      const members = { ...s.members };
      delete members[id];
      return { servers, channels, members, serverOrder: s.serverOrder.filter((x) => x !== id) };
    }),

  updateServer: (server) =>
    set((s) => (s.servers[server.id] ? { servers: { ...s.servers, [server.id]: { ...s.servers[server.id], server } } } : {})),

  setRoles: (serverId, roles) =>
    set((s) => (s.servers[serverId] ? { servers: { ...s.servers, [serverId]: { ...s.servers[serverId], roles } } } : {})),

  setEmojis: (serverId, emojis) =>
    set((s) => (s.servers[serverId] ? { servers: { ...s.servers, [serverId]: { ...s.servers[serverId], emojis } } } : {})),

  setSettings: (serverId, settings) =>
    set((s) => (s.servers[serverId] ? { servers: { ...s.servers, [serverId]: { ...s.servers[serverId], settings } } } : {})),

  upsertChannel: (c) =>
    set((s) => {
      if (c.serverId && !s.servers[c.serverId]) return {};
      const users = { ...s.users };
      for (const u of c.recipients ?? []) users[u.id] = u;
      // Archived threads leave the sidebar.
      if (c.type === 'thread' && c.archived) {
        const channels = { ...s.channels, [c.id]: c };
        return { channels, users };
      }
      return { channels: { ...s.channels, [c.id]: c }, users };
    }),

  removeChannel: (id) =>
    set((s) => {
      const channels = { ...s.channels };
      delete channels[id];
      return { channels };
    }),

  setMembers: (serverId, list) =>
    set((s) => {
      const users = { ...s.users };
      const map: Record<number, Member> = {};
      for (const m of list) {
        map[m.userId] = m;
        users[m.userId] = m.user;
      }
      return { members: { ...s.members, [serverId]: map }, membersLoaded: { ...s.membersLoaded, [serverId]: true }, users };
    }),

  upsertMember: (m) =>
    set((s) => {
      const isNew = !s.members[m.serverId]?.[m.userId];
      const entry = s.servers[m.serverId];
      return {
        members: { ...s.members, [m.serverId]: { ...(s.members[m.serverId] ?? {}), [m.userId]: m } },
        users: withUser(s.users, m.user),
        servers:
          entry && isNew && s.membersLoaded[m.serverId]
            ? { ...s.servers, [m.serverId]: { ...entry, memberCount: entry.memberCount + 1 } }
            : s.servers,
      };
    }),

  removeMember: (serverId, userId) =>
    set((s) => {
      const map = { ...(s.members[serverId] ?? {}) };
      const existed = !!map[userId];
      delete map[userId];
      const entry = s.servers[serverId];
      return {
        members: { ...s.members, [serverId]: map },
        servers: entry && existed ? { ...s.servers, [serverId]: { ...entry, memberCount: Math.max(1, entry.memberCount - 1) } } : s.servers,
      };
    }),

  setRelationship: (userId, type, user) =>
    set((s) => {
      const relationships = { ...s.relationships };
      if (type) relationships[userId] = type;
      else delete relationships[userId];
      return { relationships, users: withUser(s.users, user) };
    }),

  setReadState: (rs) => set((s) => ({ readStates: { ...s.readStates, [rs.channelId]: rs } })),

  setMessages: (channelId, list, { mode, hasMore, hasNewer }) =>
    set((s) => {
      const prev = s.messages[channelId] ?? EMPTY_MESSAGES;
      const users = { ...s.users };
      for (const m of list) if (m.author) users[m.author.id] = m.author;
      let merged: PendingMessage[];
      if (mode === 'replace') {
        const pending = prev.list.filter((m) => m.pending || m.failed);
        merged = [...list, ...pending];
      } else {
        const ids = new Set(prev.list.map((m) => m.id));
        const fresh = list.filter((m) => !ids.has(m.id));
        merged = mode === 'prepend' ? [...fresh, ...prev.list] : [...prev.list, ...fresh];
      }
      return {
        users,
        messages: {
          ...s.messages,
          [channelId]: {
            list: sortMessages(merged),
            hasMore: hasMore ?? prev.hasMore,
            hasNewer: hasNewer ?? (mode === 'replace' ? false : prev.hasNewer),
            loading: false,
            loaded: true,
          },
        },
      };
    }),

  setMessagesLoading: (channelId, loading) =>
    set((s) => ({ messages: { ...s.messages, [channelId]: { ...(s.messages[channelId] ?? EMPTY_MESSAGES), loading } } })),

  addMessage: (m) =>
    set((s) => {
      const prev = s.messages[m.channelId];
      const channel = s.channels[m.channelId];
      const updates: Partial<State> = { users: withUser(s.users, m.author) };
      if (channel && !m.pending) {
        updates.channels = { ...s.channels, [m.channelId]: { ...channel, lastMessageId: Math.max(channel.lastMessageId ?? 0, m.id) } };
      }
      if (prev?.loaded && !prev.hasNewer) {
        let list = prev.list;
        const pendingIdx = m.nonce ? list.findIndex((x) => x.pending && x.nonce === m.nonce) : -1;
        if (pendingIdx >= 0) list = list.filter((_, i) => i !== pendingIdx);
        if (!list.some((x) => x.id === m.id && !x.pending)) {
          list = sortMessages([...list, m]);
          if (list.length > MAX_KEPT) list = list.slice(list.length - MAX_KEPT);
          updates.messages = {
            ...s.messages,
            [m.channelId]: { ...prev, list, hasMore: prev.hasMore || list.length >= MAX_KEPT },
          };
        }
      }
      if (m.author) {
        const typing = s.typing[m.channelId];
        if (typing?.[m.author.id]) {
          const next = { ...typing };
          delete next[m.author.id];
          updates.typing = { ...s.typing, [m.channelId]: next };
        }
      }
      return updates;
    }),

  replaceMessage: (channelId, id, m) =>
    set((s) => {
      const prev = s.messages[channelId];
      if (!prev) return {};
      const without = prev.list.filter((x) => x.id !== id && !(x.id === m.id && !x.pending));
      return { messages: { ...s.messages, [channelId]: { ...prev, list: sortMessages([...without, m]) } } };
    }),

  updateMessage: (m) =>
    set((s) => {
      const prev = s.messages[m.channelId];
      if (!prev) return {};
      return {
        messages: {
          ...s.messages,
          [m.channelId]: {
            ...prev,
            list: prev.list.map((x) => {
              if (x.id !== m.id) return x;
              // Poll "my votes" and reaction "me" are per viewer: keep the local view.
              const myId = s.me?.id;
              const reactions = m.reactions.map((r) => ({ ...r, me: myId ? r.users.includes(myId) : r.me }));
              return { ...m, reactions, poll: m.poll && x.poll ? { ...m.poll, myVotes: x.poll.myVotes } : m.poll };
            }),
          },
        },
      };
    }),

  patchMessage: (channelId, id, patch) =>
    set((s) => {
      const prev = s.messages[channelId];
      if (!prev) return {};
      return { messages: { ...s.messages, [channelId]: { ...prev, list: prev.list.map((x) => (x.id === id ? { ...x, ...patch } : x)) } } };
    }),

  deleteMessage: (channelId, id) =>
    set((s) => {
      const prev = s.messages[channelId];
      if (!prev) return {};
      return {
        messages: {
          ...s.messages,
          [channelId]: {
            ...prev,
            list: prev.list
              .filter((x) => x.id !== id)
              .map((x) => (x.replyTo?.id === id ? { ...x, replyTo: null } : x)),
          },
        },
      };
    }),

  reaction: (e, add) =>
    set((s) => {
      const prev = s.messages[e.channelId];
      if (!prev) return {};
      const myId = s.me?.id;
      return {
        messages: {
          ...s.messages,
          [e.channelId]: {
            ...prev,
            list: prev.list.map((m) => {
              if (m.id !== e.messageId) return m;
              const existing = m.reactions.find((r) => r.emoji === e.emoji);
              let reactions = m.reactions;
              if (add) {
                if (existing?.users.includes(e.userId)) return m;
                reactions = existing
                  ? m.reactions.map((r) =>
                      r.emoji === e.emoji ? { ...r, count: r.count + 1, users: [...r.users, e.userId], me: r.me || e.userId === myId } : r,
                    )
                  : [...m.reactions, { emoji: e.emoji, count: 1, users: [e.userId], me: e.userId === myId }];
              } else {
                if (!existing || !existing.users.includes(e.userId)) return m;
                reactions = m.reactions
                  .map((r) =>
                    r.emoji === e.emoji
                      ? { ...r, count: r.count - 1, users: r.users.filter((u) => u !== e.userId), me: e.userId === myId ? false : r.me }
                      : r,
                  )
                  .filter((r) => r.count > 0);
              }
              return { ...m, reactions };
            }),
          },
        },
      };
    }),

  pollUpdate: (e) =>
    set((s) => {
      const prev = s.messages[e.channelId];
      if (!prev) return {};
      const myId = s.me?.id;
      return {
        messages: {
          ...s.messages,
          [e.channelId]: {
            ...prev,
            list: prev.list.map((m) =>
              m.id === e.messageId && m.poll
                ? {
                    ...m,
                    poll: {
                      ...m.poll,
                      options: m.poll.options.map((o, i) => ({ ...o, votes: e.counts[i] ?? 0 })),
                      totalVoters: e.totalVoters,
                      myVotes: e.voterId === myId ? e.voterOptions : m.poll.myVotes,
                    },
                  }
                : m,
            ),
          },
        },
      };
    }),

  setTyping: (channelId, userId) =>
    set((s) => ({ typing: { ...s.typing, [channelId]: { ...(s.typing[channelId] ?? {}), [userId]: Date.now() + 9000 } } })),

  clearTyping: (channelId, userId) =>
    set((s) => {
      const t = s.typing[channelId];
      if (!t?.[userId]) return {};
      const next = { ...t };
      delete next[userId];
      return { typing: { ...s.typing, [channelId]: next } };
    }),

  setVoiceState: (channelId, participants) => set((s) => ({ voiceStates: { ...s.voiceStates, [channelId]: participants } })),
}));

export const emptyMessages = EMPTY_MESSAGES;

// ---------- derived helpers (pure functions over state) ----------

type S = State & Actions;

export function serverChannels(s: S, serverId: number): Channel[] {
  return Object.values(s.channels)
    .filter((c) => c.serverId === serverId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

export function isUnread(s: S, channel: Channel): boolean {
  if (!channel.lastMessageId) return false;
  if (channel.type === 'voice' || channel.type === 'category') return false;
  return channel.lastMessageId > (s.readStates[channel.id]?.lastReadId ?? 0);
}

export function mentionCount(s: S, channelId: number): number {
  return s.readStates[channelId]?.mentionCount ?? 0;
}

/** Unread / mention summary for a server, honoring its notification settings. */
export function serverUnread(s: S, serverId: number): { unread: boolean; mentions: number } {
  const entry = s.servers[serverId];
  if (!entry) return { unread: false, mentions: 0 };
  let unread = false;
  let mentions = 0;
  for (const c of Object.values(s.channels)) {
    if (c.serverId !== serverId) continue;
    mentions += mentionCount(s, c.id);
    if (!unread && isUnread(s, c)) unread = true;
  }
  if (entry.settings.notifyLevel === 'none') mentions = 0;
  if (entry.settings.muted || entry.settings.notifyLevel !== 'all') unread = false;
  return { unread, mentions };
}

export function displayName(s: S, userId: number, serverId?: number | null): string {
  const member = serverId ? s.members[serverId]?.[userId] : undefined;
  return member?.nickname || s.users[userId]?.displayName || s.users[userId]?.username || '…';
}

/** The color of a member's highest colored role. */
export function roleColor(s: S, serverId: number | null | undefined, userId: number): string | undefined {
  if (!serverId) return undefined;
  const member = s.members[serverId]?.[userId];
  const entry = s.servers[serverId];
  if (!member || !entry) return undefined;
  let best: Role | undefined;
  for (const r of entry.roles) {
    if (r.color && member.roles.includes(r.id) && (!best || r.position > best.position)) best = r;
  }
  return best?.color ?? undefined;
}

export function dmName(s: S, channel: Channel): string {
  if (channel.type === 'group_dm' && channel.name) return channel.name;
  const others = (channel.recipients ?? []).filter((u) => u.id !== s.me?.id);
  return others.map((u) => s.users[u.id]?.displayName ?? u.displayName).join('، ') || channel.name || '…';
}
