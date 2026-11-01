import type {
  Bootstrap,
  Channel,
  CustomEmoji,
  Member,
  Message,
  PublicUser,
  ReadState,
  RelationshipType,
  Role,
  Server,
  ServerBundle,
  VoiceParticipant,
} from '@shared/types';
import { t } from '../i18n';
import { dmName, displayName, useStore } from '../store';
import { api } from './api';
import { registerEmojiUrls, plainText } from './markdown';
import { desktopNotify, setTitleBadge, sounds, startRinging, stopRinging } from './notify';
import { absolutize } from './env';
import { closeSocket, getSocket, openSocket } from './socket';
import { useVoice, voice } from './voice';

let navigateTo: (path: string) => void = () => undefined;
export function setNavigator(fn: (path: string) => void) {
  navigateTo = fn;
}

const refreshTimers = new Map<number, number>();

/** Re-fetch a server after permission-affecting changes (debounced). */
function refreshServer(id: number) {
  window.clearTimeout(refreshTimers.get(id));
  refreshTimers.set(
    id,
    window.setTimeout(async () => {
      try {
        const bundle = await api.get<ServerBundle>(`/api/servers/${id}`);
        useStore.getState().applyServerBundle(bundle);
        registerEmojiUrls(bundle.emojis);
        if (useStore.getState().membersLoaded[id]) {
          useStore.getState().setMembers(id, await api.get<Member[]>(`/api/servers/${id}/members`));
        }
      } catch {
        // lost access: a server:delete will follow
      }
    }, 250),
  );
}

export async function loadBootstrap() {
  const b = await api.get<Bootstrap>('/api/bootstrap');
  useStore.getState().bootstrap(b);
  for (const s of b.servers) registerEmojiUrls(s.emojis);
}

function mentionsMe(m: Message): boolean {
  const s = useStore.getState();
  const me = s.me;
  if (!me || m.author?.id === me.id) return false;
  if (m.mentions.includes(me.id) || m.mentionEveryone) return true;
  if (m.serverId && m.mentionRoles.length) {
    const mine = s.members[m.serverId]?.[me.id]?.roles ?? [];
    if (m.mentionRoles.some((r) => mine.includes(r))) return true;
  }
  if (m.replyTo?.author?.id === me.id) return true;
  return false;
}

function onMessage(m: Message) {
  const s = useStore.getState();
  const me = s.me;
  s.addMessage(m);
  const channel = s.channels[m.channelId];
  if (!me || !channel) return;
  if (m.author?.id === me.id) {
    s.setReadState({ channelId: m.channelId, lastReadId: m.id, mentionCount: 0 });
    return;
  }
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const looking = s.focusedChannelId === m.channelId && document.visibilityState === 'visible' && document.hasFocus();
  const pinged = isDm || mentionsMe(m);
  if (looking) return;
  if (pinged) {
    const rs = s.readStates[m.channelId];
    s.setReadState({ channelId: m.channelId, lastReadId: rs?.lastReadId ?? 0, mentionCount: (rs?.mentionCount ?? 0) + 1 });
  }
  const settings = channel.serverId ? s.servers[channel.serverId]?.settings : undefined;
  const quiet = me.status === 'dnd' || settings?.muted || settings?.notifyLevel === 'none';
  if (!pinged || quiet || m.type !== 'default') return;
  const author = m.author ? displayName(s, m.author.id, channel.serverId) : (m.webhook?.name ?? '');
  const where = isDm ? dmName(s, channel) : `#${channel.name}`;
  const body = m.content
    ? plainText(m.content, {
        userName: (id) => displayName(s, id, channel.serverId),
        role: (id) => s.servers[channel.serverId ?? 0]?.roles.find((r) => r.id === id) ?? null,
        channelName: (id) => s.channels[id]?.name ?? null,
      })
    : t('notify.attachment');
  sounds.message();
  desktopNotify(
    isDm ? author : `${author} — ${where}`,
    body,
    m.author?.avatar ?? null,
    () => navigateTo(channel.serverId ? `/channels/${channel.serverId}/${channel.id}` : `/channels/@me/${channel.id}`),
    `ch-${channel.id}`,
  );
}

