import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Check, Compass, Menu as MenuIcon, MessageCircle, MoreVertical, Search, Users, X } from 'lucide-react';
import type { DiscoverServer, Message, ServerBundle } from '@shared/types';
import { errorText, num, useT } from '../../i18n';
import { api } from '../../lib/api';
import { loadAround, openDm } from '../../lib/actions';
import { messageTime } from '../../lib/format';
import { registerEmojiUrls, renderMarkdown } from '../../lib/markdown';
import { displayName, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { useMarkdownContext } from '../chat/MessageItem';
import { Avatar, Button, cx, EmptyState, IconButton, Input, Menu, ServerIcon, Spinner, toast, type Anchor } from '../ui';

function Header({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  const t = useT();
  const setMobileNav = useUi((s) => s.setMobileNav);
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-bg-0/60 px-3">
      <IconButton label={t('nav.open')} onClick={() => setMobileNav(true)} className="md:hidden">
        <MenuIcon size={20} />
      </IconButton>
      <span className="text-text-3">{icon}</span>
      <h1 className="font-bold text-text-1">{title}</h1>
      {children}
    </header>
  );
}

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

export function FriendsView() {
  const t = useT();
  const navigate = useNavigate();
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const [tab, setTab] = useState<Tab>('online');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ id: number; anchor: Anchor } | null>(null);
  const pending = Object.values(relationships).filter((r) => r === 'incoming').length;

  const rows = useMemo(() => {
    const list = Object.entries(relationships).map(([id, type]) => ({ user: users[Number(id)], type }));
    return list
      .filter((r) => r.user)
      .filter((r) =>
        tab === 'online'
          ? r.type === 'friend' && r.user.status !== 'offline'
          : tab === 'all'
            ? r.type === 'friend'
            : tab === 'pending'
              ? r.type === 'incoming' || r.type === 'outgoing'
              : tab === 'blocked'
                ? r.type === 'blocked'
                : false,
      )
      .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  }, [relationships, users, tab]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const message = async (id: number) => {
    const ch = await openDm(id);
    if (ch) navigate(`/channels/@me/${ch.id}`);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'online', label: t('friends.online') },
    { key: 'all', label: t('friends.all') },
    { key: 'pending', label: pending ? `${t('friends.pending')} (${num(pending)})` : t('friends.pending') },
    { key: 'blocked', label: t('friends.blocked') },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header icon={<Users size={20} />} title={t('home.friends')}>
        <nav role="tablist" className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={cx('shrink-0 rounded-md px-2.5 py-1 text-[14px]', tab === x.key ? 'bg-accent-soft text-text-1' : 'text-text-2 hover:bg-hover')}
            >
              {x.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'add'}
            onClick={() => setTab('add')}
            className={cx('shrink-0 rounded-md px-2.5 py-1 text-[14px] font-semibold', tab === 'add' ? 'text-accent' : 'bg-accent text-accent-ink')}
          >
            {t('friends.add')}
          </button>
        </nav>
      </Header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === 'add' ? (
          <section className="max-w-2xl">
            <h2 className="font-display text-[22px] text-text-1">{t('friends.addTitle')}</h2>
            <p className="mt-1 text-[14px] text-text-3">{t('friends.addBody')}</p>
            <form
              className="mt-4 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!username.trim()) return;
                setBusy(true);
                await act(() => api.post('/api/relationships', { username: username.trim().replace(/^@/, '') }), t('friends.requestSent'));
                setBusy(false);
                setUsername('');
              }}
            >
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('friends.usernamePlaceholder')} dir="ltr" className="flex-1" autoFocus />
              <Button type="submit" busy={busy} disabled={!username.trim()}>
                {t('friends.sendRequest')}
              </Button>
            </form>
          </section>
        ) : rows.length === 0 ? (
          <EmptyState title={t(`friends.empty.${tab}`)} body={t('friends.emptyBody')} action={<Button onClick={() => setTab('add')}>{t('friends.add')}</Button>} />
        ) : (
          <>
            <h2 className="mb-2 text-[13px] font-semibold text-text-3">{t(`friends.count.${tab}`, { count: rows.length })}</h2>
            <ul className="divide-y divide-line/60">
              {rows.map(({ user, type }) => (
                <li key={user.id} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-hover">
                  <Avatar user={user} size={36} status={type === 'friend' ? user.status : null} ring="var(--bg-2)" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-text-1">{user.displayName}</div>
                    <div className="truncate text-[13px] text-text-3">
                      {type === 'incoming'
                        ? t('friends.incoming')
                        : type === 'outgoing'
                          ? t('friends.outgoing')
                          : user.activity
                            ? t('presence.playing', { game: user.activity })
                            : user.customStatus || t(`status.${user.status}`)}
                    </div>
                  </div>
                  {type === 'friend' && (
                    <IconButton label={t('profile.message')} onClick={() => void message(user.id)} className="bg-bg-1">
                      <MessageCircle size={18} />
                    </IconButton>
                  )}
                  {type === 'incoming' && (
                    <IconButton label={t('friends.accept')} onClick={() => void act(() => api.put(`/api/relationships/${user.id}`))} className="bg-bg-1 text-accent">
                      <Check size={18} />
                    </IconButton>
                  )}
                  {(type === 'incoming' || type === 'outgoing' || type === 'blocked') && (
                    <IconButton
                      label={type === 'blocked' ? t('friends.unblock') : type === 'incoming' ? t('friends.decline') : t('friends.cancel')}
                      danger
                      onClick={() => void act(() => api.del(`/api/relationships/${user.id}`))}
                      className="bg-bg-1"
                    >
                      <X size={18} />
                    </IconButton>
                  )}
                  {type === 'friend' && (
                    <IconButton
                      label={t('common.more')}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu({ id: user.id, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } });
                      }}
                      className="bg-bg-1"
                    >
                      <MoreVertical size={18} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <Menu
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                { label: t('friends.remove'), danger: true, onSelect: () => void act(() => api.del(`/api/relationships/${menu.id}`)) },
                { label: t('friends.block'), danger: true, onSelect: () => void act(() => api.put(`/api/relationships/${menu.id}/block`)) },
              ]
            : []
        }
      />
    </div>
  );
}

