import { useEffect, useMemo } from 'react';
import type { Member } from '@shared/types';
import { num, useT } from '../../i18n';
import { loadMembers } from '../../lib/actions';
import { useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, cx, Spinner } from '../ui';

export function MemberList({ serverId }: { serverId: number }) {
  const t = useT();
  const members = useStore((s) => s.members[serverId]);
  const loaded = useStore((s) => s.membersLoaded[serverId]);
  const roles = useStore((s) => s.servers[serverId]?.roles);
  const users = useStore((s) => s.users);
  const ownerId = useStore((s) => s.servers[serverId]?.server.ownerId);
  const showProfile = useUi((s) => s.showProfile);

  useEffect(() => {
    void loadMembers(serverId).catch(() => undefined);
  }, [serverId]);

  const groups = useMemo(() => {
    if (!members || !roles) return [];
    const list = Object.values(members);
    const hoisted = [...roles].filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
    const online = (m: Member) => (users[m.userId]?.status ?? m.user.status) !== 'offline';
    const byName = (a: Member, b: Member) => (a.nickname || a.user.displayName).localeCompare(b.nickname || b.user.displayName);
    const used = new Set<number>();
    const out: { key: string; label: string; color?: string | null; members: Member[] }[] = [];
    for (const r of hoisted) {
      const inRole = list.filter((m) => online(m) && !used.has(m.userId) && m.roles.includes(r.id)).sort(byName);
      inRole.forEach((m) => used.add(m.userId));
      if (inRole.length) out.push({ key: `r${r.id}`, label: r.name, color: r.color, members: inRole });
    }
    const rest = list.filter((m) => online(m) && !used.has(m.userId)).sort(byName);
    if (rest.length) out.push({ key: 'online', label: t('members.online'), members: rest });
    const offline = list.filter((m) => !online(m)).sort(byName);
    if (offline.length) out.push({ key: 'offline', label: t('members.offline'), members: offline });
    return out;
  }, [members, roles, users, t]);

  return (
    <aside aria-label={t('members.title')} className="hidden w-60 shrink-0 flex-col overflow-y-auto bg-bg-1 px-2 py-3 lg:flex">
      {!loaded && (
        <div className="flex justify-center py-6 text-text-3">
          <Spinner />
        </div>
      )}
      {groups.map((g) => (
        <section key={g.key} className="mb-4">
          <h3 className="mb-1 px-2 text-[13px] font-semibold text-text-3">
            {g.label} — {num(g.members.length)}
          </h3>
          <ul>
            {g.members.map((m) => {
              const user = users[m.userId] ?? m.user;
              const top = roles
                ?.filter((r) => r.color && m.roles.includes(r.id))
                .sort((a, b) => b.position - a.position)[0];
              const offline = user.status === 'offline';
              return (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      showProfile(m.userId, serverId, { x: r.left, y: r.top, w: r.width, h: r.height });
                    }}
                    className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-hover', offline && 'opacity-50 hover:opacity-100')}
                  >
                    <Avatar user={user} size={32} status={user.status} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-[15px] font-medium" style={{ color: top?.color ?? 'var(--text-2)' }}>
                          {m.nickname || user.displayName}
                        </span>
                        {m.userId === ownerId && (
                          <span title={t('members.owner')} aria-label={t('members.owner')} className="text-saffron">
                            ★
                          </span>
                        )}
                      </span>
                      {(user.activity || user.customStatus) && !offline && (
                        <span className="block truncate text-[12px] text-text-3">
                          {user.activity ? t('presence.playing', { game: user.activity }) : user.customStatus}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </aside>
  );
}
