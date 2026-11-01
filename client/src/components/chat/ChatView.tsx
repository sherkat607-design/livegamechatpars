import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Menu as MenuIcon, MessageSquareText, Phone, Pin, Search, Users, X } from 'lucide-react';
import type { Channel, Message, SearchResult } from '@shared/types';
import { errorText, num, useT } from '../../i18n';
import { api } from '../../lib/api';
import { loadAround, setPinned } from '../../lib/actions';
import { messageTime } from '../../lib/format';
import { renderMarkdown } from '../../lib/markdown';
import { channelPerms, has, P, useChannelPerms } from '../../lib/perms';
import { useVoice, voice } from '../../lib/voice';
import { dmName, displayName, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { MemberList } from '../layout/MemberList';
import { channelIcon } from '../layout/ServerSidebar';
import { Avatar, cx, EmptyState, IconButton, Select, Spinner, toast } from '../ui';
import { VoiceStage } from '../voice/VoiceView';
import { Composer, sendFilesTo } from './Composer';
import { ChannelIntro, MessageList } from './MessageList';
import { useMarkdownContext } from './MessageItem';

export function TypingIndicator({ channelId, serverId }: { channelId: number; serverId: number | null }) {
  const t = useT();
  const typing = useStore((s) => s.typing[channelId]);
  const names = useMemo(() => {
    const s = useStore.getState();
    return Object.keys(typing ?? {})
      .map(Number)
      .filter((id) => id !== s.me?.id)
      .map((id) => displayName(s, id, serverId));
  }, [typing, serverId]);
  return (
    <div className="h-5 truncate px-5 text-[12px] text-text-2" aria-live="polite">
      {names.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-0.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-2" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
          {names.length === 1
            ? t('typing.one', { name: names[0] })
            : names.length === 2
              ? t('typing.two', { a: names[0], b: names[1] })
              : t('typing.many')}
        </span>
      )}
    </div>
  );
}

/** Message list + composer for one channel (used for channels, DMs and threads). */
export function ChannelPane({ channel, compactIntro }: { channel: Channel; compactIntro?: boolean }) {
  const t = useT();
  const perms = useChannelPerms(channel.id);
  const relationship = useStore((s) => {
    if (channel.type !== 'dm') return undefined;
    const other = channel.recipients?.find((u) => u.id !== s.me?.id);
    return other ? s.relationships[other.id] : undefined;
  });
  const title = useStore((s) => (channel.serverId ? channel.name : dmName(s, channel)));
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const intro = (
    <ChannelIntro
      channel={channel}
      title={channel.type === 'thread' || isDm ? title : t('chat.welcomeTo', { name: channel.name })}
      body={isDm ? t('chat.dmIntro', { name: title }) : channel.type === 'thread' ? t('chat.threadIntro') : channel.topic || t('chat.channelIntro', { name: channel.name })}
    />
  );
  const placeholder = isDm ? t('composer.placeholderDm', { name: title }) : t('composer.placeholder', { name: channel.name });
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        sendFilesTo(channel.id, [...e.dataTransfer.files]);
      }}
    >
      <MessageList channel={channel} perms={perms} intro={compactIntro ? <div className="h-4" /> : intro} />
      <TypingIndicator channelId={channel.id} serverId={channel.serverId} />
      <Composer
        channel={channel}
        perms={perms}
        placeholder={placeholder}
        blockedReason={relationship === 'blocked' ? t('composer.blocked') : channel.archived ? t('composer.archived') : null}
      />
    </div>
  );
}