export function startRealtime() {
  const socket = openSocket();
  const store = useStore.getState;
  // Every server event passes through absolutize (media URLs in the app build).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = (event: string, fn: (data: any) => void) => socket.on(event, (data: unknown) => fn(absolutize(data)));

  on('ready', async () => {
    try {
      await loadBootstrap();
      store().setConnected(true);
      // If we were in a voice channel, rejoin it after a reconnect.
      const vc = useVoice.getState().channelId;
      if (vc && store().me) {
        await voice.leave(false);
        await voice.join(vc, store().me!.id).catch(() => undefined);
      }
    } catch {
      // the 401 handler takes over
    }
  });
  on('disconnect', () => store().setConnected(false));
  on('connect_error', () => store().setConnected(false));

  on('message:create', (m: Message) => onMessage(m));
  on('message:update', (m: Message) => store().updateMessage(m));
  on('message:delete', (e: { id: number; channelId: number }) => store().deleteMessage(e.channelId, e.id));
  on('message:thread', (e: { messageId: number; channelId: number; thread: { id: number; name: string } }) =>
    store().patchMessage(e.channelId, e.messageId, { thread: e.thread }),
  );
  on('reaction:add', (e) => store().reaction(e, true));
  on('reaction:remove', (e) => store().reaction(e, false));
  on('poll:update', (e) => store().pollUpdate(e));
  on('typing', (e: { channelId: number; userId: number }) => {
    if (e.userId !== store().me?.id) store().setTyping(e.channelId, e.userId);
  });

  on('user:update', (u: PublicUser) => store().upsertUsers([u]));
  on('server:create', (b: ServerBundle) => {
    store().applyServerBundle(b);
    registerEmojiUrls(b.emojis);
  });
  on('server:update', (sv: Server) => store().updateServer(sv));
  on('server:delete', (e: { id: number; reason?: string }) => {
    const wasHere = window.location.pathname.startsWith(`/channels/${e.id}`);
    store().removeServer(e.id);
    if (wasHere) navigateTo('/channels/@me');
    const vc = useVoice.getState().channelId;
    if (vc && !store().channels[vc]) void voice.leave(false);
  });
  on('server:refresh', (e: { id: number }) => refreshServer(e.id));
  on('channel:create', (c: Channel) => store().upsertChannel(c));
  on('channel:update', (c: Channel) => store().upsertChannel(c));
  on('channel:delete', (e: { id: number }) => store().removeChannel(e.id));
  on('roles:update', (e: { serverId: number; roles: Role[] }) => store().setRoles(e.serverId, e.roles));
  on('emojis:update', (e: { serverId: number; emojis: CustomEmoji[] }) => {
    store().setEmojis(e.serverId, e.emojis);
    registerEmojiUrls(e.emojis);
  });
  on('member:add', (m: Member) => store().upsertMember(m));
  on('member:update', (m: Member) => store().upsertMember(m));
  on('member:remove', (e: { serverId: number; userId: number }) => store().removeMember(e.serverId, e.userId));
  on('relationship:update', (e: { userId: number; type: RelationshipType | null; user: PublicUser }) =>
    store().setRelationship(e.userId, e.type, e.user),
  );
  on('readstate:update', (rs: ReadState) => store().setReadState(rs));
  on('readstate:bulk', (list: ReadState[]) => list.forEach((rs) => store().setReadState(rs)));
  on('settings:update', (e: { serverId: number; notifyLevel: 'all' | 'mentions' | 'none'; muted: boolean }) =>
    store().setSettings(e.serverId, { notifyLevel: e.notifyLevel, muted: e.muted }),
  );

  on('voice:state', (e: { channelId: number; participants: VoiceParticipant[] }) => {
    const before = store().voiceStates[e.channelId] ?? [];
    store().setVoiceState(e.channelId, e.participants);
    if (useVoice.getState().channelId === e.channelId) {
      voice.onVoiceState(e.participants);
      const me = store().me?.id;
      const joined = e.participants.filter((p) => p.userId !== me && !before.some((b) => b.userId === p.userId));
      const left = before.filter((b) => b.userId !== me && !e.participants.some((p) => p.userId === b.userId));
      if (joined.length) sounds.join();
      if (left.length) sounds.leave();
    }
    const incoming = useVoice.getState().incoming;
    if (incoming?.channelId === e.channelId && !e.participants.some((p) => p.userId === incoming.from)) {
      useVoice.setState({ incoming: null });
      stopRinging();
    }
  });
  on('voice:signal', (e: { from: number; data: unknown }) => void voice.onSignal(e.from, e.data as never));
  on('voice:kicked', () => void voice.leave(false));
  on('call:ring', (e: { channelId: number; from: number }) => {
    if (useVoice.getState().channelId === e.channelId || store().me?.status === 'dnd') return;
    useVoice.setState({ incoming: e });
    startRinging();
    window.setTimeout(() => {
      if (useVoice.getState().incoming?.channelId === e.channelId) {
        useVoice.setState({ incoming: null });
        stopRinging();
      }
    }, 30000);
  });

  // Expire typing indicators.
  const typingTimer = window.setInterval(() => {
    const now = Date.now();
    const { typing, clearTyping } = store();
    for (const [ch, users] of Object.entries(typing)) {
      for (const [uid, until] of Object.entries(users)) if (until < now) clearTyping(Number(ch), Number(uid));
    }
  }, 2000);

  // Mentions + DM unread count in the tab title.
  const unsubscribe = useStore.subscribe((s) => {
    let count = 0;
    for (const [id, rs] of Object.entries(s.readStates)) {
      const ch = s.channels[Number(id)];
      if (!ch) continue;
      const settings = ch.serverId ? s.servers[ch.serverId]?.settings : undefined;
      if (settings?.notifyLevel === 'none') continue;
      count += rs.mentionCount;
    }
    const pending = Object.values(s.relationships).filter((r) => r === 'incoming').length;
    setTitleBadge(count + pending, t('app.title'));
  });

  // Idle after 10 minutes without input.
  let idle = false;
  let lastActive = Date.now();
  const markActive = () => {
    lastActive = Date.now();
    if (idle) {
      idle = false;
      getSocket()?.emit('idle', false);
    }
  };
  const events = ['mousemove', 'keydown', 'pointerdown', 'focus'] as const;
  events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
  const idleTimer = window.setInterval(() => {
    if (!idle && Date.now() - lastActive > 10 * 60_000) {
      idle = true;
      getSocket()?.emit('idle', true);
    }
  }, 30_000);

  return () => {
    window.clearInterval(typingTimer);
    window.clearInterval(idleTimer);
    events.forEach((e) => window.removeEventListener(e, markActive));
    unsubscribe();
    void voice.leave();
    closeSocket();
  };
}
