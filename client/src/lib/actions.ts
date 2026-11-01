import type { Channel, Member, Message, Poll, SelfUser, ServerBundle } from '@shared/types';
import { errorText, t } from '../i18n';
import { useStore, type PendingMessage } from '../store';
import { useUi } from '../store/ui';
import { toast } from '../components/ui';
import { api, ApiError } from './api';
import { setToken } from './env';
import { loadEmojis } from './emoji';
import { registerEmojiUrls } from './markdown';

const PAGE = 50;

export async function loadLatest(channelId: number) {
  const s = useStore.getState();
  s.setMessagesLoading(channelId, true);
  try {
    const list = await api.get<Message[]>(`/api/channels/${channelId}/messages?limit=${PAGE}`);
    s.setMessages(channelId, list, { mode: 'replace', hasMore: list.length === PAGE, hasNewer: false });
  } catch (err) {
    s.setMessagesLoading(channelId, false);
    throw err;
  }
}

export async function loadOlder(channelId: number) {
  const s = useStore.getState();
  const state = s.messages[channelId];
  if (!state || state.loading || !state.hasMore) return;
  const first = state.list.find((m) => !m.pending);
  if (!first) return;
  s.setMessagesLoading(channelId, true);
  try {
    const list = await api.get<Message[]>(`/api/channels/${channelId}/messages?limit=${PAGE}&before=${first.id}`);
    s.setMessages(channelId, list, { mode: 'prepend', hasMore: list.length === PAGE });
  } catch {
    s.setMessagesLoading(channelId, false);
  }
}

export async function loadNewer(channelId: number) {
  const s = useStore.getState();
  const state = s.messages[channelId];
  if (!state || state.loading || !state.hasNewer) return;
  const last = [...state.list].reverse().find((m) => !m.pending);
  if (!last) return;
  s.setMessagesLoading(channelId, true);
  try {
    const list = await api.get<Message[]>(`/api/channels/${channelId}/messages?limit=${PAGE}&after=${last.id}`);
    s.setMessages(channelId, list, { mode: 'append', hasNewer: list.length === PAGE });
  } catch {
    s.setMessagesLoading(channelId, false);
  }
}

/** Load a window of history around a message (jump to reply / search result / pin). */
export async function loadAround(channelId: number, messageId: number) {
  const s = useStore.getState();
  const loaded = s.messages[channelId]?.list.some((m) => m.id === messageId);
  if (!loaded) {
    const list = await api.get<Message[]>(`/api/channels/${channelId}/messages?limit=${PAGE}&around=${messageId}`);
    s.setMessages(channelId, list, { mode: 'replace', hasMore: true, hasNewer: true });
  }
  useUi.getState().jumpTo(channelId, messageId);
}

let nonceCounter = 0;

export interface Outgoing {
  content: string;
  files?: File[];
  replyTo?: Message | null;
  mentionReplied?: boolean;
  poll?: { question: string; options: string[]; multi: boolean; durationHours: number };
  onProgress?: (fraction: number) => void;
}

