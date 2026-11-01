import { memo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Phone,
  Pin,
  PinOff,
  SmilePlus,
  Trash2,
  UserPlus,
  UserMinus,
  ArrowRight,
} from 'lucide-react';
import type { Attachment, Channel, Message } from '@shared/types';
import { num, useLang, useT } from '../../i18n';
import { deleteMessage, editMessage, encodeOutgoing, loadAround, setPinned, toggleReaction, vote } from '../../lib/actions';
import { QUICK_REACTIONS, pushRecentEmoji } from '../../lib/emoji';
import { fileSize, fullDate, messageTime, relative, shortTime } from '../../lib/format';
import { renderMarkdown, type MarkdownContext } from '../../lib/markdown';
import { has, P } from '../../lib/perms';
import { displayName, roleColor, useStore, type PendingMessage } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, confirmDialog, cx, Menu, Popover, type Anchor } from '../ui';
import { EmojiPicker } from './EmojiPicker';

export function useMarkdownContext(serverId: number | null): MarkdownContext {
  const showProfile = useUi((s) => s.showProfile);
  const me = useStore((s) => s.me?.id);
  const navigate = useNavigate();
  return {
    userName: (id) => displayName(useStore.getState(), id, serverId),
    role: (id) => useStore.getState().servers[serverId ?? 0]?.roles.find((r) => r.id === id) ?? null,
    channelName: (id) => useStore.getState().channels[id]?.name ?? null,
    isMe: (id) => id === me,
    onUser: (id, el) => {
      const r = el.getBoundingClientRect();
      showProfile(id, serverId, { x: r.left, y: r.top, w: r.width, h: r.height });
    },
    onChannel: (id) => {
      const ch = useStore.getState().channels[id];
      if (ch?.serverId) navigate(`/channels/${ch.serverId}/${ch.id}`);
    },
  };
}

function ReactionEmoji({ emoji }: { emoji: string }) {
  const custom = /^([a-zA-Z0-9_]{2,32}):(\d+)$/.exec(emoji);
  const url = useStore((s) => {
    if (!custom) return null;
    for (const entry of Object.values(s.servers)) {
      const e = entry.emojis.find((x) => x.id === Number(custom[2]));
      if (e) return e.url;
    }
    return null;
  });
  if (custom) return url ? <img src={url} alt={`:${custom[1]}:`} className="h-[18px] w-[18px] object-contain" /> : <span>:{custom[1]}:</span>;
  return <span className="text-[16px] leading-none">{emoji}</span>;
}

function AttachmentView({ a }: { a: Attachment }) {
  const t = useT();
  const open = useUi((s) => s.open);
  if (!a.url) {
    return (
      <div className="flex w-fit max-w-full items-center gap-3 rounded-xl border border-line bg-bg-1 px-3 py-2 opacity-70">
        <FileText size={28} className="shrink-0 text-text-3" />
        <span className="truncate text-[14px]">{a.filename}</span>
      </div>
    );
  }
  if (a.contentType.startsWith('image/')) {
    return (
      <button type="button" onClick={() => open({ type: 'lightbox', url: a.url, filename: a.filename })} className="block w-fit max-w-full overflow-hidden rounded-xl">
        <img src={a.url} alt={a.filename} loading="lazy" className="max-h-[350px] max-w-[min(100%,480px)] object-contain" />
      </button>
    );
  }
  if (a.contentType.startsWith('video/')) {
    return <video src={a.url} controls preload="metadata" className="max-h-[360px] max-w-[min(100%,520px)] rounded-xl bg-black" />;
  }
  if (a.contentType.startsWith('audio/')) {
    return (
      <div className="w-fit max-w-full rounded-xl border border-line bg-bg-1 p-2">
        <div className="mb-1 truncate px-1 text-[13px] text-text-2">{a.filename}</div>
        <audio src={a.url} controls preload="metadata" className="max-w-full" />
      </div>
    );
  }
  return (
    <div className="flex w-fit max-w-full items-center gap-3 rounded-xl border border-line bg-bg-1 px-3 py-2.5">
      <FileText size={30} className="shrink-0 text-accent" />
      <div className="min-w-0">
        <a href={a.url} download={a.filename} className="block truncate text-[14px] font-medium text-accent hover:underline" dir="auto">
          {a.filename}
        </a>
        <div className="text-[12px] text-text-3">{fileSize(a.size)}</div>
      </div>
      <a href={a.url} download={a.filename} aria-label={t('message.download')} title={t('message.download')} className="text-text-2 hover:text-text-1">
        <Download size={20} />
      </a>
    </div>
  );
}