export function ChatView({ channelId }: { channelId: number }) {
  const t = useT();
  const channel = useStore((s) => s.channels[channelId]);
  const me = useStore((s) => s.me);
  const ui = useUi();
  const setFocused = useStore((s) => s.setFocusedChannel);
  const perms = useChannelPerms(channelId);
  const inCall = useVoice((s) => s.channelId === channelId);
  const callers = useStore((s) => s.voiceStates[channelId]?.length ?? 0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setFocused(channelId);
    ui.setSide(null);
    return () => setFocused(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  if (!channel) return <EmptyState title={t('chat.notFound')} />;
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const other = channel.type === 'dm' ? channel.recipients?.find((u) => u.id !== me?.id) : undefined;
  const otherLive = useStore.getState().users[other?.id ?? 0] ?? other;
  const title = channel.serverId ? channel.name : dmName(useStore.getState(), channel);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-bg-0/60 px-3">
        <IconButton label={t('nav.open')} onClick={() => ui.setMobileNav(true)} className="md:hidden">
          <MenuIcon size={20} />
        </IconButton>
        {otherLive ? <Avatar user={otherLive} size={26} status={otherLive.status} ring="var(--bg-2)" /> : <span className="text-text-3">{channelIcon(channel, 22)}</span>}
        <h1 className="truncate text-[16px] font-bold text-text-1">{title}</h1>
        {channel.topic && (
          <>
            <span className="hidden h-5 w-px bg-line md:block" />
            <p className="hidden truncate text-[13px] text-text-3 md:block" title={channel.topic} dir="auto">
              {channel.topic}
            </p>
          </>
        )}
        <div className="ms-auto flex items-center gap-1">
          {isDm && (
            <IconButton
              label={inCall ? t('voice.inCall') : t('voice.startCall')}
              active={inCall || callers > 0}
              onClick={() => me && !inCall && voice.join(channel.id, me.id).catch((err) => toast(errorText({ code: err.message }), 'error'))}
            >
              <Phone size={19} />
            </IconButton>
          )}
          {!isDm && channel.type !== 'thread' && (
            <IconButton label={t('thread.list')} active={ui.side?.type === 'threads'} onClick={() => ui.setSide(ui.side?.type === 'threads' ? null : { type: 'threads' })}>
              <MessageSquareText size={19} />
            </IconButton>
          )}
          <IconButton label={t('pins.title')} active={ui.side?.type === 'pins'} onClick={() => ui.setSide(ui.side?.type === 'pins' ? null : { type: 'pins' })}>
            <Pin size={19} />
          </IconButton>
          {channel.serverId && (
            <IconButton label={t('members.toggle')} active={ui.memberList} onClick={ui.toggleMemberList} className="hidden lg:inline-flex">
              <Users size={19} />
            </IconButton>
          )}
          <form
            className="relative hidden sm:block"
            onSubmit={(e) => {
              e.preventDefault();
              ui.setSide({ type: 'search', query: search });
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              className="h-8 w-40 rounded-lg bg-bg-0/70 ps-2.5 pe-8 text-[13px] placeholder:text-text-3 focus:w-56 focus:outline-none transition-[width]"
            />
            <Search size={15} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-text-3" />
          </form>
        </div>
      </header>

      {isDm && (inCall || callers > 0) && <VoiceStage channel={channel} compact />}
      <div className="flex min-h-0 flex-1">
        <ChannelPane channel={channel} />
        {ui.side ? (
          <SidePanel channel={channel} perms={perms} />
        ) : (
          channel.serverId && ui.memberList && <MemberList serverId={channel.serverId} />
        )}
      </div>
    </div>
  );
}

function SidePanel({ channel, perms }: { channel: Channel; perms: number }) {
  const t = useT();
  const side = useUi((s) => s.side)!;
  const setSide = useUi((s) => s.setSide);
  const title =
    side.type === 'pins' ? t('pins.title') : side.type === 'search' ? t('search.title') : side.type === 'threads' ? t('thread.list') : t('thread.title');
  return (
    <aside className="flex w-full max-w-[420px] shrink-0 flex-col border-s border-bg-0/60 bg-bg-1 max-md:absolute max-md:inset-0 max-md:z-30 max-md:max-w-none">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-bg-0/60 px-3">
        <h2 className="flex-1 truncate font-semibold text-text-1">{title}</h2>
        <IconButton label={t('common.close')} onClick={() => setSide(null)}>
          <X size={18} />
        </IconButton>
      </div>
      {side.type === 'pins' && <PinsPanel channel={channel} perms={perms} />}
      {side.type === 'search' && <SearchPanel channel={channel} initial={side.query ?? ''} />}
      {side.type === 'threads' && <ThreadsPanel channel={channel} />}
      {side.type === 'thread' && <ThreadPanel threadId={side.channelId} />}
    </aside>
  );
}

function MessagePreview({ m, onJump, extra }: { m: Message; onJump: () => void; extra?: React.ReactNode }) {
  const t = useT();
  const md = useMarkdownContext(m.serverId);
  const name = useStore((s) => (m.author ? displayName(s, m.author.id, m.serverId) : (m.webhook?.name ?? t('message.deletedUser'))));
  const where = useStore((s) => s.channels[m.channelId]?.name);
  return (
    <li className="rounded-xl bg-bg-2 p-3">
      <div className="flex items-center gap-2">
        <Avatar user={m.author ?? { id: 0, displayName: name, avatar: null }} size={24} />
        <span className="font-semibold text-text-1">{name}</span>
        <span className="text-[12px] text-text-3">{messageTime(m.createdAt)}</span>
      </div>
      {where && m.serverId && <div className="mt-0.5 text-[12px] text-text-3">#{where}</div>}
      <div dir="auto" className="mt-1 line-clamp-4 text-[14px] break-words text-text-2">
        {m.content ? renderMarkdown(m.content, { ...md, inline: true }) : m.attachments.length ? t('message.attachment') : m.poll ? m.poll.question : ''}
      </div>
      <div className="mt-2 flex gap-3 text-[13px]">
        <button type="button" onClick={onJump} className="font-semibold text-accent hover:underline">
          {t('message.jump')}
        </button>
        {extra}
      </div>
    </li>
  );
}

function PinsPanel({ channel, perms }: { channel: Channel; perms: number }) {
  const t = useT();
  const [pins, setPins] = useState<Message[] | null>(null);
  const updatedPins = useStore((s) => s.messages[channel.id]?.list.filter((m) => m.pinned).length);
  useEffect(() => {
    api
      .get<Message[]>(`/api/channels/${channel.id}/pins`)
      .then(setPins)
      .catch(() => setPins([]));
  }, [channel.id, updatedPins]);
  const canUnpin = has(perms, P.MANAGE_MESSAGES) || channel.type === 'dm' || channel.type === 'group_dm';
  if (!pins) return <Loading />;
  if (pins.length === 0) return <EmptyState title={t('pins.emptyTitle')} body={t('pins.emptyBody')} />;
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      {pins.map((m) => (
        <MessagePreview
          key={m.id}
          m={m}
          onJump={() => void loadAround(channel.id, m.id)}
          extra={
            canUnpin && (
              <button
                type="button"
                className="text-text-3 hover:text-danger-text"
                onClick={async () => {
                  await setPinned(m, false);
                  setPins((p) => p?.filter((x) => x.id !== m.id) ?? null);
                }}
              >
                {t('message.unpin')}
              </button>
            )
          }
        />
      ))}
    </ul>
  );
}

function SearchPanel({ channel, initial }: { channel: Channel; initial: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const [hasFilter, setHasFilter] = useState('');
  const [scope, setScope] = useState<'server' | 'channel'>(channel.serverId ? 'server' : 'channel');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const run = async (nextOffset = 0) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (scope === 'server' && channel.serverId) params.set('serverId', String(channel.serverId));
    else params.set('channelId', String(channel.id));
    if (q.trim()) params.set('q', q.trim());
    if (hasFilter) params.set('has', hasFilter);
    params.set('offset', String(nextOffset));
    try {
      const res = await api.get<SearchResult>(`/api/search?${params}`);
      setResult(nextOffset ? { total: res.total, messages: [...(result?.messages ?? []), ...res.messages] } : res);
      setOffset(nextOffset);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setQ(initial);
  }, [initial]);
  useEffect(() => {
    void run(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, hasFilter, scope]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="flex flex-col gap-2 border-b border-bg-0/60 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(0);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="h-9 rounded-lg border border-line bg-bg-0/60 px-3 text-[14px] focus:border-accent focus:outline-none"
        />
        <div className="flex gap-2">
          {channel.serverId && (
            <Select
              value={scope}
              onChange={(v) => setScope(v as 'server' | 'channel')}
              options={[
                { value: 'server', label: t('search.wholeServer') },
                { value: 'channel', label: t('search.thisChannel') },
              ]}
              className="h-9 text-[13px]"
            />
          )}
          <Select
            value={hasFilter}
            onChange={setHasFilter}
            options={[
              { value: '', label: t('search.anything') },
              { value: 'image', label: t('search.hasImage') },
              { value: 'file', label: t('search.hasFile') },
              { value: 'link', label: t('search.hasLink') },
              { value: 'poll', label: t('search.hasPoll') },
            ]}
            className="h-9 text-[13px]"
          />
        </div>
      </form>
      {result && <div className="px-3 pt-2 text-[12px] text-text-3">{t('search.results', { count: result.total })}</div>}
      {loading && !result && <Loading />}
      {result && result.total === 0 && <EmptyState title={t('search.noneTitle')} body={t('search.noneBody')} />}
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {result?.messages.map((m) => (
          <MessagePreview
            key={m.id}
            m={m}
            onJump={() => {
              const ch = useStore.getState().channels[m.channelId];
              if (ch && ch.id !== channel.id) navigate(ch.serverId ? `/channels/${ch.serverId}/${ch.id}` : `/channels/@me/${ch.id}`);
              void loadAround(m.channelId, m.id);
            }}
          />
        ))}
        {result && result.messages.length < result.total && (
          <button type="button" onClick={() => void run(offset + 25)} className="rounded-lg py-2 text-[13px] text-accent hover:bg-hover" disabled={loading}>
            {loading ? <Spinner small /> : t('search.more')}
          </button>
        )}
      </ul>
    </div>
  );
}

function ThreadsPanel({ channel }: { channel: Channel }) {
  const t = useT();
  const setSide = useUi((s) => s.setSide);
  const open = useUi((s) => s.open);
  const [threads, setThreads] = useState<Channel[] | null>(null);
  const live = useStore((s) => Object.values(s.channels).filter((c) => c.parentId === channel.id && c.type === 'thread').length);
  const perms = useChannelPerms(channel.id);
  useEffect(() => {
    api
      .get<Channel[]>(`/api/channels/${channel.id}/threads`)
      .then((list) => {
        setThreads(list);
        list.forEach((c) => useStore.getState().upsertChannel(c));
      })
      .catch(() => setThreads([]));
  }, [channel.id, live]);
  if (!threads) return <Loading />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {has(perms, P.CREATE_THREADS) && (
        <div className="p-3">
          <button type="button" onClick={() => open({ type: 'createThread', channelId: channel.id })} className="h-9 w-full rounded-lg bg-accent text-[14px] font-semibold text-accent-ink hover:bg-accent-strong">
            {t('thread.create')}
          </button>
        </div>
      )}
      {threads.length === 0 ? (
        <EmptyState title={t('thread.emptyTitle')} body={t('thread.emptyBody')} />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {threads.map((th) => (
            <li key={th.id}>
              <button type="button" onClick={() => setSide({ type: 'thread', channelId: th.id })} className="flex w-full items-center gap-2 rounded-lg bg-bg-2 px-3 py-2.5 text-start hover:bg-bg-3">
                <MessageSquareText size={17} className={th.archived ? 'text-text-3' : 'text-accent'} />
                <span className="flex-1 truncate text-[15px] text-text-1">{th.name}</span>
                {th.archived && <span className="text-[12px] text-text-3">{t('thread.archived')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ThreadPanel({ threadId }: { threadId: number }) {
  const t = useT();
  const thread = useStore((s) => s.channels[threadId]);
  const setFocused = useStore((s) => s.setFocusedChannel);
  const [missing, setMissing] = useState(false);
  const perms = useStore((s) => channelPerms(s, s.channels[threadId]));
  const me = useStore((s) => s.me);
  useEffect(() => {
    if (!thread) {
      api
        .get<Channel>(`/api/channels/${threadId}`)
        .then((c) => useStore.getState().upsertChannel(c))
        .catch(() => setMissing(true));
    }
  }, [thread, threadId]);
  useEffect(() => {
    const prev = useStore.getState().focusedChannelId;
    setFocused(threadId);
    return () => setFocused(prev);
  }, [threadId, setFocused]);
  if (missing) return <EmptyState title={t('chat.notFound')} />;
  if (!thread) return <Loading />;
  const canArchive = thread.ownerId === me?.id || has(perms, P.MANAGE_CHANNELS);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-bg-0/60 px-3 py-2">
        <MessageSquareText size={17} className="text-accent" />
        <span className="flex-1 truncate font-semibold text-text-1">{thread.name}</span>
        {canArchive && (
          <IconButton
            label={thread.archived ? t('thread.unarchive') : t('thread.archive')}
            onClick={() =>
              api
                .patch<Channel>(`/api/channels/${thread.id}`, { archived: !thread.archived })
                .then((c) => useStore.getState().upsertChannel(c))
                .catch((err) => toast(errorText(err), 'error'))
            }
          >
            {thread.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
          </IconButton>
        )}
      </div>
      <ChannelPane channel={thread} compactIntro />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-8 text-text-3">
      <Spinner />
    </div>
  );
}

export { num, cx };