/** Send with an optimistic "pending" message that is swapped for the real one. */
export async function sendMessage(channelId: number, out: Outgoing): Promise<boolean> {
  const s = useStore.getState();
  const me = s.me!;
  const nonce = `${Date.now()}-${++nonceCounter}`;
  const tempId = -Date.now() - nonceCounter;
  const channel = s.channels[channelId];
  const pending: PendingMessage = {
    id: tempId,
    channelId,
    serverId: channel?.serverId ?? null,
    type: 'default',
    author: me,
    webhook: null,
    content: out.content,
    replyTo: out.replyTo
      ? { id: out.replyTo.id, author: out.replyTo.author, webhookName: out.replyTo.webhook?.name ?? null, content: out.replyTo.content, hasAttachments: out.replyTo.attachments.length > 0 }
      : null,
    replyToId: out.replyTo?.id ?? null,
    thread: null,
    editedAt: null,
    pinned: false,
    mentionEveryone: false,
    mentions: [],
    mentionRoles: [],
    attachments: (out.files ?? []).map((f, i) => ({ id: -i - 1, filename: f.name, url: '', contentType: f.type, size: f.size })),
    reactions: [],
    poll: null,
    createdAt: new Date().toISOString(),
    nonce,
    pending: true,
  };
  if (!out.poll) s.addMessage(pending);
  const payload = {
    content: out.content,
    replyToId: out.replyTo?.id ?? null,
    mentionReplied: out.mentionReplied,
    poll: out.poll,
    nonce,
  };
  try {
    let real: Message;
    if (out.files?.length) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      for (const f of out.files) form.append('files', f, f.name);
      real = await api.upload<Message>('POST', `/api/channels/${channelId}/messages`, form, out.onProgress);
    } else {
      real = await api.post<Message>(`/api/channels/${channelId}/messages`, payload);
    }
    useStore.getState().replaceMessage(channelId, tempId, real);
    return true;
  } catch (err) {
    useStore.getState().deleteMessage(channelId, tempId);
    if (err instanceof ApiError && err.code === 'slowmode') {
      toast(t('error.slowmode', { seconds: Number(err.data.retryAfter ?? 0) }), 'error');
    } else toast(errorText(err), 'error');
    return false;
  }
}

