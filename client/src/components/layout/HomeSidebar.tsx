import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Compass, Plus, Users, X } from 'lucide-react';
import { num, useT } from '../../i18n';
import { api } from '../../lib/api';
import { dmName, isUnread, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, cx } from '../ui';

export function HomeSidebar({ channelId, section }: { channelId: number | null; section: 'friends' | 'inbox' | 'explore' | 'dm' }) {
  const t = useT();
  const navigate = useNavigate();
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const readStates = useStore((s) => s.readStates);
  const me = useStore((s) => s.me);
  const pending = useStore((s) => Object.values(s.relationships).filter((r) => r === 'incoming').length);
  const ui = useUi();
  const state = useStore.getState();

  const dms = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => c.type === 'dm' || c.type === 'group_dm')
        .sort((a, b) => (b.lastMessageId ?? b.id) - (a.lastMessageId ?? a.id)),
    [channels],
  );

  const go = (path: string) => {
    ui.setMobileNav(false);
    navigate(path);
  };

  const nav = (key: typeof section, icon: React.ReactNode, label: string, path: string, badge = 0) => (
    <button
      type="button"
      onClick={() => go(path)}
      aria-current={section === key ? 'page' : undefined}
      className={cx(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-[15px]',
        section === key ? 'bg-accent-soft text-text-1' : 'text-text-2 hover:bg-hover hover:text-text-1',
      )}
    >
      <span className={section === key ? 'text-accent' : ''}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge > 0 && <span className="rounded-full bg-danger px-1.5 text-[12px] font-bold leading-5 text-white">{num(badge)}</span>}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-bg-0/60 px-2.5">
        <button
          type="button"
          onClick={() => ui.open({ type: 'newDm' })}
          className="h-8 w-full rounded-lg bg-bg-0/70 px-3 text-start text-[13px] text-text-3 hover:text-text-2"
        >
          {t('home.findConversation')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="flex flex-col gap-0.5">
          {nav('friends', <Users size={20} />, t('home.friends'), '/channels/@me', pending)}
          {nav('inbox', <AtSign size={20} />, t('home.inbox'), '/inbox')}
          {nav('explore', <Compass size={20} />, t('home.explore'), '/explore')}
        </div>
        <div className="mt-5 flex items-center justify-between px-2">
          <h2 className="text-[13px] font-semibold text-text-3">{t('home.directMessages')}</h2>
          <button
            type="button"
            aria-label={t('home.newDm')}
            title={t('home.newDm')}
            onClick={() => ui.open({ type: 'newDm' })}
            className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:text-text-1"
          >
            <Plus size={16} />
          </button>
        </div>
        <ul className="mt-1 flex flex-col gap-0.5">
          {dms.length === 0 && <li className="px-3 py-2 text-[13px] text-text-3">{t('home.noDms')}</li>}
          {dms.map((c) => {
            const other = c.type === 'dm' ? c.recipients?.find((u) => u.id !== me?.id) : undefined;
            const live = other ? (users[other.id] ?? other) : undefined;
            const active = channelId === c.id;
            const unread = isUnread(state, c);
            const mentions = readStates[c.id]?.mentionCount ?? 0;
            return (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => go(`/channels/@me/${c.id}`)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start',
                    active ? 'bg-accent-soft text-text-1' : unread ? 'text-text-1 hover:bg-hover' : 'text-text-2 hover:bg-hover',
                  )}
                >
                  {live ? (
                    <Avatar user={live} size={32} status={live.status} />
                  ) : (
                    <Avatar user={{ id: c.id, displayName: dmName(state, c), avatar: null }} size={32} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[15px]', unread && 'font-bold')}>{dmName(state, c)}</span>
                    <span className="block truncate text-[12px] text-text-3">
                      {c.type === 'group_dm'
                        ? t('home.members', { count: c.recipients?.length ?? 0 })
                        : live?.activity
                          ? t('presence.playing', { game: live.activity })
                          : live?.customStatus || ''}
                    </span>
                  </span>
                  {mentions > 0 && <span className="rounded-full bg-danger px-1.5 text-[12px] font-bold leading-5 text-white">{num(mentions)}</span>}
                </button>
                <button
                  type="button"
                  aria-label={t('home.closeDm')}
                  title={t('home.closeDm')}
                  onClick={async () => {
                    await api.del(`/api/dms/${c.id}/recipients/${me?.id}`).catch(() => undefined);
                    if (active) navigate('/channels/@me');
                  }}
                  className="absolute end-1.5 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-text-3 hover:text-text-1 group-hover:flex"
                >
                  <X size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