function PollView({ m }: { m: Message }) {
  const t = useT();
  useLang();
  const poll = m.poll!;
  const closed = !!poll.expiresAt && new Date(poll.expiresAt).getTime() < Date.now();
  const total = Math.max(1, poll.totalVoters);
  const choose = (i: number) => {
    if (closed) return;
    const mine = poll.myVotes;
    let next: number[];
    if (poll.multi) next = mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i];
    else next = mine.includes(i) ? [] : [i];
    void vote(m, next);
  };
  return (
    <div className="mt-1 w-full max-w-[440px] rounded-xl border border-line bg-bg-1 p-3">
      <div className="font-bold text-text-1" dir="auto">
        {poll.question}
      </div>
      <div className="mb-2 text-[12px] text-text-3">{poll.multi ? t('poll.multi') : t('poll.single')}</div>
      <div className="flex flex-col gap-1.5">
        {poll.options.map((o, i) => {
          const pct = Math.round((o.votes / total) * 100);
          const mine = poll.myVotes.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={closed}
              onClick={() => choose(i)}
              aria-pressed={mine}
              className={cx(
                'relative overflow-hidden rounded-lg border px-3 py-2 text-start text-[14px]',
                mine ? 'border-accent' : 'border-line hover:border-text-3',
              )}
            >
              <span className="absolute inset-y-0 start-0 bg-accent-soft transition-[width]" style={{ width: `${pct}%` }} aria-hidden="true" />
              <span className="relative flex items-center gap-2">
                {mine && <Check size={15} className="text-accent" />}
                <span className="flex-1" dir="auto">
                  {o.text}
                </span>
                <span className="text-[12px] text-text-3">
                  {num(pct)}٪ ({num(o.votes)})
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 text-[12px] text-text-3">
        <span>{t('poll.voters', { count: poll.totalVoters })}</span>
        <span>{closed ? t('poll.closed') : poll.expiresAt ? t('poll.endsIn', { time: relative(poll.expiresAt) }) : ''}</span>
      </div>
    </div>
  );
}

const WELCOME_KEYS = ['system.join1', 'system.join2', 'system.join3', 'system.join4', 'system.join5'];

function SystemMessage({ m, channel }: { m: Message; channel: Channel }) {
  const t = useT();
  const name = useStore((s) => (m.author ? displayName(s, m.author.id, channel.serverId) : t('message.deletedUser')));
  const threadName = useStore((s) => (m.type === 'thread_created' ? s.channels[Number(m.content)]?.name : undefined));
  const setSide = useUi((s) => s.setSide);
  const target = /^(add|remove):(\d+)$/.exec(m.content);
  const targetName = useStore((s) => (target ? displayName(s, Number(target[2]), null) : ''));
  let icon = <ArrowRight size={16} className="text-accent" />;
  let text: React.ReactNode = '';
  switch (m.type) {
    case 'join':
      text = t(WELCOME_KEYS[m.id % WELCOME_KEYS.length], { name });
      break;
    case 'pin':
      icon = <Pin size={16} className="text-text-3" />;
      text = (
        <>
          {t('system.pinned', { name })}{' '}
          <button type="button" className="font-medium text-text-1 hover:underline" onClick={() => setSide({ type: 'pins' })}>
            {t('system.seePins')}
          </button>
        </>
      );
      break;
    case 'thread_created':
      icon = <MessageSquareText size={16} className="text-text-3" />;
      text = (
        <>
          {t('system.threadCreated', { name })}{' '}
          <button type="button" className="font-medium text-text-1 hover:underline" onClick={() => setSide({ type: 'thread', channelId: Number(m.content) })}>
            {threadName ?? '…'}
          </button>
        </>
      );
      break;
    case 'call':
      icon = <Phone size={16} className="text-accent" />;
      text = t('system.call', { name });
      break;
    case 'system':
      if (m.content === 'leave') {
        icon = <UserMinus size={16} className="text-danger-text" />;
        text = t('system.left', { name });
      } else if (target?.[1] === 'add') {
        icon = <UserPlus size={16} className="text-accent" />;
        text = t('system.added', { name, target: targetName });
      } else if (target?.[1] === 'remove') {
        icon = <UserMinus size={16} className="text-danger-text" />;
        text = t('system.removed', { name, target: targetName });
      }
      break;
  }
  return (
    <div className="flex items-center gap-3 px-4 py-1 text-[14px] text-text-3">
      <span className="flex w-10 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1">{text}</span>
      <time dateTime={m.createdAt} title={fullDate(m.createdAt)} className="shrink-0 text-[12px]">
        {messageTime(m.createdAt)}
      </time>
    </div>
  );
}

interface Props {
  m: PendingMessage;
  compact: boolean;
  channel: Channel;
  perms: number;
  highlighted: boolean;
}

export const MessageItem = memo(function MessageItem({ m, compact, channel, perms, highlighted }: Props) {
  const t = useT();
  const me = useStore((s) => s.me);
  const serverId = channel.serverId;
  const authorName = useStore((s) => (m.author ? displayName(s, m.author.id, serverId) : (m.webhook?.name ?? t('message.deletedUser'))));
  const color = useStore((s) => (m.author ? roleColor(s, serverId, m.author.id) : undefined));
  const liveAuthor = useStore((s) => (m.author ? (s.users[m.author.id] ?? m.author) : null));
  const myRoles = useStore((s) => (serverId && me ? s.members[serverId]?.[me.id]?.roles : undefined));
  const replyName = useStore((s) => (m.replyTo?.author ? displayName(s, m.replyTo.author.id, serverId) : (m.replyTo?.webhookName ?? '')));
  const ui = useUi();
  const md = useMarkdownContext(serverId);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [picker, setPicker] = useState<Anchor | null>(null);
  const editing = ui.editing === m.id;

  if (m.type !== 'default') return <SystemMessage m={m} channel={channel} />;

  const mine = !!me && m.author?.id === me.id;
  const mentioned =
    !!me &&
    !mine &&
    (m.mentions.includes(me.id) || m.mentionEveryone || m.replyTo?.author?.id === me.id || (myRoles ?? []).some((r) => m.mentionRoles.includes(r)));
  const canManage = has(perms, P.MANAGE_MESSAGES);
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const canThread = !isDm && channel.type !== 'thread' && has(perms, P.CREATE_THREADS) && !m.thread;
  // Without "Add reactions" you can still join existing reactions, but not start new ones.
  const canReact = has(perms, P.ADD_REACTIONS);
  const openProfile = (el: HTMLElement) => {
    if (!m.author) return;
    const r = el.getBoundingClientRect();
    ui.showProfile(m.author.id, serverId, { x: r.left, y: r.top, w: r.width, h: r.height });
  };

  const react = (emoji: string) => {
    pushRecentEmoji(emoji);
    void toggleReaction(m, emoji);
  };

  return (
    <div
      id={`msg-${m.id}`}
      className={cx(
        'group relative px-4 transition-colors',
        compact ? 'py-0.5' : 'mt-3 pt-1 pb-0.5',
        mentioned ? 'border-s-2 border-[var(--mention-line)] bg-[var(--mention-bg)]' : 'border-s-2 border-transparent hover:bg-hover',
        highlighted && 'bg-accent-soft',
        m.pending && 'opacity-60',
      )}
    >
      {m.replyTo && (
        <button
          type="button"
          onClick={() => void loadAround(m.channelId, m.replyTo!.id)}
          className="mb-0.5 ms-12 flex max-w-full items-center gap-1.5 text-start text-[13px] text-text-3 hover:text-text-2"
        >
          <CornerUpLeft size={14} className="shrink-0 rtl:-scale-x-100" />
          <Avatar user={m.replyTo.author ?? { id: 0, displayName: replyName, avatar: null }} size={16} />
          <span className="shrink-0 font-semibold text-text-2">{replyName}</span>
          <span className="truncate" dir="auto">
            {m.replyTo.content ? renderMarkdown(m.replyTo.content, { ...md, inline: true }) : m.replyTo.hasAttachments ? t('message.attachment') : ''}
          </span>
        </button>
      )}
      {!m.replyTo && m.replyToId && !compact && (
        <div className="mb-0.5 ms-12 flex items-center gap-1.5 text-[13px] italic text-text-3">
          <CornerUpLeft size={14} className="rtl:-scale-x-100" /> {t('message.originalDeleted')}
        </div>
      )}

      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {compact ? (
            <time
              dateTime={m.createdAt}
              title={fullDate(m.createdAt)}
              className="hidden pt-1 text-center text-[11px] leading-5 text-text-3 group-hover:block"
            >
              {shortTime(m.createdAt)}
            </time>
          ) : (
            <button type="button" onClick={(e) => openProfile(e.currentTarget)} className="mt-0.5 rounded-full" aria-label={authorName}>
              <Avatar user={liveAuthor ?? { id: m.webhook?.id ?? 0, displayName: authorName, avatar: m.webhook?.avatar ?? null }} size={40} />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!compact && (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <button
                type="button"
                onClick={(e) => openProfile(e.currentTarget)}
                className="font-semibold hover:underline"
                style={{ color: color ?? 'var(--text-1)' }}
              >
                {authorName}
              </button>
              {m.webhook && <span className="rounded bg-accent px-1 text-[10px] font-bold leading-4 text-accent-ink">{t('message.bot')}</span>}
              <time dateTime={m.createdAt} title={fullDate(m.createdAt)} className="text-[12px] text-text-3">
                {messageTime(m.createdAt)}
              </time>
            </div>
          )}

          {editing ? (
            <EditBox m={m} serverId={serverId} onDone={() => ui.setEditing(null)} />
          ) : (
            m.content && (
              <div className="break-words whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere] [unicode-bidi:plaintext] rtl:text-right ltr:text-left">
                {renderMarkdown(m.content, md)}
                {m.editedAt && (
                  <span title={fullDate(m.editedAt)} className="ms-1 text-[11px] text-text-3">
                    ({t('message.edited')})
                  </span>
                )}
              </div>
            )
          )}

          {m.attachments.length > 0 && (
            <div className="mt-1 flex flex-col gap-1.5">
              {m.attachments.map((a) => (
                <AttachmentView key={a.id} a={a} />
              ))}
            </div>
          )}

          {m.poll && <PollView m={m} />}

          {m.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {m.reactions.map((r) => {
                const meIn = !!me && r.users.includes(me.id);
                const names = r.users.slice(0, 10).map((id) => displayName(useStore.getState(), id, serverId));
                return (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => react(r.emoji)}
                    aria-pressed={meIn}
                    title={names.join('، ') + (r.count > 10 ? ` +${num(r.count - 10)}` : '')}
                    className={cx(
                      'flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[13px]',
                      meIn ? 'border-accent bg-accent-soft text-text-1' : 'border-transparent bg-bg-1 text-text-2 hover:border-line',
                    )}
                  >
                    <ReactionEmoji emoji={r.emoji} />
                    <span className="font-medium">{num(r.count)}</span>
                  </button>
                );
              })}
              {canReact && (
              <button
                  type="button"
                  aria-label={t('message.addReaction')}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPicker({ x: r.left, y: r.top, w: r.width, h: r.height });
                  }}
                  className="flex h-7 items-center rounded-lg bg-bg-1 px-2 text-text-3 opacity-0 transition group-hover:opacity-100 hover:text-text-1 focus:opacity-100"
                >
                  <SmilePlus size={16} />
                </button>
              )}
            </div>
          )}

          {m.thread && (
            <button
              type="button"
              onClick={() => ui.setSide({ type: 'thread', channelId: m.thread!.id })}
              className="mt-1 flex w-fit items-center gap-2 rounded-lg border border-line bg-bg-1 px-3 py-1.5 text-[13px] text-text-2 hover:border-accent"
            >
              <MessageSquareText size={15} className="text-accent" />
              <span className="font-semibold text-text-1">{m.thread.name}</span>
              <span>{t('thread.open')}</span>
            </button>
          )}
        </div>
      </div>

      {!m.pending && !editing && (
        <div className="absolute -top-4 end-4 z-10 hidden items-center rounded-lg border border-line bg-bg-3 p-0.5 shadow group-hover:flex group-focus-within:flex">
          {canReact && QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button key={e} type="button" aria-label={t('message.reactWith', { emoji: e })} onClick={() => react(e)} className="flex h-8 w-8 items-center justify-center rounded-md text-[17px] hover:bg-hover">
              {e}
            </button>
          ))}
          {canReact && (
            <ToolButton
              label={t('message.addReaction')}
              onClick={(el) => {
                const r = el.getBoundingClientRect();
                setPicker({ x: r.left, y: r.top, w: r.width, h: r.height });
              }}
            >
              <SmilePlus size={17} />
            </ToolButton>
          )}
          {has(perms, P.SEND_MESSAGES) && (
            <ToolButton label={t('message.reply')} onClick={() => ui.setReply(m.channelId, m)}>
              <CornerUpLeft size={17} className="rtl:-scale-x-100" />
            </ToolButton>
          )}
          {canThread && (
            <ToolButton label={t('thread.create')} onClick={() => ui.open({ type: 'createThread', channelId: m.channelId, message: m })}>
              <MessageSquareText size={17} />
            </ToolButton>
          )}
          {mine && !m.webhook && (
            <ToolButton label={t('message.edit')} onClick={() => ui.setEditing(m.id)}>
              <Pencil size={16} />
            </ToolButton>
          )}
          <ToolButton
            label={t('common.more')}
            onClick={(el) => {
              const r = el.getBoundingClientRect();
              setMenu({ x: r.left, y: r.top, w: r.width, h: r.height });
            }}
          >
            <MoreHorizontal size={17} />
          </ToolButton>
        </div>
      )}

      <Popover anchor={picker} onClose={() => setPicker(null)} placement="below">
        <EmojiPicker
          serverId={serverId}
          onPick={(e) => {
            setPicker(null);
            react(e.reaction);
          }}
        />
      </Popover>
      <Menu
        anchor={menu}
        onClose={() => setMenu(null)}
        items={[
          { label: t('message.reply'), icon: <CornerUpLeft size={16} />, hidden: !has(perms, P.SEND_MESSAGES), onSelect: () => ui.setReply(m.channelId, m) },
          { label: t('message.edit'), icon: <Pencil size={16} />, hidden: !mine, onSelect: () => ui.setEditing(m.id) },
          {
            label: m.pinned ? t('message.unpin') : t('message.pin'),
            icon: m.pinned ? <PinOff size={16} /> : <Pin size={16} />,
            hidden: !(canManage || isDm),
            onSelect: () => void setPinned(m, !m.pinned),
          },
          { label: t('thread.create'), icon: <MessageSquareText size={16} />, hidden: !canThread, onSelect: () => ui.open({ type: 'createThread', channelId: m.channelId, message: m }) },
          { label: t('message.copyText'), icon: <Copy size={16} />, hidden: !m.content, onSelect: () => void navigator.clipboard?.writeText(m.content) },
          'divider',
          {
            label: t('message.delete'),
            icon: <Trash2 size={16} />,
            danger: true,
            hidden: !(mine || canManage),
            onSelect: async () => {
              const ok = await confirmDialog({ title: t('message.deleteTitle'), body: t('message.deleteBody'), confirmText: t('message.delete'), danger: true });
              if (ok) void deleteMessage(m);
            },
          },
        ]}
      />
    </div>
  );
});

function ToolButton({ label, onClick, children }: { label: string; onClick: (el: HTMLElement) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => onClick(e.currentTarget)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-hover hover:text-text-1"
    >
      {children}
    </button>
  );
}

function EditBox({ m, serverId, onDone }: { m: Message; serverId: number | null; onDone: () => void }) {
  const t = useT();
  const [text, setText] = useState(m.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
    }
  }, [text]);
  const save = async () => {
    const trimmed = text.trim();
    if (trimmed === m.content.trim()) return onDone();
    if (!trimmed && m.attachments.length === 0) {
      if (await confirmDialog({ title: t('message.deleteTitle'), body: t('message.deleteBody'), confirmText: t('message.delete'), danger: true })) await deleteMessage(m);
      return onDone();
    }
    await editMessage(m, await encodeOutgoing(trimmed, serverId, new Map()));
    onDone();
  };
  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={text}
        dir="auto"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
        className="w-full resize-none rounded-lg border border-line bg-bg-3 px-3 py-2 text-text-1 focus:border-accent focus:outline-none"
      />
      <p className="text-[12px] text-text-3">{t('message.editHint')}</p>
    </div>
  );
}