export async function editMessage(m: Message, content: string) {
  try {
    const updated = await api.patch<Message>(`/api/messages/${m.id}`, { content });
    useStore.getState().updateMessage(updated);
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

export async function deleteMessage(m: Message) {
  try {
    await api.del(`/api/messages/${m.id}`);
    useStore.getState().deleteMessage(m.channelId, m.id);
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

export async function toggleReaction(m: Message, emoji: string) {
  const me = useStore.getState().me!.id;
  const existing = m.reactions.find((r) => r.emoji === emoji);
  const mine = existing?.users.includes(me);
  const path = `/api/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`;
  // Apply right away; the server event confirms it.
  useStore.getState().reaction({ messageId: m.id, channelId: m.channelId, emoji, userId: me }, !mine);
  try {
    if (mine) await api.del(path);
    else await api.put(path);
  } catch (err) {
    useStore.getState().reaction({ messageId: m.id, channelId: m.channelId, emoji, userId: me }, !!mine);
    toast(errorText(err), 'error');
  }
}

export async function setPinned(m: Message, pinned: boolean) {
  try {
    if (pinned) await api.put(`/api/messages/${m.id}/pin`);
    else await api.del(`/api/messages/${m.id}/pin`);
    toast(pinned ? t('pins.pinned') : t('pins.unpinned'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

export async function vote(m: Message, options: number[]) {
  try {
    const poll = await api.put<Poll>(`/api/messages/${m.id}/poll/votes`, { options });
    useStore.getState().patchMessage(m.channelId, m.id, { poll });
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

const acked = new Map<number, number>();

/** Mark a channel read up to its newest message (skips redundant calls). */
export function ack(channelId: number) {
  const s = useStore.getState();
  const channel = s.channels[channelId];
  const last = channel?.lastMessageId ?? 0;
  const rs = s.readStates[channelId];
  if (!last || ((rs?.lastReadId ?? 0) >= last && !(rs?.mentionCount ?? 0))) return;
  if (acked.get(channelId) === last) return;
  acked.set(channelId, last);
  s.setReadState({ channelId, lastReadId: last, mentionCount: 0 });
  api.post(`/api/channels/${channelId}/ack`, { messageId: last }).catch(() => acked.delete(channelId));
}

export async function ackServer(serverId: number) {
  await api.post(`/api/servers/${serverId}/ack`);
}

export async function loadMembers(serverId: number, force = false) {
  const s = useStore.getState();
  if (s.membersLoaded[serverId] && !force) return;
  const list = await api.get<Member[]>(`/api/servers/${serverId}/members`);
  useStore.getState().setMembers(serverId, list);
}

export async function joinInvite(code: string): Promise<ServerBundle> {
  const bundle = await api.post<ServerBundle>(`/api/invites/${code}`);
  useStore.getState().applyServerBundle(bundle);
  registerEmojiUrls(bundle.emojis);
  return bundle;
}

/** Open (or create) a DM with a user and return its channel. */
export async function openDm(userId: number): Promise<Channel | null> {
  try {
    const channel = await api.post<Channel>('/api/dms', { recipientIds: [userId] });
    useStore.getState().upsertChannel(channel);
    return channel;
  } catch (err) {
    toast(errorText(err), 'error');
    return null;
  }
}

export async function updateProfile(patch: Record<string, unknown>): Promise<boolean> {
  try {
    const { user } = await api.patch<{ user: SelfUser }>('/api/users/me', patch);
    useStore.getState().setMe(user);
    return true;
  } catch (err) {
    toast(errorText(err), 'error');
    return false;
  }
}

export async function logout() {
  await api.post('/api/auth/logout').catch(() => undefined);
  setToken(null);
  window.location.href = '/login';
}

/** Turn what the user typed into wire format: mentions, channels and :emoji: shortcodes. */
export async function encodeOutgoing(text: string, serverId: number | null, extra: Map<string, string>): Promise<string> {
  const s = useStore.getState();
  let out = text;
  // Mentions picked from autocomplete (exact display strings).
  for (const [display, token] of [...extra.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(display).join(token);
  }
  const members = serverId ? Object.values(s.members[serverId] ?? {}) : [];
  const dmUsers = !serverId && s.focusedChannelId ? (s.channels[s.focusedChannelId]?.recipients ?? []) : [];
  out = out.replace(/(^|[\s(])@([a-z0-9_.]{2,32})\b/g, (all, pre: string, name: string) => {
    if (name === 'everyone' || name === 'here') return all;
    const m = members.find((x) => x.user.username === name.toLowerCase());
    if (m) return `${pre}<@${m.userId}>`;
    const u = dmUsers.find((x) => x.username === name.toLowerCase());
    return u ? `${pre}<@${u.id}>` : all;
  });
  if (serverId) {
    out = out.replace(/(^|\s)#([\p{L}\p{N}_‌-]{1,100})/gu, (all, pre: string, name: string) => {
      const ch = Object.values(s.channels).find((c) => c.serverId === serverId && c.name === name && c.type !== 'category');
      return ch ? `${pre}<#${ch.id}>` : all;
    });
  }
  if (/:[a-z0-9_+-]{2,40}:/i.test(out)) {
    const emojis = await loadEmojis();
    const custom = serverId ? (s.servers[serverId]?.emojis ?? []) : Object.values(s.servers).flatMap((x) => x.emojis);
    out = out.replace(/(?<![<a-z0-9]):([a-zA-Z0-9_+-]{2,40}):(?!\d)/g, (all, name: string) => {
      const c = custom.find((e) => e.name === name);
      if (c) return `<${c.animated ? 'a' : ''}:${c.name}:${c.id}>`;
      return emojis.byShortcode.get(name.toLowerCase()) ?? all;
    });
  }
  return out;
}

/** Built-in slash commands handled on the client. */
export function applySlashCommand(text: string): { text: string; command?: 'poll' } {
  const m = /^\/(\w+)\s*([\s\S]*)$/.exec(text);
  if (!m) return { text };
  const [, cmd, rest] = m;
  switch (cmd.toLowerCase()) {
    case 'shrug':
      // One escaped underscore keeps "_(ツ)_" from turning into italics.
      return { text: `${rest} ¯\\_(ツ)_/¯`.trim() };
    case 'tableflip':
      return { text: `${rest} (╯°□°)╯︵ ┻━┻`.trim() };
    case 'unflip':
      return { text: `${rest} ┬─┬ノ( º _ ºノ)`.trim() };
    case 'me':
      return { text: rest ? `_${rest}_` : '' };
    case 'spoiler':
      return { text: rest ? `||${rest}||` : '' };
    case 'poll':
      return { text: '', command: 'poll' };
    default:
      return { text };
  }
}

export const SLASH_COMMANDS = ['roll', 'poll', 'shrug', 'tableflip', 'unflip', 'me', 'spoiler'] as const;
