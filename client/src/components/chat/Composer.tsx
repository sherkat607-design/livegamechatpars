import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, BarChart3, FileText, Plus, Smile, X } from 'lucide-react';
import type { Channel, Message } from '@shared/types';
import { LIMITS } from '@shared/constants';
import { errorText, num, useT } from '../../i18n';
import { applySlashCommand, encodeOutgoing, sendMessage, SLASH_COMMANDS } from '../../lib/actions';
import { loadEmojis, pushRecentEmoji, searchEmojis, type EmojiData } from '../../lib/emoji';
import { fileSize } from '../../lib/format';
import { has, P } from '../../lib/perms';
import { getSocket } from '../../lib/socket';
import { displayName, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, cx, IconButton, Popover, toast, type Anchor } from '../ui';
import { channelIcon } from '../layout/ServerSidebar';
import { EmojiPicker } from './EmojiPicker';

interface Suggestion {
  key: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  insert: string;
  /** Display text → wire token (for mentions with spaces, like role names). */
  token?: [string, string];
}

export function Composer({ channel, perms, placeholder, blockedReason }: { channel: Channel; perms: number; placeholder: string; blockedReason?: string | null }) {
  const t = useT();
  const serverId = channel.serverId;
  const me = useStore((s) => s.me);
  const maxMB = useStore((s) => s.config.maxUploadMB);
  const replyTo = useUi((s) => s.replyTo[channel.id] ?? null);
  const setReply = useUi((s) => s.setReply);
  const setEditing = useUi((s) => s.setEditing);
  const openModal = useUi((s) => s.open);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [mentionReplied, setMentionReplied] = useState(true);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [emojiAnchor, setEmojiAnchor] = useState<Anchor | null>(null);
  const [emojiData, setEmojiData] = useState<EmojiData | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const tokens = useRef(new Map<string, string>());
  const lastTyping = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const canSend = has(perms, P.SEND_MESSAGES) && !blockedReason;
  const canAttach = has(perms, P.ATTACH_FILES);
  const exemptSlowmode = has(perms, P.MANAGE_MESSAGES) || has(perms, P.MANAGE_CHANNELS);

  // Drafts survive switching channels.
  useEffect(() => {
    const draft = sessionStorage.getItem(`lgcp.draft.${channel.id}`) ?? '';
    setText(draft);
    setFiles([]);
    tokens.current = new Map();
    area.current?.focus();
  }, [channel.id]);
  useEffect(() => {
    sessionStorage.setItem(`lgcp.draft.${channel.id}`, text);
  }, [text, channel.id]);

  useEffect(() => {
    if (replyTo) area.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= cooldownUntil) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  // Files dropped or pasted anywhere on the chat.
  useEffect(() => {
    const onFiles = (e: Event) => {
      const detail = (e as CustomEvent<{ channelId: number; files: File[] }>).detail;
      if (detail.channelId === channel.id) addFiles(detail.files);
    };
    window.addEventListener('lgcp:files', onFiles);
    return () => window.removeEventListener('lgcp:files', onFiles);
  });

  const addFiles = (list: File[]) => {
    if (!canAttach) {
      toast(t('error.missing_permissions'), 'error');
      return;
    }
    const tooBig = list.filter((f) => f.size > maxMB * 1024 * 1024);
    if (tooBig.length) toast(t('composer.tooBig', { mb: maxMB }), 'error');
    setFiles((prev) => [...prev, ...list.filter((f) => f.size <= maxMB * 1024 * 1024)].slice(0, LIMITS.attachmentsPerMessage));
  };

  // ---------- autocomplete ----------
  const trigger = useMemo(() => {
    const before = text.slice(0, caret);
    const slash = /^\/(\w*)$/.exec(before);
    if (slash) return { kind: '/', query: slash[1], start: 0 };
    const m = /(^|\s)([@#:])([^\s@#:]{0,32})$/u.exec(before);
    if (!m) return null;
    if (m[2] === ':' && m[3].length < 2) return null;
    return { kind: m[2], query: m[3].toLowerCase(), start: before.length - m[3].length - 1 };
  }, [text, caret]);

  useEffect(() => {
    if (trigger?.kind === ':' && !emojiData) void loadEmojis().then(setEmojiData);
  }, [trigger, emojiData]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!trigger) return [];
    const s = useStore.getState();
    const q = trigger.query;
    if (trigger.kind === '/') {
      return SLASH_COMMANDS.filter((c) => c.startsWith(q)).map((c) => ({ key: c, label: `/${c}`, hint: t(`command.${c}`), insert: `/${c} ` }));
    }
    if (trigger.kind === '@') {
      const people = serverId
        ? Object.values(s.members[serverId] ?? {}).map((m) => ({ id: m.userId, user: s.users[m.userId] ?? m.user, nick: m.nickname }))
        : (channel.recipients ?? []).map((u) => ({ id: u.id, user: s.users[u.id] ?? u, nick: null }));
      const matches = people
        .filter((p) => !q || p.user.username.includes(q) || p.user.displayName.toLowerCase().includes(q) || p.nick?.toLowerCase().includes(q))
        .slice(0, 8)
        .map<Suggestion>((p) => ({
          key: `u${p.id}`,
          label: p.nick || p.user.displayName,
          hint: `@${p.user.username}`,
          icon: <Avatar user={p.user} size={24} />,
          insert: `@${p.user.username} `,
        }));
      const roles = serverId
        ? (s.servers[serverId]?.roles ?? [])
            .filter((r) => !r.isDefault && (r.mentionable || has(perms, P.MENTION_EVERYONE)) && r.name.toLowerCase().includes(q))
            .slice(0, 5)
            .map<Suggestion>((r) => ({
              key: `r${r.id}`,
              label: `@${r.name}`,
              hint: t('composer.role'),
              icon: <span className="inline-block h-3 w-3 rounded-full" style={{ background: r.color ?? 'var(--text-3)' }} />,
              insert: `@${r.name} `,
              token: [`@${r.name}`, `<@&${r.id}>`],
            }))
        : [];
      const everyone =
        serverId && has(perms, P.MENTION_EVERYONE)
          ? (['everyone', 'here'] as const)
              .filter((x) => x.startsWith(q))
              .map<Suggestion>((x) => ({ key: x, label: `@${x}`, hint: t(`composer.${x}`), icon: <AtSign size={18} />, insert: `@${x} ` }))
          : [];
      return [...matches, ...roles, ...everyone];
    }
    if (trigger.kind === '#' && serverId) {
      return Object.values(s.channels)
        .filter((c) => c.serverId === serverId && c.type !== 'category' && c.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((c) => ({ key: `c${c.id}`, label: c.name, icon: channelIcon(c, 16), insert: `#${c.name} `, token: [`#${c.name}`, `<#${c.id}>`] as [string, string] }));
    }
    if (trigger.kind === ':') {
      const custom = Object.values(s.servers)
        .flatMap((x) => x.emojis)
        .filter((e) => e.name.toLowerCase().includes(q))
        .slice(0, 4)
        .map<Suggestion>((e) => ({ key: `e${e.id}`, label: `:${e.name}:`, icon: <img src={e.url} alt="" className="h-6 w-6 object-contain" />, insert: `:${e.name}: ` }));
      const unicode = emojiData
        ? searchEmojis(emojiData, q, 8).map<Suggestion>((e) => ({ key: e.unicode, label: `:${e.shortcodes[0] ?? e.label}:`, icon: <span className="text-[20px]">{e.unicode}</span>, insert: `${e.unicode} ` }))
        : [];
      return [...custom, ...unicode].slice(0, 10);
    }
    return [];
  }, [trigger, serverId, channel.recipients, perms, emojiData, t]);

  useEffect(() => setActive(0), [trigger?.kind, trigger?.query]);

  const pick = (sug: Suggestion) => {
    if (!trigger) return;
    const before = text.slice(0, trigger.start);
    const after = text.slice(caret);
    const next = before + sug.insert + after;
    if (sug.token) tokens.current.set(sug.token[0], sug.token[1]);
    setText(next);
    const pos = before.length + sug.insert.length;
    requestAnimationFrame(() => {
      area.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  // ---------- sending ----------
  const send = async () => {
    const raw = text.trim();
    if (!raw && files.length === 0) return;
    if (cooldownUntil > Date.now()) return;
    const cmd = applySlashCommand(raw);
    if (cmd.command === 'poll') {
      openModal({ type: 'poll', channelId: channel.id });
      setText('');
      return;
    }
    if (!cmd.text && files.length === 0) return;
    if (cmd.text.length > LIMITS.messageMax) {
      toast(t('composer.tooLong', { max: LIMITS.messageMax }), 'error');
      return;
    }
    const content = await encodeOutgoing(cmd.text, serverId, tokens.current);
    const outgoingFiles = files;
    const reply: Message | null = replyTo;
    setText('');
    setFiles([]);
    setReply(channel.id, null);
    tokens.current = new Map();
    lastTyping.current = 0;
    if (outgoingFiles.length) setProgress(0);
    const ok = await sendMessage(channel.id, {
      content,
      files: outgoingFiles,
      replyTo: reply,
      mentionReplied,
      onProgress: outgoingFiles.length ? setProgress : undefined,
    });
    setProgress(null);
    if (!ok) {
      setText((cur) => cur || raw);
      if (outgoingFiles.length) setFiles(outgoingFiles);
    } else if (channel.slowmode > 0 && !exemptSlowmode) {
      setCooldownUntil(Date.now() + channel.slowmode * 1000);
      setNow(Date.now());
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        pick(suggestions[active]);
        return;
      }
      if (e.key === 'Escape') {
        setCaret(-1);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
      return;
    }
    if (e.key === 'Escape' && replyTo) setReply(channel.id, null);
    if (e.key === 'ArrowUp' && !text) {
      const mine = [...(useStore.getState().messages[channel.id]?.list ?? [])].reverse().find((m) => m.author?.id === me?.id && m.type === 'default' && !m.pending);
      if (mine) {
        e.preventDefault();
        setEditing(mine.id);
      }
    }
  };

  const onChange = (value: string) => {
    setText(value);
    setCaret(area.current?.selectionStart ?? value.length);
    if (value.trim() && !value.startsWith('/') && Date.now() - lastTyping.current > 8000) {
      lastTyping.current = Date.now();
      getSocket()?.emit('typing', { channelId: channel.id });
    }
  };

  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const replyName = replyTo ? (replyTo.author ? displayName(useStore.getState(), replyTo.author.id, serverId) : (replyTo.webhook?.name ?? '')) : '';

  if (!canSend) {
    return (
      <div className="px-4 pb-5">
        <div className="rounded-xl bg-bg-3 px-4 py-3 text-[14px] text-text-3">{blockedReason ?? t('composer.noPermission')}</div>
      </div>
    );
  }

  return (
    <div className="relative px-4 pb-5">
      {suggestions.length > 0 && (
        <div role="listbox" aria-label={t('composer.suggestions')} className="absolute inset-x-4 bottom-full mb-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-bg-3 p-1.5" style={{ boxShadow: 'var(--shadow)' }}>
          {suggestions.map((sug, i) => (
            <button
              key={sug.key}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(sug);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start', i === active ? 'bg-accent-soft' : '')}
            >
              {sug.icon && <span className="flex w-6 justify-center">{sug.icon}</span>}
              <span className="flex-1 truncate text-[15px] text-text-1" dir="auto">
                {sug.label}
              </span>
              {sug.hint && <span className="truncate text-[12px] text-text-3">{sug.hint}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl bg-bg-3">
        {replyTo && (
          <div className="flex items-center gap-2 rounded-t-xl bg-bg-4/60 px-4 py-2 text-[13px] text-text-2">
            <span className="flex-1 truncate">{t('composer.replyingTo', { name: replyName })}</span>
            {serverId && replyTo.author && replyTo.author.id !== me?.id && (
              <button type="button" onClick={() => setMentionReplied((v) => !v)} className={cx('font-bold', mentionReplied ? 'text-accent' : 'text-text-3')} aria-pressed={mentionReplied}>
                @ {mentionReplied ? t('composer.pingOn') : t('composer.pingOff')}
              </button>
            )}
            <IconButton label={t('composer.cancelReply')} onClick={() => setReply(channel.id, null)} className="h-6 w-6">
              <X size={15} />
            </IconButton>
          </div>
        )}
        {files.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto p-3">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="relative flex w-40 shrink-0 flex-col gap-1 rounded-lg bg-bg-1 p-2">
                {f.type.startsWith('image/') ? (
                  <FilePreview file={f} />
                ) : (
                  <div className="flex h-24 items-center justify-center text-accent">
                    <FileText size={40} />
                  </div>
                )}
                <span className="truncate text-[12px] text-text-2" title={f.name}>
                  {f.name}
                </span>
                <span className="text-[11px] text-text-3">{fileSize(f.size)}</span>
                <button
                  type="button"
                  aria-label={t('composer.removeFile', { name: f.name })}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-2 -end-2 flex h-6 w-6 items-center justify-center rounded-full bg-danger text-white"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {progress !== null && (
          <div className="mx-4 mb-2 h-1.5 overflow-hidden rounded-full bg-bg-1" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="flex items-end gap-1 px-2 py-1.5">
          {canAttach && (
            <IconButton label={t('composer.attach')} onClick={() => fileInput.current?.click()} className="h-10 w-10">
              <Plus size={22} />
            </IconButton>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <textarea
            ref={area}
            value={text}
            rows={1}
            dir="auto"
            aria-label={placeholder}
            placeholder={cooldown ? t('composer.slowmode', { seconds: cooldown }) : placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            disabled={progress !== null}
            className="max-h-[40vh] min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] text-text-1 placeholder:text-text-3 focus:outline-none"
          />
          <IconButton label={t('poll.create')} onClick={() => openModal({ type: 'poll', channelId: channel.id })} className="h-10 w-10">
            <BarChart3 size={20} />
          </IconButton>
          <IconButton
            label={t('emoji.pick')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setEmojiAnchor({ x: r.left, y: r.top, w: r.width, h: r.height });
            }}
            className="h-10 w-10"
          >
            <Smile size={21} />
          </IconButton>
        </div>
      </div>
      <div className="mt-1 flex h-4 items-center justify-end gap-3 px-1 text-[11px] text-text-3">
        {cooldown > 0 && <span>{t('composer.slowmode', { seconds: cooldown })}</span>}
        {text.length > LIMITS.messageMax - 300 && (
          <span className={text.length > LIMITS.messageMax ? 'text-danger-text' : ''}>{num(LIMITS.messageMax - text.length)}</span>
        )}
      </div>

      <Popover anchor={emojiAnchor} onClose={() => setEmojiAnchor(null)} placement="above">
        <EmojiPicker
          serverId={serverId}
          onPick={(e) => {
            pushRecentEmoji(e.reaction);
            const el = area.current;
            const pos = el?.selectionStart ?? text.length;
            const custom = /^<a?:(\w+):\d+>$/.exec(e.insert);
            const insert = custom ? `:${custom[1]}:` : e.insert;
            setText(text.slice(0, pos) + insert + text.slice(pos));
            setEmojiAnchor(null);
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(pos + insert.length, pos + insert.length);
            });
          }}
        />
      </Popover>
    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" className="h-24 w-full rounded object-cover" /> : <div className="h-24" />;
}

export function sendFilesTo(channelId: number, files: File[]) {
  window.dispatchEvent(new CustomEvent('lgcp:files', { detail: { channelId, files } }));
}

export { errorText };
