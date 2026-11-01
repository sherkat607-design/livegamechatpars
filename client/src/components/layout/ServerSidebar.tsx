import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  FolderPlus,
  Hash,
  Headphones,
  LogOut,
  Megaphone,
  MessageSquareText,
  MicOff,
  MonitorUp,
  Plus,
  Settings,
  UserPlus,
  Video,
  Volume2,
} from 'lucide-react';
import type { Channel } from '@shared/types';
import { errorText, num, useT } from '../../i18n';
import { api } from '../../lib/api';
import { ackServer } from '../../lib/actions';
import { channelPerms, has, P, serverPerms } from '../../lib/perms';
import { useVoice, voice } from '../../lib/voice';
import { displayName, isUnread, mentionCount, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, confirmDialog, cx, Menu, toast, type Anchor } from '../ui';

export function channelIcon(c: Pick<Channel, 'type'>, size = 18) {
  if (c.type === 'voice') return <Volume2 size={size} />;
  if (c.type === 'announcement') return <Megaphone size={size} />;
  if (c.type === 'thread') return <MessageSquareText size={size} />;
  return <Hash size={size} />;
}

export function ServerSidebar({ serverId, channelId }: { serverId: number; channelId: number | null }) {
  const t = useT();
  const navigate = useNavigate();
  const entry = useStore((s) => s.servers[serverId]);
  const allChannels = useStore((s) => s.channels);
  const readStates = useStore((s) => s.readStates);
  const voiceStates = useStore((s) => s.voiceStates);
  useStore((s) => s.members[serverId]);
  const ui = useUi();
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const state = useStore.getState();
  const perms = serverPerms(state, serverId);
  const canManage = has(perms, P.MANAGE_CHANNELS);

  const channels = useMemo(
    () =>
      Object.values(allChannels)
        .filter((c) => c.serverId === serverId)
        .sort((a, b) => a.position - b.position || a.id - b.id),
    [allChannels, serverId],
  );
  const categories = channels.filter((c) => c.type === 'category');
  const uncategorized = channels.filter((c) => c.type !== 'category' && c.type !== 'thread' && !c.parentId);
  const threadsOf = (id: number) => channels.filter((c) => c.type === 'thread' && c.parentId === id && !c.archived);

  if (!entry) return null;

  const open = (c: Channel) => {
    localStorage.setItem(`lgcp.lastChannel.${serverId}`, String(c.id));
    ui.setMobileNav(false);
    if (c.type === 'voice') {
      if (useVoice.getState().channelId !== c.id && state.me) {
        voice.join(c.id, state.me.id).catch((err) => toast(errorText({ code: err.message }), 'error'));
      }
    }
    navigate(`/channels/${serverId}/${c.id}`);
  };

  /** Drop a dragged channel before `target` (or into a category). */
  const drop = async (target: Channel) => {
    if (dragId === null || dragId === target.id) return;
    const dragged = allChannels[dragId];
    if (!dragged || dragged.type === 'category' !== (target.type === 'category')) {
      if (dragged && dragged.type !== 'category' && target.type === 'category') {
        await api
          .put(`/api/servers/${serverId}/channels/order`, [{ id: dragged.id, position: 999, parentId: target.id }])
          .catch((err) => toast(errorText(err), 'error'));
      }
      return;
    }
    const parentId = dragged.type === 'category' ? null : target.parentId;
    const siblings = channels.filter((c) => (dragged.type === 'category' ? c.type === 'category' : c.type !== 'category' && c.type !== 'thread' && c.parentId === parentId) && c.id !== dragged.id);
    const index = siblings.findIndex((c) => c.id === target.id);
    siblings.splice(index, 0, dragged);
    await api
      .put(
        `/api/servers/${serverId}/channels/order`,
        siblings.map((c, i) => ({ id: c.id, position: i, parentId: c.type === 'category' ? undefined : parentId })),
      )
      .catch((err) => toast(errorText(err), 'error'));
  };

  const renderChannel = (c: Channel, nested = false) => {
    const active = channelId === c.id;
    const unread = isUnread(state, c) && !entry.settings.muted && entry.settings.notifyLevel === 'all';
    const mentions = entry.settings.notifyLevel === 'none' ? 0 : mentionCount(state, c.id);
    const cp = channelPerms(state, c);
    const participants = c.type === 'voice' ? (voiceStates[c.id] ?? []) : [];
    return (
      <li key={c.id}>
        <div
          draggable={canManage && c.type !== 'thread'}
          onDragStart={() => setDragId(c.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => canManage && dragId !== null && e.preventDefault()}
          onDrop={() => void drop(c)}
          className={cx(
            'group flex items-center gap-1.5 rounded-lg pe-1 ps-2',
            nested && 'ms-5',
            active ? 'bg-accent-soft text-text-1' : unread ? 'text-text-1 hover:bg-hover' : 'text-text-3 hover:bg-hover hover:text-text-2',
          )}
        >
          <button
            type="button"
            onClick={() => open(c)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-start"
            aria-current={active ? 'page' : undefined}
          >
            <span className={cx('shrink-0', active ? 'text-accent' : 'opacity-80')}>{channelIcon(c, nested ? 15 : 18)}</span>
            <span className={cx('truncate text-[15px]', unread && 'font-bold')}>{c.name}</span>
          </button>
          {unread && !active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-1" aria-hidden="true" />}
          {mentions > 0 && (
            <span className="rounded-full bg-danger px-1.5 text-[12px] font-bold leading-5 text-white" aria-label={t('channel.mentions', { count: mentions })}>
              {num(mentions)}
            </span>
          )}
          {has(cp, P.CREATE_INVITE) && c.type !== 'thread' && (
            <button
              type="button"
              aria-label={t('server.invite')}
              title={t('server.invite')}
              onClick={() => ui.open({ type: 'invite', serverId, channelId: c.id })}
              className="hidden h-6 w-6 items-center justify-center rounded text-text-3 hover:text-text-1 group-hover:flex group-focus-within:flex"
            >
              <UserPlus size={15} />
            </button>
          )}
          {(has(cp, P.MANAGE_CHANNELS) || has(cp, P.MANAGE_ROLES)) && c.type !== 'thread' && (
            <button
              type="button"
              aria-label={t('channel.settings')}
              title={t('channel.settings')}
              onClick={() => ui.open({ type: 'channelSettings', channelId: c.id })}
              className="hidden h-6 w-6 items-center justify-center rounded text-text-3 hover:text-text-1 group-hover:flex group-focus-within:flex"
            >
              <Settings size={15} />
            </button>
          )}
        </div>
        {participants.length > 0 && (
          <ul className="mb-1 ms-7 flex flex-col gap-0.5 py-0.5">
            {participants.map((p) => (
              <VoiceMember key={p.userId} userId={p.userId} serverId={serverId} participant={p} />
            ))}
          </ul>
        )}
        {c.type !== 'voice' && threadsOf(c.id).length > 0 && <ul>{threadsOf(c.id).map((th) => renderChannel(th, true))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={(e) => setMenu({ ...anchorRect(e.currentTarget) })}
        className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-bg-0/60 px-4 text-start hover:bg-hover"
        aria-haspopup="menu"
      >
        <span className="truncate font-display text-[19px] text-text-1">{entry.server.name}</span>
        <ChevronDown size={18} className="shrink-0 text-text-2" />
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">{uncategorized.map((c) => renderChannel(c))}</ul>
        {categories.map((cat) => {
          const kids = channels.filter((c) => c.parentId === cat.id && c.type !== 'thread');
          const collapsed = ui.collapsed[cat.id];
          return (
            <section
              key={cat.id}
              className="mt-4"
              onDragOver={(e) => canManage && dragId !== null && e.preventDefault()}
              onDrop={(e) => {
                if (e.target === e.currentTarget) void drop(cat);
              }}
            >
              <div
                className="group flex items-center gap-1 pe-1"
                draggable={canManage}
                onDragStart={() => setDragId(cat.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => canManage && dragId !== null && e.preventDefault()}
                onDrop={() => void drop(cat)}
              >
                <button
                  type="button"
                  onClick={() => ui.toggleCollapsed(cat.id)}
                  aria-expanded={!collapsed}
                  className="flex min-w-0 flex-1 items-center gap-1 text-start text-[13px] font-semibold text-text-3 hover:text-text-2"
                >
                  <ChevronDown size={14} className={cx('shrink-0 transition-transform', collapsed && '-rotate-90 rtl:rotate-90')} />
                  <span className="truncate">{cat.name}</span>
                </button>
                {canManage && (
                  <button
                    type="button"
                    aria-label={t('channel.create')}
                    title={t('channel.create')}
                    onClick={() => ui.open({ type: 'createChannel', serverId, parentId: cat.id })}
                    className="flex h-6 w-6 items-center justify-center rounded text-text-3 hover:text-text-1"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                {kids
                  .filter((c) => !collapsed || c.id === channelId || isUnread(state, c) || (voiceStates[c.id]?.length ?? 0) > 0)
                  .map((c) => renderChannel(c))}
              </ul>
            </section>
          );
        })}
        {readStates && null}
      </div>

      <Menu
        anchor={menu}
        onClose={() => setMenu(null)}
        items={[
          { label: t('server.invite'), icon: <UserPlus size={16} />, hidden: !has(perms, P.CREATE_INVITE), onSelect: () => ui.open({ type: 'invite', serverId }) },
          {
            label: t('server.settings'),
            icon: <Settings size={16} />,
            hidden: !(has(perms, P.MANAGE_SERVER) || has(perms, P.MANAGE_ROLES) || has(perms, P.BAN_MEMBERS) || has(perms, P.VIEW_AUDIT_LOG) || has(perms, P.MANAGE_EMOJIS) || has(perms, P.MANAGE_WEBHOOKS) || has(perms, P.KICK_MEMBERS)),
            onSelect: () => ui.open({ type: 'serverSettings', serverId }),
          },
          { label: t('channel.create'), icon: <Plus size={16} />, hidden: !canManage, onSelect: () => ui.open({ type: 'createChannel', serverId }) },
          { label: t('channel.createCategory'), icon: <FolderPlus size={16} />, hidden: !canManage, onSelect: () => ui.open({ type: 'createChannel', serverId, kind: 'category' }) },
          'divider',
          {
            label: t('server.notifications'),
            icon: <Bell size={16} />,
            onSelect: () => ui.open({ type: 'serverSettings', serverId, tab: 'notifications' }),
          },
          { label: t('server.markRead'), icon: <MessageSquareText size={16} />, onSelect: () => void ackServer(serverId) },
          'divider',
          {
            label: t('server.leave'),
            icon: <LogOut size={16} />,
            danger: true,
            hidden: entry.server.ownerId === state.me?.id,
            onSelect: async () => {
              if (!(await confirmDialog({ title: t('server.leaveTitle', { name: entry.server.name }), body: t('server.leaveBody'), confirmText: t('server.leave'), danger: true }))) return;
              await api.del(`/api/servers/${serverId}/members/@me`).catch((err) => toast(errorText(err), 'error'));
            },
          },
        ]}
      />
    </div>
  );
}

function anchorRect(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.left + 8, y: r.top, w: r.width - 16, h: r.height };
}

function VoiceMember({
  userId,
  serverId,
  participant,
}: {
  userId: number;
  serverId: number;
  participant: { selfMute: boolean; selfDeaf: boolean; serverMute: boolean; serverDeaf: boolean; video: boolean; screen: boolean };
}) {
  const t = useT();
  const user = useStore((s) => s.users[userId]);
  const name = useStore((s) => displayName(s, userId, serverId));
  const speaking = useVoice((s) => !!s.speaking[userId]);
  const showProfile = useUi((s) => s.showProfile);
  return (
    <li>
      <button
        type="button"
        onClick={(e) => showProfile(userId, serverId, { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top, w: e.currentTarget.offsetWidth, h: 0 })}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-start text-text-2 hover:bg-hover"
      >
        <Avatar user={user} size={22} speaking={speaking} />
        <span className={cx('flex-1 truncate text-[14px]', speaking && 'text-text-1')}>{name}</span>
        {participant.screen && (
          <span title={t('voice.sharingScreen')} className="flex items-center gap-1 rounded bg-danger px-1 text-[11px] font-bold text-white">
            <MonitorUp size={11} /> {t('voice.live')}
          </span>
        )}
        {participant.video && <Video size={14} aria-label={t('voice.cameraOn')} />}
        {(participant.selfMute || participant.serverMute) && <MicOff size={14} className={participant.serverMute ? 'text-danger-text' : ''} aria-label={t('voice.muted')} />}
        {(participant.selfDeaf || participant.serverDeaf) && <Headphones size={14} className="text-danger-text" aria-label={t('voice.deafened')} />}
      </button>
    </li>
  );
}