export function InboxView() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Message[] | null>(null);
  useEffect(() => {
    api
      .get<Message[]>('/api/me/mentions')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header icon={<AtSign size={20} />} title={t('home.inbox')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {!items ? (
          <div className="flex justify-center py-10 text-text-3">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title={t('inbox.emptyTitle')} body={t('inbox.emptyBody')} />
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-2">
            {items.map((m) => (
              <InboxItem
                key={m.id}
                m={m}
                onOpen={() => {
                  navigate(`/channels/${m.serverId}/${m.channelId}`);
                  void loadAround(m.channelId, m.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InboxItem({ m, onOpen }: { m: Message; onOpen: () => void }) {
  const t = useT();
  const md = useMarkdownContext(m.serverId);
  const name = useStore((s) => (m.author ? displayName(s, m.author.id, m.serverId) : (m.webhook?.name ?? '')));
  const where = useStore((s) => {
    const ch = s.channels[m.channelId];
    const server = m.serverId ? s.servers[m.serverId]?.server.name : '';
    return ch ? `${server} / #${ch.name}` : server;
  });
  return (
    <li className="rounded-xl bg-bg-1 p-4">
      <div className="mb-2 text-[12px] text-text-3">{where}</div>
      <div className="flex gap-3">
        <Avatar user={m.author ?? { id: 0, displayName: name, avatar: null }} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-text-1">{name}</span>
            <span className="text-[12px] text-text-3">{messageTime(m.createdAt)}</span>
          </div>
          <div dir="auto" className="break-words text-text-2">
            {renderMarkdown(m.content, md)}
          </div>
        </div>
        <Button variant="secondary" small onClick={onOpen}>
          {t('message.jump')}
        </Button>
      </div>
    </li>
  );
}

export function ExploreView() {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [list, setList] = useState<DiscoverServer[] | null>(null);
  const [joining, setJoining] = useState<number | null>(null);
  const search = async (query: string) => {
    try {
      setList(await api.get<DiscoverServer[]>(`/api/discover${query ? `?q=${encodeURIComponent(query)}` : ''}`));
    } catch (err) {
      toast(errorText(err), 'error');
      setList([]);
    }
  };
  useEffect(() => {
    void search('');
  }, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Header icon={<Compass size={20} />} title={t('home.explore')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="tile-bg px-6 py-10">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-display text-[34px] leading-tight text-text-1">{t('explore.title')}</h2>
            <p className="mt-2 max-w-xl text-[15px] text-text-2">{t('explore.body')}</p>
            <form
              className="relative mt-5 max-w-xl"
              onSubmit={(e) => {
                e.preventDefault();
                void search(q);
              }}
            >
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('explore.search')} aria-label={t('explore.search')} className="h-12 pe-11 text-[16px]" />
              <Search size={20} className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-text-3" />
            </form>
          </div>
        </section>
        <div className="mx-auto max-w-3xl px-6 py-6">
          {!list ? (
            <div className="flex justify-center py-10 text-text-3">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <EmptyState title={t('explore.emptyTitle')} body={t('explore.emptyBody')} />
          ) : (
            <ul className="flex flex-col divide-y divide-line/60">
              {list.map((s) => (
                <li key={s.id} className="flex items-center gap-4 py-4">
                  <span className="overflow-hidden rounded-2xl bg-bg-3 text-text-1">
                    <ServerIcon name={s.name} icon={s.icon} size={56} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[17px] font-bold text-text-1">{s.name}</h3>
                    {s.description && (
                      <p className="line-clamp-2 text-[14px] text-text-2" dir="auto">
                        {s.description}
                      </p>
                    )}
                    <p className="mt-1 flex gap-4 text-[12px] text-text-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        {t('explore.online', { count: s.onlineCount })}
                      </span>
                      <span>{t('explore.members', { count: s.memberCount })}</span>
                    </p>
                  </div>
                  {s.joined ? (
                    <Button variant="secondary" onClick={() => navigate(`/channels/${s.id}`)}>
                      {t('explore.open')}
                    </Button>
                  ) : (
                    <Button
                      busy={joining === s.id}
                      onClick={async () => {
                        setJoining(s.id);
                        try {
                          const b = await api.post<ServerBundle>(`/api/discover/${s.id}/join`);
                          useStore.getState().applyServerBundle(b);
                          registerEmojiUrls(b.emojis);
                          navigate(`/channels/${s.id}`);
                        } catch (err) {
                          toast(errorText(err), 'error');
                        } finally {
                          setJoining(null);
                        }
                      }}
                    >
                      {t('explore.join')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
