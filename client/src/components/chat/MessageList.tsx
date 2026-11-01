import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Channel } from '@shared/types';
import { useT } from '../../i18n';
import { ack, loadLatest, loadNewer, loadOlder } from '../../lib/actions';
import { dayLabel, sameDay } from '../../lib/format';
import { emptyMessages, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { channelIcon } from '../layout/ServerSidebar';
import { Spinner } from '../ui';
import { MessageItem } from './MessageItem';

const GROUP_MS = 7 * 60 * 1000;

export function MessageList({ channel, perms, intro }: { channel: Channel; perms: number; intro: React.ReactNode }) {
  const t = useT();
  const state = useStore((s) => s.messages[channel.id] ?? emptyMessages);
  const lastRead = useStore((s) => s.readStates[channel.id]?.lastReadId ?? 0);
  const jump = useUi((s) => s.jump);
  const clearJump = useUi((s) => s.clearJump);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevFirstId = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  // "New messages" divider: the read position when the channel was opened.
  const [dividerAfter, setDividerAfter] = useState<number>(lastRead);

  useEffect(() => {
    setDividerAfter(useStore.getState().readStates[channel.id]?.lastReadId ?? 0);
    atBottom.current = true;
    prevFirstId.current = null;
    if (!useStore.getState().messages[channel.id]?.loaded) void loadLatest(channel.id).catch(() => undefined);
  }, [channel.id]);

  const markRead = useCallback(() => {
    if (atBottom.current && document.visibilityState === 'visible' && document.hasFocus() && !useStore.getState().messages[channel.id]?.hasNewer) ack(channel.id);
  }, [channel.id]);

  // Keep the view pinned to the bottom, and keep position when older history is prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = state.list[0]?.id ?? null;
    if (prevFirstId.current !== null && first !== prevFirstId.current && el.scrollHeight > prevHeight.current && !atBottom.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current && !jump) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirstId.current = first;
    prevHeight.current = el.scrollHeight;
    markRead();
  }, [state.list, jump, markRead]);

  useEffect(() => {
    const onFocus = () => markRead();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [markRead]);

  // Scroll to a requested message and flash it.
  useEffect(() => {
    if (!jump || jump.channelId !== channel.id) return;
    const el = document.getElementById(`msg-${jump.messageId}`);
    if (el) {
      atBottom.current = false;
      el.scrollIntoView({ block: 'center' });
      setHighlight(jump.messageId);
      window.setTimeout(() => setHighlight(null), 1600);
      clearJump();
    }
  }, [jump, channel.id, state.list, clearJump]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 80;
    setShowJump(distance > 600 || state.hasNewer);
    if (el.scrollTop < 300 && state.hasMore && !state.loading) void loadOlder(channel.id);
    if (distance < 300 && state.hasNewer && !state.loading) void loadNewer(channel.id);
    if (atBottom.current) markRead();
  };

  const toBottom = async () => {
    if (state.hasNewer) await loadLatest(channel.id);
    atBottom.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const list = state.list;
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overflow-x-hidden pb-4" role="log" aria-live="polite" aria-relevant="additions">
        {!state.hasMore && state.loaded && intro}
        {state.loading && (
          <div className="flex justify-center py-4 text-text-3">
            <Spinner />
          </div>
        )}
        {list.map((m, i) => {
          const prev = list[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const showDivider = !m.pending && dividerAfter > 0 && m.id > dividerAfter && (!prev || prev.id <= dividerAfter) && m.author?.id !== useStore.getState().me?.id;
          const compact =
            !!prev &&
            !newDay &&
            !showDivider &&
            prev.type === 'default' &&
            m.type === 'default' &&
            !m.replyTo &&
            !m.replyToId &&
            prev.author?.id === m.author?.id &&
            (prev.webhook?.name ?? null) === (m.webhook?.name ?? null) &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
          return (
            <Fragment key={m.pending ? `p${m.nonce}` : m.id}>
              {newDay && (
                <div className="relative mx-4 mt-4 mb-1 flex items-center" role="separator">
                  <div className="h-px flex-1 bg-line" />
                  <span className="px-2 text-[12px] font-semibold text-text-3">{dayLabel(m.createdAt)}</span>
                  <div className="h-px flex-1 bg-line" />
                </div>
              )}
              {showDivider && (
                <div className="relative mx-4 my-1 flex items-center" role="separator" aria-label={t('chat.newMessages')}>
                  <div className="h-px flex-1 bg-danger" />
                  <span className="rounded bg-danger px-1.5 text-[11px] font-bold text-white">{t('chat.newMessages')}</span>
                </div>
              )}
              <MessageItem m={m} compact={compact} channel={channel} perms={perms} highlighted={highlight === m.id} />
            </Fragment>
          );
        })}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => void toBottom()}
          className="absolute bottom-3 start-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink shadow-lg rtl:translate-x-1/2"
        >
          <ArrowDown size={15} /> {t('chat.jumpToPresent')}
        </button>
      )}
    </div>
  );
}

export function ChannelIntro({ channel, title, body }: { channel: Channel; title: string; body: string }) {
  return (
    <div className="px-4 pt-10 pb-4">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-3 text-accent">{channelIcon(channel, 34)}</div>
      <h2 className="font-display text-[28px] text-text-1">{title}</h2>
      <p className="mt-1 max-w-xl text-[15px] text-text-2">{body}</p>
    </div>
  );
}
