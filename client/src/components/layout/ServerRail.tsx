import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BellOff, Check, Compass, LogOut, Plus, Settings, UserPlus } from 'lucide-react';
import { has, P } from '@shared/permissions';
import { errorText, num, useT } from '../../i18n';
import { api } from '../../lib/api';
import { ackServer } from '../../lib/actions';
import { serverPerms } from '../../lib/perms';
import { dmName, serverUnread, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, BrandMark, confirmDialog, cx, Menu, ServerIcon, toast, type Anchor } from '../ui';

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="absolute -bottom-1 -end-1 min-w-[20px] rounded-full bg-danger px-1.5 text-center text-[12px] font-bold leading-[20px] text-white ring-4 ring-bg-0">
      {count > 99 ? '99+' : num(count)}
    </span>
  );
}

/** Small eight-point star marking the current server; a dot marks unread. */
function Marker({ active, unread }: { active: boolean; unread: boolean }) {
  if (active)
    return (
      <svg viewBox="0 0 64 64" className="absolute -start-[9px] top-1/2 h-3 w-3 -translate-y-1/2" aria-hidden="true">
        <path fill="var(--accent)" d="M32 3.7 40.3 12H52v11.7l8.3 8.3-8.3 8.3V52H40.3L32 60.3 23.7 52H12V40.3L3.7 32 12 23.7V12h11.7z" />
      </svg>
    );
  if (unread) return <span className="absolute -start-[7px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-text-1" />;
  return null;
}

