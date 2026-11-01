import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Clock, Gamepad2, MessageCircle, MoreHorizontal, Plus, UserMinus, UserPlus, Volume2, X } from 'lucide-react';
import type { UserProfile } from '@shared/types';
import { errorText, useT } from '../../i18n';
import { api } from '../../lib/api';
import { openDm } from '../../lib/actions';
import { memberSince } from '../../lib/format';
import { has, outranks, P, serverPerms } from '../../lib/perms';
import { useVoice, voice, getVoicePrefs } from '../../lib/voice';
import { useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, Button, confirmDialog, cx, Menu, Popover, toast, type Anchor } from '../ui';

const TIMEOUTS = [60, 300, 600, 3600, 86400, 604800];

export function ProfileCard() {
  const t = useT();
  const navigate = useNavigate();
  const profile = useUi((s) => s.profile);
  const hide = useUi((s) => s.hideProfile);
  const user = useStore((s) => (profile ? s.users[profile.userId] : undefined));
  const member = useStore((s) => (profile?.serverId ? s.members[profile.serverId]?.[profile.userId] : undefined));
  const roles = useStore((s) => (profile?.serverId ? s.servers[profile.serverId]?.roles : undefined));
  const me = useStore((s) => s.me);
  const relationship = useStore((s) => (profile ? s.relationships[profile.userId] : undefined));
  const inVoice = useVoice((s) => s.channelId !== null);
  const [details, setDetails] = useState<UserProfile | null>(null);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [roleMenu, setRoleMenu] = useState<Anchor | null>(null);
  const [volume, setVolume] = useState(100);

  useEffect(() => {
    setDetails(null);
    if (!profile) return;
    setVolume(getVoicePrefs().volumes[String(profile.userId)] ?? 100);
    api
      .get<UserProfile>(`/api/users/${profile.userId}`)
      .then((p) => {
        setDetails(p);
        useStore.getState().upsertUsers([p.user]);
      })
      .catch(() => undefined);
  }, [profile]);

  if (!profile) return null;
  const shown = user ?? details?.user;
  if (!shown) return null;
  const state = useStore.getState();
  const serverId = profile.serverId;
  const perms = serverId ? serverPerms(state, serverId) : 0;
  const canModerate = serverId ? outranks(state, serverId, profile.userId) : false;
  const isMe = me?.id === profile.userId;
  const myRoles = roles?.filter((r) => !r.isDefault && member?.roles.includes(r.id)).sort((a, b) => b.position - a.position) ?? [];
  const assignable = roles?.filter((r) => !r.isDefault && !member?.roles.includes(r.id) && (state.servers[serverId!]?.server.ownerId === me?.id || r.position < topOf(serverId!))) ?? [];

  function topOf(sid: number) {
    const mine = state.members[sid]?.[me!.id]?.roles ?? [];
    return Math.max(0, ...(state.servers[sid]?.roles.filter((r) => mine.includes(r.id)).map((r) => r.position) ?? []));
  }

  const call = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const message = async () => {
    const ch = await openDm(profile.userId);
    hide();
    if (ch) navigate(`/channels/@me/${ch.id}`);
  };

  return (
    <Popover anchor={profile.anchor} onClose={hide} placement="side" className="w-[320px] overflow-hidden">
      <div className="h-16" style={{ background: shown.bannerColor ?? 'var(--accent-soft)' }} />
      <div className="px-4 pb-4">
        <div className="-mt-9 flex items-end justify-between">
          <Avatar user={shown} size={76} status={shown.status} ring="var(--bg-3)" className="rounded-full ring-[5px] ring-bg-3" />
          {!isMe && (
            <button
              type="button"
              aria-label={t('common.more')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.left, y: r.top, w: r.width, h: r.height });
              }}
              className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-bg-0/70 text-text-2 hover:text-text-1"
            >
              <MoreHorizontal size={18} />
            </button>
          )}
        </div>
        <div className="mt-2">
          <div className="font-display text-[22px] leading-tight text-text-1">{member?.nickname || shown.displayName}</div>
          <div className="text-[13px] text-text-3" dir="ltr" style={{ textAlign: 'start' }}>
            @{shown.username}
          </div>
          {shown.customStatus && <p className="mt-2 text-[14px] text-text-2">{shown.customStatus}</p>}
          {shown.activity && (
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-bg-0/50 px-2.5 py-2 text-[13px] text-text-2">
              <Gamepad2 size={16} className="shrink-0 text-accent" />
              {t('presence.playing', { game: shown.activity })}
            </p>
          )}
        </div>

        {shown.bio && (
          <section className="mt-3">
            <h4 className="text-[12px] font-semibold text-text-3">{t('profile.about')}</h4>
            <p dir="auto" className="mt-1 whitespace-pre-wrap text-[14px] text-text-2">
              {shown.bio}
            </p>
          </section>
        )}

        <section className="mt-3">
          <h4 className="text-[12px] font-semibold text-text-3">{t('profile.memberSince')}</h4>
          <p className="mt-0.5 text-[13px] text-text-2">{memberSince(shown.createdAt)}</p>
        </section>

        {serverId && member && (
          <section className="mt-3">
            <h4 className="text-[12px] font-semibold text-text-3">{t('profile.roles')}</h4>
            <div className="mt-1 flex flex-wrap gap-1">
              {myRoles.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1 rounded-md bg-bg-0/50 px-1.5 py-0.5 text-[12px] text-text-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ?? 'var(--text-3)' }} />
                  {r.name}
                  {has(perms, P.MANAGE_ROLES) && assignableRemove(r.position) && (
                    <button
                      type="button"
                      aria-label={t('profile.removeRole', { role: r.name })}
                      onClick={() => call(() => api.del(`/api/servers/${serverId}/members/${profile.userId}/roles/${r.id}`))}
                      className="text-text-3 hover:text-danger-text"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
              {has(perms, P.MANAGE_ROLES) && assignable.length > 0 && (
                <button
                  type="button"
                  aria-label={t('profile.addRole')}
                  title={t('profile.addRole')}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setRoleMenu({ x: r.left, y: r.top, w: r.width, h: r.height });
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-bg-0/50 text-text-2 hover:text-text-1"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
          </section>
        )}

        {details && !isMe && (details.mutualServers.length > 0 || details.mutualFriends.length > 0) && (
          <p className="mt-3 text-[12px] text-text-3">
            {t('profile.mutual', { servers: details.mutualServers.length, friends: details.mutualFriends.length })}
          </p>
        )}

        {inVoice && !isMe && (
          <label className="mt-3 flex items-center gap-2 text-[12px] text-text-3">
            <Volume2 size={14} />
            <span className="shrink-0">{t('voice.userVolume')}</span>
            <input
              type="range"
              min={0}
              max={200}
              value={volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                voice.setUserVolume(profile.userId, Number(e.target.value));
              }}
              className="flex-1 accent-[var(--accent)]"
            />
          </label>
        )}

        {!isMe && (
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" onClick={() => void message()}>
              <MessageCircle size={16} /> {t('profile.message')}
            </Button>
            {!relationship && (
              <Button variant="secondary" onClick={() => call(() => api.post('/api/relationships', { username: shown.username }), t('friends.requestSent'))}>
                <UserPlus size={16} />
              </Button>
            )}
          </div>
        )}
        {isMe && (
          <Button variant="secondary" className="mt-4 w-full" onClick={() => useUi.getState().open({ type: 'userSettings', tab: 'profile' })}>
            {t('profile.edit')}
          </Button>
        )}
      </div>

      <Menu
        anchor={roleMenu}
        onClose={() => setRoleMenu(null)}
        items={assignable.map((r) => ({
          label: r.name,
          icon: <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color ?? 'var(--text-3)' }} />,
          onSelect: () => void call(() => api.put(`/api/servers/${serverId}/members/${profile.userId}/roles/${r.id}`)),
        }))}
      />
      <Menu
        anchor={menu}
        onClose={() => setMenu(null)}
        items={[
          {
            label: relationship === 'friend' ? t('friends.remove') : t('friends.add'),
            icon: relationship === 'friend' ? <UserMinus size={16} /> : <UserPlus size={16} />,
            hidden: relationship === 'blocked' || relationship === 'outgoing',
            onSelect: () =>
              void call(() =>
                relationship === 'friend' ? api.del(`/api/relationships/${profile.userId}`) : api.post('/api/relationships', { username: shown.username }),
              ),
          },
          {
            label: relationship === 'blocked' ? t('friends.unblock') : t('friends.block'),
            icon: <Ban size={16} />,
            onSelect: () =>
              void call(() => (relationship === 'blocked' ? api.del(`/api/relationships/${profile.userId}`) : api.put(`/api/relationships/${profile.userId}/block`))),
          },
          'divider',
          ...TIMEOUTS.map((secs) => ({
            label: t('mod.timeoutFor', { duration: t(`duration.${secs}`) }),
            icon: <Clock size={16} />,
            hidden: !serverId || !canModerate || !has(perms, P.MODERATE_MEMBERS) || !!member?.timeoutUntil,
            onSelect: () =>
              void call(
                () => api.patch(`/api/servers/${serverId}/members/${profile.userId}`, { timeoutUntil: new Date(Date.now() + secs * 1000).toISOString() }),
                t('mod.timedOut'),
              ),
          })),
          {
            label: t('mod.removeTimeout'),
            icon: <Clock size={16} />,
            hidden: !serverId || !canModerate || !has(perms, P.MODERATE_MEMBERS) || !member?.timeoutUntil,
            onSelect: () => void call(() => api.patch(`/api/servers/${serverId}/members/${profile.userId}`, { timeoutUntil: null })),
          },
          {
            label: t('mod.kick'),
            icon: <UserMinus size={16} />,
            danger: true,
            hidden: !serverId || !canModerate || !has(perms, P.KICK_MEMBERS),
            onSelect: async () => {
              if (!(await confirmDialog({ title: t('mod.kickTitle', { name: shown.displayName }), body: t('mod.kickBody'), confirmText: t('mod.kick'), danger: true }))) return;
              await call(() => api.del(`/api/servers/${serverId}/members/${profile.userId}`), t('mod.kicked'));
              hide();
            },
          },
          {
            label: t('mod.ban'),
            icon: <Ban size={16} />,
            danger: true,
            hidden: !serverId || !canModerate || !has(perms, P.BAN_MEMBERS),
            onSelect: async () => {
              if (!(await confirmDialog({ title: t('mod.banTitle', { name: shown.displayName }), body: t('mod.banBody'), confirmText: t('mod.ban'), danger: true }))) return;
              await call(() => api.put(`/api/servers/${serverId}/bans/${profile.userId}`, { deleteMessageSeconds: 3600 }), t('mod.banned'));
              hide();
            },
          },
        ]}
      />
    </Popover>
  );

  function assignableRemove(position: number) {
    return state.servers[serverId!]?.server.ownerId === me?.id || position < topOf(serverId!);
  }
}

export { cx };