export function ServerRail() {
  const t = useT();
  const navigate = useNavigate();
  const { serverId } = useParams();
  const order = useStore((s) => s.serverOrder);
  const servers = useStore((s) => s.servers);
  const open = useUi((s) => s.open);
  const [menu, setMenu] = useState<{ id: number; anchor: Anchor } | null>(null);

  // Subscribe to the slices that unread badges depend on.
  const channels = useStore((s) => s.channels);
  const readStates = useStore((s) => s.readStates);
  const pendingFriends = useStore((s) => Object.values(s.relationships).filter((r) => r === 'incoming').length);
  const state = useStore.getState();

  // DMs with unread mentions appear under the home button.
  const unreadDms = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => (c.type === 'dm' || c.type === 'group_dm') && (readStates[c.id]?.mentionCount ?? 0) > 0)
        .sort((a, b) => (b.lastMessageId ?? 0) - (a.lastMessageId ?? 0))
        .slice(0, 5),
    [channels, readStates],
  );
  const dmMentions = unreadDms.reduce((n, c) => n + (readStates[c.id]?.mentionCount ?? 0), 0);

  const menuServer = menu ? servers[menu.id] : null;
  const menuPerms = menu ? serverPerms(state, menu.id) : 0;

  return (
    <nav aria-label={t('rail.label')} className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-bg-0 py-3">
      <RailItem label={t('rail.home')} active={serverId === '@me' || !serverId} onClick={() => navigate('/channels/@me')} badge={pendingFriends}>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-2 transition-[border-radius] group-hover:rounded-xl">
          <BrandMark size={34} />
        </span>
      </RailItem>

      {unreadDms.map((c) => (
        <RailItem key={c.id} label={dmName(state, c)} active={false} onClick={() => navigate(`/channels/@me/${c.id}`)} badge={state.readStates[c.id]?.mentionCount ?? 0}>
          <Avatar user={c.type === 'dm' ? c.recipients?.find((u) => u.id !== state.me?.id) : { id: c.id, displayName: dmName(state, c), avatar: null }} size={48} />
        </RailItem>
      ))}
      {dmMentions > 0 && <span className="sr-only">{dmMentions}</span>}

      <div className="my-0.5 h-0.5 w-8 rounded-full bg-line" />

      {order.map((id) => {
        const entry = servers[id];
        if (!entry) return null;
        const { unread, mentions } = serverUnread(state, id);
        const active = serverId === String(id);
        return (
          <RailItem
            key={id}
            label={entry.server.name}
            active={active}
            unread={unread}
            badge={mentions}
            onClick={() => {
              const last = localStorage.getItem(`lgcp.lastChannel.${id}`);
              navigate(last ? `/channels/${id}/${last}` : `/channels/${id}`);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id, anchor: { x: e.clientX, y: e.clientY } });
            }}
          >
            <span
              className={cx(
                'flex h-12 w-12 items-center justify-center overflow-hidden bg-bg-2 text-text-1 transition-[border-radius,background-color]',
                active ? 'rounded-xl ring-2 ring-accent ring-offset-2 ring-offset-bg-0' : 'rounded-2xl group-hover:rounded-xl group-hover:bg-accent group-hover:text-accent-ink',
              )}
            >
              <ServerIcon name={entry.server.name} icon={entry.server.icon} size={48} />
            </span>
          </RailItem>
        );
      })}

      <RailItem label={t('rail.addServer')} active={false} onClick={() => open({ type: 'createServer' })}>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-2 text-accent transition-[border-radius,background-color] group-hover:rounded-xl group-hover:bg-accent group-hover:text-accent-ink">
          <Plus size={24} />
        </span>
      </RailItem>
      <RailItem label={t('rail.explore')} active={window.location.pathname === '/explore'} onClick={() => navigate('/explore')}>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bg-2 text-accent transition-[border-radius,background-color] group-hover:rounded-xl group-hover:bg-accent group-hover:text-accent-ink">
          <Compass size={24} />
        </span>
      </RailItem>

      <Menu
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        placement="point"
        items={
          menu && menuServer
            ? [
                {
                  label: t('server.markRead'),
                  icon: <Check size={16} />,
                  onSelect: () => ackServer(menu.id).catch((err) => toast(errorText(err), 'error')),
                },
                {
                  label: t('server.invite'),
                  icon: <UserPlus size={16} />,
                  hidden: !has(menuPerms, P.CREATE_INVITE),
                  onSelect: () => open({ type: 'invite', serverId: menu.id }),
                },
                {
                  label: menuServer.settings.muted ? t('server.unmute') : t('server.mute'),
                  icon: <BellOff size={16} />,
                  onSelect: () =>
                    api.patch(`/api/servers/${menu.id}/settings`, { muted: !menuServer.settings.muted }).catch((err) => toast(errorText(err), 'error')),
                },
                {
                  label: t('server.settings'),
                  icon: <Settings size={16} />,
                  hidden: !(has(menuPerms, P.MANAGE_SERVER) || has(menuPerms, P.MANAGE_ROLES) || has(menuPerms, P.BAN_MEMBERS)),
                  onSelect: () => open({ type: 'serverSettings', serverId: menu.id }),
                },
                'divider',
                {
                  label: t('server.leave'),
                  icon: <LogOut size={16} />,
                  danger: true,
                  hidden: menuServer.server.ownerId === state.me?.id,
                  onSelect: async () => {
                    const ok = await confirmDialog({
                      title: t('server.leaveTitle', { name: menuServer.server.name }),
                      body: t('server.leaveBody'),
                      confirmText: t('server.leave'),
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await api.del(`/api/servers/${menu.id}/members/@me`);
                    } catch (err) {
                      toast(errorText(err), 'error');
                    }
                  },
                },
              ]
            : []
        }
      />
    </nav>
  );
}

function RailItem({
  label,
  active,
  unread,
  badge = 0,
  onClick,
  onContextMenu,
  children,
}: {
  label: string;
  active: boolean;
  unread?: boolean;
  badge?: number;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex w-full justify-center">
      <Marker active={active} unread={!!unread && !active} />
      <button
        type="button"
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        title={label}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className="group relative rounded-2xl"
      >
        {children}
        <Badge count={badge} />
      </button>
    </div>
  );
}
