import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, Copy, Minus, Plus, Trash2, Upload, X } from 'lucide-react';
import type { AuditLogEntry, Ban, Channel, Invite, Member, Overwrite, Role, SelfUser, Server, Webhook } from '@shared/types';
import { CHANNEL_PERMISSIONS, PERMISSION_GROUPS, P, type PermissionName } from '@shared/permissions';
import { EMOJI_NAME_RE, LIMITS } from '@shared/constants';
import { errorText, num, setLang, useLang, useT } from '../../i18n';
import { api } from '../../lib/api';
import { loadMembers, logout, updateProfile } from '../../lib/actions';
import { fullDate, memberSince, relative } from '../../lib/format';
import { getNotifyPrefs, requestDesktopPermission, setNotifyPrefs } from '../../lib/notify';
import { has, outranks, serverPerms } from '../../lib/perms';
import { getVoicePrefs, setVoicePrefs, voice } from '../../lib/voice';
import { NO_EMOJIS, NO_ROLES, useStore } from '../../store';
import { Avatar, Button, confirmDialog, cx, Field, IconButton, Input, Select, ServerIcon, Spinner, Switch, TextArea, toast } from '../ui';

// ---------- layout ----------

interface TabDef {
  key: string;
  label: string;
  danger?: boolean;
  hidden?: boolean;
}

function SettingsLayout({ title, tabs, tab, setTab, onClose, children }: { title: string; tabs: (TabDef | string)[]; tab: string; setTab: (t: string) => void; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex bg-bg-2 max-md:flex-col">
      <nav className="flex shrink-0 justify-end overflow-y-auto bg-bg-1 md:w-[30%] md:min-w-[220px] md:py-12">
        <div className="flex w-full gap-1 overflow-x-auto p-2 md:w-52 md:flex-col md:p-0">
          <h2 className="hidden px-2.5 pb-2 text-[12px] font-semibold text-text-3 md:block">{title}</h2>
          {tabs.map((x, i) =>
            typeof x === 'string' ? (
              <h3 key={i} className="hidden px-2.5 pt-4 pb-1 text-[12px] font-semibold text-text-3 md:block">
                {x}
              </h3>
            ) : x.hidden ? null : (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                aria-current={tab === x.key ? 'page' : undefined}
                className={cx(
                  'shrink-0 rounded-lg px-2.5 py-1.5 text-start text-[15px]',
                  tab === x.key ? 'bg-accent-soft text-text-1' : x.danger ? 'text-danger-text hover:bg-hover' : 'text-text-2 hover:bg-hover hover:text-text-1',
                )}
              >
                {x.label}
              </button>
            ),
          )}
        </div>
      </nav>
      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-[740px] px-6 py-8 md:px-10 md:py-12">{children}</div>
        <div className="fixed end-4 top-4 md:end-8 md:top-10">
          <button type="button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')} className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-text-3 text-text-2 hover:border-text-1 hover:text-text-1">
            <X size={20} />
          </button>
        </div>
      </main>
    </div>,
    document.body,
  );
}

function H({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-[26px] text-text-1">{children}</h2>
      {sub && <p className="mt-1 text-[14px] text-text-3">{sub}</p>}
    </div>
  );
}

async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (ok) toast(ok, 'success');
    return r;
  } catch (err) {
    toast(errorText(err), 'error');
    return null;
  }
}

const ROLE_COLORS = ['#2ec4b6', '#f2b33d', '#e5484d', '#7c8cf8', '#3ccb7f', '#f07fbf', '#58a6ff', '#c58af9', '#ff8a3d', '#a9b7cc'];

// ---------- server settings ----------

export function ServerSettings({ serverId, initialTab, onClose }: { serverId: number; initialTab?: string; onClose: () => void }) {
  const t = useT();
  const entry = useStore((s) => s.servers[serverId]);
  const perms = useStore((s) => serverPerms(s, serverId));
  const me = useStore((s) => s.me);
  const isOwner = entry?.server.ownerId === me?.id;
  const [tab, setTab] = useState(initialTab ?? (has(perms, P.MANAGE_SERVER) ? 'overview' : 'notifications'));
  if (!entry) return null;
  const tabs: (TabDef | string)[] = [
    entry.server.name,
    { key: 'overview', label: t('ss.overview'), hidden: !has(perms, P.MANAGE_SERVER) },
    { key: 'roles', label: t('ss.roles'), hidden: !has(perms, P.MANAGE_ROLES) },
    { key: 'emojis', label: t('ss.emojis'), hidden: !has(perms, P.MANAGE_EMOJIS) },
    { key: 'webhooks', label: t('ss.webhooks'), hidden: !has(perms, P.MANAGE_WEBHOOKS) },
    { key: 'notifications', label: t('ss.notifications') },
    t('ss.moderation'),
    { key: 'members', label: t('ss.members'), hidden: !(has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS) || has(perms, P.MANAGE_ROLES) || has(perms, P.MODERATE_MEMBERS)) },
    { key: 'invites', label: t('ss.invites'), hidden: !has(perms, P.MANAGE_SERVER) },
    { key: 'bans', label: t('ss.bans'), hidden: !has(perms, P.BAN_MEMBERS) },
    { key: 'audit', label: t('ss.audit'), hidden: !has(perms, P.VIEW_AUDIT_LOG) },
    { key: 'delete', label: t('ss.delete'), danger: true, hidden: !isOwner },
  ];
  return (
    <SettingsLayout title={entry.server.name} tabs={tabs} tab={tab} setTab={setTab} onClose={onClose}>
      {tab === 'overview' && <ServerOverview server={entry.server} isOwner={isOwner} />}
      {tab === 'roles' && <RolesTab serverId={serverId} />}
      {tab === 'emojis' && <EmojisTab serverId={serverId} />}
      {tab === 'webhooks' && <WebhooksTab serverId={serverId} />}
      {tab === 'notifications' && <NotificationsTab serverId={serverId} />}
      {tab === 'members' && <MembersTab serverId={serverId} />}
      {tab === 'invites' && <InvitesTab serverId={serverId} />}
      {tab === 'bans' && <BansTab serverId={serverId} />}
      {tab === 'audit' && <AuditTab serverId={serverId} />}
      {tab === 'delete' && <DeleteServerTab server={entry.server} onDone={onClose} />}
    </SettingsLayout>
  );
}

function ServerOverview({ server, isOwner }: { server: Server; isOwner: boolean }) {
  const t = useT();
  const channels = useStore((s) => s.channels);
  const members = useStore((s) => s.members[server.id]);
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [isPublic, setPublic] = useState(server.isPublic);
  const [systemChannelId, setSystem] = useState(server.systemChannelId ? String(server.systemChannelId) : '');
  const [owner, setOwner] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void loadMembers(server.id);
  }, [server.id]);
  const textChannels = Object.values(channels).filter((c) => c.serverId === server.id && c.type === 'text');
  const dirty = name !== server.name || description !== server.description || isPublic !== server.isPublic || systemChannelId !== String(server.systemChannelId ?? '');
  return (
    <>
      <H>{t('ss.overview')}</H>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-5">
          <span className="overflow-hidden rounded-2xl bg-bg-3 text-text-1">
            <ServerIcon name={server.name} icon={server.icon} size={88} />
          </span>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-text-3">{t('ss.iconHint')}</p>
            <div className="flex gap-2">
              <Button variant="secondary" small onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> {t('ss.uploadIcon')}
              </Button>
              {server.icon && (
                <Button variant="ghost" small onClick={() => void run(() => api.del(`/api/servers/${server.id}/icon`))}>
                  {t('common.remove')}
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const form = new FormData();
                form.append('file', f);
                const sv = await run(() => api.upload<Server>('PUT', `/api/servers/${server.id}/icon`, form));
                if (sv) useStore.getState().updateServer(sv);
              }}
            />
          </div>
        </div>
        <Field label={t('ss.serverName')}>{(id) => <Input id={id} value={name} maxLength={LIMITS.serverNameMax} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('ss.description')} hint={t('ss.descriptionHint')}>
          {(id) => <TextArea id={id} value={description} maxLength={LIMITS.serverDescriptionMax} rows={3} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <Field label={t('ss.systemChannel')} hint={t('ss.systemChannelHint')}>
          {(id) => (
            <Select
              id={id}
              value={systemChannelId}
              onChange={setSystem}
              options={[{ value: '', label: t('ss.noSystemChannel') }, ...textChannels.map((c) => ({ value: String(c.id), label: `#${c.name}` }))]}
            />
          )}
        </Field>
        <Switch checked={isPublic} onChange={setPublic} label={t('ss.public')} description={t('ss.publicHint')} />
        <div>
          <Button
            disabled={!dirty || !name.trim()}
            onClick={async () => {
              const sv = await run(
                () => api.patch<Server>(`/api/servers/${server.id}`, { name: name.trim(), description, isPublic, systemChannelId: systemChannelId ? Number(systemChannelId) : null }),
                t('common.saved'),
              );
              if (sv) useStore.getState().updateServer(sv);
            }}
          >
            {t('common.save')}
          </Button>
        </div>
        {isOwner && members && (
          <section className="mt-4 border-t border-line pt-6">
            <h3 className="font-semibold text-text-1">{t('ss.transfer')}</h3>
            <p className="mb-3 text-[13px] text-text-3">{t('ss.transferHint')}</p>
            <div className="flex gap-2">
              <Select
                value={owner}
                onChange={setOwner}
                options={[{ value: '', label: t('ss.pickMember') }, ...Object.values(members).filter((m) => m.userId !== server.ownerId).map((m) => ({ value: String(m.userId), label: m.nickname || m.user.displayName }))]}
              />
              <Button
                variant="danger"
                disabled={!owner}
                onClick={async () => {
                  if (!(await confirmDialog({ title: t('ss.transfer'), body: t('ss.transferConfirm'), confirmText: t('ss.transfer'), danger: true }))) return;
                  await run(() => api.patch(`/api/servers/${server.id}`, { ownerId: Number(owner) }), t('common.saved'));
                }}
              >
                {t('ss.transfer')}
              </Button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function PermissionToggles({ value, onChange, mask, tri, overwrite }: { value: number; onChange: (v: number) => void; mask?: number; tri?: false; overwrite?: undefined }): React.ReactElement;
function PermissionToggles(props: { value?: undefined; onChange?: undefined; mask?: number; tri: true; overwrite: { allow: number; deny: number }; onOverwrite: (o: { allow: number; deny: number }) => void }): React.ReactElement;
function PermissionToggles(props: {
  value?: number;
  onChange?: (v: number) => void;
  mask?: number;
  tri?: boolean;
  overwrite?: { allow: number; deny: number };
  onOverwrite?: (o: { allow: number; deny: number }) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      {PERMISSION_GROUPS.map((g) => {
        const perms = g.perms.filter((p) => !props.mask || (props.mask & P[p]) !== 0);
        if (!perms.length) return null;
        return (
          <section key={g.key}>
            <h4 className="mb-1 text-[13px] font-semibold text-text-3">{t(`perm.group.${g.key}`)}</h4>
            <div className="divide-y divide-line/60">
              {perms.map((p: PermissionName) =>
                props.tri ? (
                  <TriToggle key={p} perm={p} value={props.overwrite!} onChange={props.onOverwrite!} />
                ) : (
                  <Switch
                    key={p}
                    checked={(props.value! & P[p]) !== 0}
                    onChange={(on) => props.onChange!(on ? props.value! | P[p] : props.value! & ~P[p])}
                    label={t(`perm.${p}`)}
                    description={t(`perm.${p}.hint`)}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TriToggle({ perm, value, onChange }: { perm: PermissionName; value: { allow: number; deny: number }; onChange: (o: { allow: number; deny: number }) => void }) {
  const t = useT();
  const bit = P[perm];
  const state = value.allow & bit ? 'allow' : value.deny & bit ? 'deny' : 'inherit';
  const set = (s: 'allow' | 'deny' | 'inherit') =>
    onChange({ allow: s === 'allow' ? value.allow | bit : value.allow & ~bit, deny: s === 'deny' ? value.deny | bit : value.deny & ~bit });
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="flex-1">
        <div className="text-[15px] text-text-1">{t(`perm.${perm}`)}</div>
        <div className="text-[12px] text-text-3">{t(`perm.${perm}.hint`)}</div>
      </div>
      <div role="radiogroup" aria-label={t(`perm.${perm}`)} className="flex overflow-hidden rounded-lg border border-line">
        {(['deny', 'inherit', 'allow'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={state === s}
            aria-label={t(`perm.state.${s}`)}
            title={t(`perm.state.${s}`)}
            onClick={() => set(s)}
            className={cx(
              'flex h-8 w-9 items-center justify-center',
              state === s ? (s === 'allow' ? 'bg-accent text-accent-ink' : s === 'deny' ? 'bg-danger text-white' : 'bg-bg-4 text-text-1') : 'text-text-3 hover:bg-hover',
            )}
          >
            {s === 'allow' ? <Check size={16} /> : s === 'deny' ? <X size={16} /> : <Minus size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function RolesTab({ serverId }: { serverId: number }) {
  const t = useT();
  const roles = useStore((s) => s.servers[serverId]?.roles ?? NO_ROLES);
  const sorted = useMemo(() => [...roles].sort((a, b) => b.position - a.position), [roles]);
  const [selected, setSelected] = useState<number | null>(sorted.find((r) => !r.isDefault)?.id ?? sorted[0]?.id ?? null);
  const role = roles.find((r) => r.id === selected) ?? null;
  const movable = sorted.filter((r) => !r.isDefault);
  const move = async (r: Role, dir: -1 | 1) => {
    const ids = movable.map((x) => x.id);
    const i = ids.indexOf(r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const updated = await run(() => api.put<Role[]>(`/api/servers/${serverId}/roles/order`, ids));
    if (updated) useStore.getState().setRoles(serverId, updated);
  };
  return (
    <>
      <H sub={t('ss.rolesHint')}>{t('ss.roles')}</H>
      <div className="flex gap-6 max-md:flex-col">
        <div className="flex w-56 shrink-0 flex-col gap-1">
          <Button
            small
            onClick={async () => {
              const r = await run(() => api.post<Role>(`/api/servers/${serverId}/roles`, { name: t('ss.newRole') }));
              if (r) setSelected(r.id);
            }}
          >
            <Plus size={15} /> {t('ss.createRole')}
          </Button>
          <ul className="mt-2 flex flex-col gap-0.5">
            {sorted.map((r) => (
              <li key={r.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelected(r.id)}
                  className={cx('flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[14px]', selected === r.id ? 'bg-accent-soft text-text-1' : 'text-text-2 hover:bg-hover')}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color ?? 'var(--text-3)' }} />
                  <span className="truncate">{r.isDefault ? '@everyone' : r.name}</span>
                </button>
                {!r.isDefault && (
                  <span className="hidden gap-0.5 group-hover:flex">
                    <IconButton label={t('ss.moveUp')} onClick={() => void move(r, -1)} className="h-6 w-6">
                      <ArrowUp size={13} />
                    </IconButton>
                    <IconButton label={t('ss.moveDown')} onClick={() => void move(r, 1)} className="h-6 w-6">
                      <ArrowDown size={13} />
                    </IconButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        {role && <RoleEditor key={role.id} role={role} onDeleted={() => setSelected(null)} />}
      </div>
    </>
  );
}

function RoleEditor({ role, onDeleted }: { role: Role; onDeleted: () => void }) {
  const t = useT();
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState<string | null>(role.color);
  const [hoist, setHoist] = useState(role.hoist);
  const [mentionable, setMentionable] = useState(role.mentionable);
  const [permissions, setPermissions] = useState(role.permissions);
  const dirty = name !== role.name || color !== role.color || hoist !== role.hoist || mentionable !== role.mentionable || permissions !== role.permissions;
  const save = () =>
    run(() => api.patch(`/api/roles/${role.id}`, role.isDefault ? { permissions } : { name: name.trim(), color, hoist, mentionable, permissions }), t('common.saved'));
  return (
    <div className="min-w-0 flex-1">
      {!role.isDefault && (
        <div className="mb-6 flex flex-col gap-4">
          <Field label={t('ss.roleName')}>{(id) => <Input id={id} value={name} maxLength={LIMITS.roleNameMax} onChange={(e) => setName(e.target.value)} />}</Field>
          <div>
            <span className="text-[13px] font-semibold text-text-2">{t('ss.roleColor')}</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" aria-label={t('ss.noColor')} onClick={() => setColor(null)} className={cx('flex h-8 w-8 items-center justify-center rounded-lg border border-line', !color && 'ring-2 ring-accent')}>
                <X size={14} />
              </button>
              {ROLE_COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={cx('h-8 w-8 rounded-lg', color === c && 'ring-2 ring-text-1 ring-offset-2 ring-offset-bg-2')} style={{ background: c }} />
              ))}
              <input type="color" aria-label={t('ss.customColor')} value={color ?? '#a9b7cc'} onChange={(e) => setColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent" />
            </div>
          </div>
          <Switch checked={hoist} onChange={setHoist} label={t('ss.hoist')} description={t('ss.hoistHint')} />
          <Switch checked={mentionable} onChange={setMentionable} label={t('ss.mentionable')} description={t('ss.mentionableHint')} />
        </div>
      )}
      {role.isDefault && <p className="mb-4 text-[14px] text-text-3">{t('ss.everyoneHint')}</p>}
      <PermissionToggles value={permissions} onChange={setPermissions} />
      <div className="sticky bottom-0 mt-6 flex gap-2 bg-bg-2 py-3">
        <Button disabled={!dirty} onClick={() => void save()}>
          {t('common.save')}
        </Button>
        {!role.isDefault && (
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await confirmDialog({ title: t('ss.deleteRole', { name: role.name }), body: t('ss.deleteRoleBody'), confirmText: t('common.delete'), danger: true }))) return;
              if (await run(() => api.del(`/api/roles/${role.id}`))) onDeleted();
            }}
          >
            {t('common.delete')}
          </Button>
        )}
      </div>
    </div>
  );
}

function MembersTab({ serverId }: { serverId: number }) {
  const t = useT();
  const members = useStore((s) => s.members[serverId]);
  const roles = useStore((s) => s.servers[serverId]?.roles ?? NO_ROLES);
  const perms = useStore((s) => serverPerms(s, serverId));
  const [q, setQ] = useState('');
  useEffect(() => {
    void loadMembers(serverId, true);
  }, [serverId]);
  if (!members) return <Spinner />;
  const list = Object.values(members)
    .filter((m) => (m.nickname ?? m.user.displayName).toLowerCase().includes(q.toLowerCase()) || m.user.username.includes(q.toLowerCase()))
    .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  return (
    <>
      <H sub={t('ss.membersHint', { count: Object.keys(members).length })}>{t('ss.members')}</H>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ss.searchMembers')} aria-label={t('ss.searchMembers')} className="mb-4" />
      <ul className="divide-y divide-line/60">
        {list.map((m) => (
          <MemberRow key={m.userId} m={m} roles={roles} perms={perms} serverId={serverId} />
        ))}
      </ul>
    </>
  );
}

function MemberRow({ m, roles, perms, serverId }: { m: Member; roles: Role[]; perms: number; serverId: number }) {
  const t = useT();
  const canAct = useStore((s) => outranks(s, serverId, m.userId));
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <Avatar user={m.user} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-text-1">{m.nickname || m.user.displayName}</div>
          <div className="text-[12px] text-text-3">
            @{m.user.username} — {t('ss.joined', { date: memberSince(m.joinedAt) })}
            {m.timeoutUntil && <span className="ms-2 text-saffron">{t('ss.timedOutUntil', { time: relative(m.timeoutUntil) })}</span>}
          </div>
        </div>
        {canAct && (
          <div className="flex gap-1.5">
            {has(perms, P.MANAGE_ROLES) && (
              <Button variant="secondary" small onClick={() => setOpen((v) => !v)} aria-expanded={open}>
                {t('profile.roles')}
              </Button>
            )}
            {has(perms, P.MODERATE_MEMBERS) && (
              <Button
                variant="secondary"
                small
                onClick={() =>
                  void run(
                    () => api.patch(`/api/servers/${serverId}/members/${m.userId}`, { timeoutUntil: m.timeoutUntil ? null : new Date(Date.now() + 600_000).toISOString() }),
                    m.timeoutUntil ? undefined : t('mod.timedOut'),
                  )
                }
              >
                {m.timeoutUntil ? t('mod.removeTimeout') : t('mod.timeout10')}
              </Button>
            )}
            {has(perms, P.KICK_MEMBERS) && (
              <Button
                variant="ghost"
                small
                onClick={async () => {
                  if (await confirmDialog({ title: t('mod.kickTitle', { name: m.user.displayName }), body: t('mod.kickBody'), confirmText: t('mod.kick'), danger: true }))
                    await run(() => api.del(`/api/servers/${serverId}/members/${m.userId}`), t('mod.kicked'));
                }}
              >
                {t('mod.kick')}
              </Button>
            )}
            {has(perms, P.BAN_MEMBERS) && (
              <Button
                variant="danger"
                small
                onClick={async () => {
                  if (await confirmDialog({ title: t('mod.banTitle', { name: m.user.displayName }), body: t('mod.banBody'), confirmText: t('mod.ban'), danger: true }))
                    await run(() => api.put(`/api/servers/${serverId}/bans/${m.userId}`, {}), t('mod.banned'));
                }}
              >
                {t('mod.ban')}
              </Button>
            )}
          </div>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5 ps-12">
          {roles
            .filter((r) => !r.isDefault)
            .sort((a, b) => b.position - a.position)
            .map((r) => {
              const on = m.roles.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void run(() => (on ? api.del : api.put)(`/api/servers/${serverId}/members/${m.userId}/roles/${r.id}`))}
                  className={cx('flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[13px]', on ? 'border-accent bg-accent-soft text-text-1' : 'border-line text-text-2 hover:border-text-3')}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ?? 'var(--text-3)' }} />
                  {r.name}
                </button>
              );
            })}
        </div>
      )}
    </li>
  );
}

function InvitesTab({ serverId }: { serverId: number }) {
  const t = useT();
  const [list, setList] = useState<Invite[] | null>(null);
  const load = () => api.get<Invite[]>(`/api/servers/${serverId}/invites`).then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  if (!list) return <Spinner />;
  return (
    <>
      <H sub={t('ss.invitesHint')}>{t('ss.invites')}</H>
      {list.length === 0 ? (
        <p className="text-[14px] text-text-3">{t('ss.noInvites')}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {list.map((inv) => (
            <li key={inv.code} className="flex items-center gap-3 py-3">
              <Avatar user={inv.inviter} size={28} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[14px] text-text-1" dir="ltr" style={{ textAlign: 'start' }}>
                  {inv.code}
                </div>
                <div className="text-[12px] text-text-3">
                  {t('ss.inviteUses', { uses: inv.uses, max: inv.maxUses || '∞' })}
                  {inv.expiresAt && <span className="ms-3">{t('ss.expires', { time: relative(inv.expiresAt) })}</span>}
                </div>
              </div>
              <IconButton label={t('invite.copy')} onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}/invite/${inv.code}`)}>
                <Copy size={16} />
              </IconButton>
              <IconButton label={t('ss.revoke')} danger onClick={async () => (await run(() => api.del(`/api/invites/${inv.code}`))) && void load()}>
                <Trash2 size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BansTab({ serverId }: { serverId: number }) {
  const t = useT();
  const [list, setList] = useState<Ban[] | null>(null);
  const load = () => api.get<Ban[]>(`/api/servers/${serverId}/bans`).then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  if (!list) return <Spinner />;
  return (
    <>
      <H sub={t('ss.bansHint')}>{t('ss.bans')}</H>
      {list.length === 0 ? (
        <p className="text-[14px] text-text-3">{t('ss.noBans')}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {list.map((b) => (
            <li key={b.user.id} className="flex items-center gap-3 py-3">
              <Avatar user={b.user} size={32} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-text-1">{b.user.displayName}</div>
                <div className="text-[12px] text-text-3">{b.reason || t('ss.noReason')}</div>
              </div>
              <Button variant="secondary" small onClick={async () => (await run(() => api.del(`/api/servers/${serverId}/bans/${b.user.id}`))) && void load()}>
                {t('ss.unban')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EmojisTab({ serverId }: { serverId: number }) {
  const t = useT();
  const emojis = useStore((s) => s.servers[serverId]?.emojis ?? NO_EMOJIS);
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <H sub={t('ss.emojisHint', { max: LIMITS.emojisPerServer })}>{t('ss.emojis')}</H>
      <form
        className="mb-6 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file || !EMOJI_NAME_RE.test(name)) return;
          setBusy(true);
          const form = new FormData();
          form.append('name', name);
          form.append('file', file);
          if (await run(() => api.upload('POST', `/api/servers/${serverId}/emojis`, form), t('ss.emojiAdded'))) {
            setName('');
            setFile(null);
          }
          setBusy(false);
        }}
      >
        <Field label={t('ss.emojiName')} hint={t('ss.emojiNameHint')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} dir="ltr" className="w-48" />}
        </Field>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/gif,image/webp,image/jpeg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32));
          }}
        />
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {file ? file.name.slice(0, 20) : t('ss.chooseImage')}
        </Button>
        <Button type="submit" busy={busy} disabled={!file || !EMOJI_NAME_RE.test(name)}>
          {t('ss.addEmoji')}
        </Button>
      </form>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {emojis.map((e) => (
          <li key={e.id} className="flex items-center gap-3 rounded-lg bg-bg-1 px-3 py-2">
            <img src={e.url} alt="" className="h-8 w-8 object-contain" />
            <span className="flex-1 font-mono text-[14px]" dir="ltr" style={{ textAlign: 'start' }}>
              :{e.name}:
            </span>
            <IconButton label={t('common.delete')} danger onClick={() => void run(() => api.del(`/api/emojis/${e.id}`))}>
              <Trash2 size={16} />
            </IconButton>
          </li>
        ))}
      </ul>
    </>
  );
}

function WebhooksTab({ serverId }: { serverId: number }) {
  const t = useT();
  const channels = useStore((s) => s.channels);
  const textChannels = Object.values(channels).filter((c) => c.serverId === serverId && (c.type === 'text' || c.type === 'announcement'));
  const [list, setList] = useState<Webhook[] | null>(null);
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState(String(textChannels[0]?.id ?? ''));
  const load = () => api.get<Webhook[]>(`/api/servers/${serverId}/webhooks`).then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  return (
    <>
      <H sub={t('ss.webhooksHint')}>{t('ss.webhooks')}</H>
      <form
        className="mb-6 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !channelId) return;
          if (await run(() => api.post(`/api/channels/${channelId}/webhooks`, { name: name.trim() }))) {
            setName('');
            void load();
          }
        }}
      >
        <Field label={t('ss.webhookName')}>{(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="w-52" />}</Field>
        <Field label={t('ss.webhookChannel')}>
          {(id) => <Select id={id} value={channelId} onChange={setChannelId} options={textChannels.map((c) => ({ value: String(c.id), label: `#${c.name}` }))} className="w-52" />}
        </Field>
        <Button type="submit" disabled={!name.trim() || !channelId}>
          {t('ss.createWebhook')}
        </Button>
      </form>
      {!list ? (
        <Spinner />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((w) => (
            <li key={w.id} className="rounded-lg bg-bg-1 p-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-semibold text-text-1">{w.name}</span>
                <span className="text-[13px] text-text-3">#{channels[w.channelId]?.name}</span>
                <Button
                  variant="secondary"
                  small
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${window.location.origin}${w.url}`);
                    toast(t('ss.webhookCopied'), 'success');
                  }}
                >
                  <Copy size={14} /> {t('ss.copyUrl')}
                </Button>
                <IconButton label={t('common.delete')} danger onClick={async () => (await run(() => api.del(`/api/webhooks/${w.id}`))) && void load()}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
              <pre dir="ltr" className="mt-2 overflow-x-auto rounded bg-bg-0/60 p-2 text-start text-[12px] text-text-3">
                {`curl -X POST ${window.location.origin}${w.url} \\\n  -H "Content-Type: application/json" \\\n  -d '{"content":"Match started!"}'`}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NotificationsTab({ serverId }: { serverId: number }) {
  const t = useT();
  const settings = useStore((s) => s.servers[serverId]?.settings);
  if (!settings) return null;
  const save = async (patch: Partial<typeof settings>) => {
    const res = await run(() => api.patch<{ notifyLevel: 'all' | 'mentions' | 'none'; muted: boolean }>(`/api/servers/${serverId}/settings`, patch));
    if (res) useStore.getState().setSettings(serverId, { notifyLevel: res.notifyLevel, muted: res.muted });
  };
  return (
    <>
      <H sub={t('ss.notificationsHint')}>{t('ss.notifications')}</H>
      <div role="radiogroup" className="flex flex-col gap-2">
        {(['all', 'mentions', 'none'] as const).map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={settings.notifyLevel === level}
            onClick={() => void save({ notifyLevel: level })}
            className={cx('rounded-xl border p-3 text-start', settings.notifyLevel === level ? 'border-accent bg-accent-soft' : 'border-line hover:border-text-3')}
          >
            <span className="block font-semibold text-text-1">{t(`notify.level.${level}`)}</span>
            <span className="block text-[13px] text-text-3">{t(`notify.level.${level}Hint`)}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        <Switch checked={settings.muted} onChange={(muted) => void save({ muted })} label={t('ss.muteServer')} description={t('ss.muteServerHint')} />
      </div>
    </>
  );
}

const ACTION_KEYS = new Set([
  'server_update', 'channel_create', 'channel_update', 'channel_delete', 'overwrite_update', 'overwrite_delete', 'role_create', 'role_update', 'role_delete',
  'member_kick', 'member_ban', 'member_unban', 'member_timeout', 'member_update', 'member_role_add', 'member_role_remove', 'member_voice_update',
  'invite_create', 'invite_delete', 'emoji_create', 'emoji_update', 'emoji_delete', 'webhook_create', 'webhook_update', 'webhook_delete',
  'message_delete', 'message_pin', 'message_unpin', 'thread_update', 'ownership_transfer',
]);

function AuditTab({ serverId }: { serverId: number }) {
  const t = useT();
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const roles = useStore((s) => s.servers[serverId]?.roles ?? NO_ROLES);
  const [list, setList] = useState<AuditLogEntry[] | null>(null);
  const [more, setMore] = useState(true);
  const load = async (before?: number) => {
    const page = await api.get<AuditLogEntry[]>(`/api/servers/${serverId}/audit-log${before ? `?before=${before}` : ''}`).catch(() => []);
    setList((l) => (before ? [...(l ?? []), ...page] : page));
    setMore(page.length === 50);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);
  const target = (e: AuditLogEntry) => {
    const d = (e.details ?? {}) as Record<string, unknown>;
    if (e.targetType === 'user' && e.targetId) return users[e.targetId]?.displayName ?? `#${e.targetId}`;
    if (e.targetType === 'channel' && e.targetId) return `#${channels[e.targetId]?.name ?? d.name ?? e.targetId}`;
    if (e.targetType === 'role' && e.targetId) return roles.find((r) => r.id === e.targetId)?.name ?? String(d.name ?? '');
    if (typeof d.name === 'string') return d.name;
    if (typeof d.code === 'string') return d.code;
    return '';
  };
  if (!list) return <Spinner />;
  return (
    <>
      <H sub={t('ss.auditHint')}>{t('ss.audit')}</H>
      {list.length === 0 && <p className="text-[14px] text-text-3">{t('ss.noAudit')}</p>}
      <ul className="divide-y divide-line/60">
        {list.map((e) => (
          <li key={e.id} className="flex items-start gap-3 py-3">
            <Avatar user={e.actor} size={32} />
            <div className="min-w-0 flex-1 text-[14px]">
              <span className="font-semibold text-text-1">{e.actor?.displayName ?? t('message.deletedUser')}</span>{' '}
              <span className="text-text-2">{ACTION_KEYS.has(e.action) ? t(`audit.${e.action}`) : e.action}</span>{' '}
              <span className="font-semibold text-text-1">{target(e)}</span>
              {e.reason && <div className="text-[13px] text-text-3">{t('ss.reason', { reason: e.reason })}</div>}
              <div className="text-[12px] text-text-3" title={fullDate(e.createdAt)}>
                {relative(e.createdAt)}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {more && list.length > 0 && (
        <Button variant="secondary" small className="mt-3" onClick={() => void load(list[list.length - 1].id)}>
          {t('search.more')}
        </Button>
      )}
    </>
  );
}

function DeleteServerTab({ server, onDone }: { server: Server; onDone: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  return (
    <>
      <H sub={t('ss.deleteHint')}>{t('ss.delete')}</H>
      <Field label={t('ss.typeName', { name: server.name })}>{(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
      <Button
        variant="danger"
        className="mt-4"
        disabled={typed !== server.name}
        onClick={async () => {
          if (await run(() => api.del(`/api/servers/${server.id}`))) {
            onDone();
            navigate('/channels/@me');
          }
        }}
      >
        {t('ss.deleteForever')}
      </Button>
    </>
  );
}

// ---------- channel settings ----------

export function ChannelSettings({ channelId, onClose }: { channelId: number; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const channel = useStore((s) => s.channels[channelId]);
  const [tab, setTab] = useState('overview');
  if (!channel) return null;
  const tabs: (TabDef | string)[] = [
    channel.type === 'category' ? channel.name : `#${channel.name}`,
    { key: 'overview', label: t('cs.overview') },
    { key: 'permissions', label: t('cs.permissions') },
    { key: 'delete', label: channel.type === 'category' ? t('cs.deleteCategory') : t('cs.delete'), danger: true },
  ];
  return (
    <SettingsLayout title={channel.name} tabs={tabs} tab={tab} setTab={setTab} onClose={onClose}>
      {tab === 'overview' && <ChannelOverview channel={channel} />}
      {tab === 'permissions' && <ChannelPermissions channel={channel} />}
      {tab === 'delete' && (
        <>
          <H sub={t('cs.deleteHint')}>{t('cs.delete')}</H>
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await confirmDialog({ title: t('cs.deleteTitle', { name: channel.name }), body: t('cs.deleteHint'), confirmText: t('common.delete'), danger: true }))) return;
              if (await run(() => api.del(`/api/channels/${channel.id}`))) {
                useStore.getState().removeChannel(channel.id);
                onClose();
                navigate(`/channels/${channel.serverId}`);
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      )}
    </SettingsLayout>
  );
}

const SLOWMODES = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];

function ChannelOverview({ channel }: { channel: Channel }) {
  const t = useT();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [slowmode, setSlowmode] = useState(channel.slowmode);
  const [announcement, setAnnouncement] = useState(channel.type === 'announcement');
  const dirty = name !== channel.name || topic !== channel.topic || slowmode !== channel.slowmode || announcement !== (channel.type === 'announcement');
  const isText = channel.type === 'text' || channel.type === 'announcement';
  return (
    <>
      <H>{t('cs.overview')}</H>
      <div className="flex flex-col gap-5">
        <Field label={t('channel.name')}>{(id) => <Input id={id} value={name} maxLength={LIMITS.channelNameMax} onChange={(e) => setName(e.target.value)} />}</Field>
        {isText && (
          <>
            <Field label={t('cs.topic')} hint={t('cs.topicHint')}>
              {(id) => <TextArea id={id} value={topic} maxLength={LIMITS.topicMax} rows={3} onChange={(e) => setTopic(e.target.value)} />}
            </Field>
            <Field label={t('cs.slowmode')} hint={t('cs.slowmodeHint')}>
              {(id) => (
                <Select
                  id={id}
                  value={String(slowmode)}
                  onChange={(v) => setSlowmode(Number(v))}
                  options={SLOWMODES.map((s) => ({ value: String(s), label: s === 0 ? t('cs.slowmodeOff') : t(`duration.${s}`) }))}
                />
              )}
            </Field>
            <Switch checked={announcement} onChange={setAnnouncement} label={t('cs.announcement')} description={t('cs.announcementHint')} />
          </>
        )}
        <div>
          <Button
            disabled={!dirty || !name.trim()}
            onClick={async () => {
              const ch = await run(
                () =>
                  api.patch<Channel>(`/api/channels/${channel.id}`, {
                    name: name.trim(),
                    ...(isText ? { topic, slowmode, type: announcement ? 'announcement' : 'text' } : {}),
                  }),
                t('common.saved'),
              );
              if (ch) useStore.getState().upsertChannel(ch);
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </>
  );
}

function ChannelPermissions({ channel }: { channel: Channel }) {
  const t = useT();
  const roles = useStore((s) => s.servers[channel.serverId!]?.roles ?? NO_ROLES);
  const members = useStore((s) => s.members[channel.serverId!]);
  const users = useStore((s) => s.users);
  const [overwrites, setOverwrites] = useState<Overwrite[]>(channel.overwrites);
  const [selected, setSelected] = useState<string>(() => {
    const everyone = roles.find((r) => r.isDefault);
    return everyone ? `role:${everyone.id}` : '';
  });
  const [adding, setAdding] = useState('');
  useEffect(() => setOverwrites(channel.overwrites), [channel.overwrites]);
  useEffect(() => {
    void loadMembers(channel.serverId!);
  }, [channel.serverId]);
  const [type, idStr] = selected.split(':');
  const targetId = Number(idStr);
  const current = overwrites.find((o) => o.targetType === type && o.targetId === targetId) ?? { targetType: type as 'role' | 'member', targetId, allow: 0, deny: 0 };
  const [draft, setDraft] = useState({ allow: current.allow, deny: current.deny });
  useEffect(() => setDraft({ allow: current.allow, deny: current.deny }), [selected, current.allow, current.deny]);
  const label = (o: { targetType: string; targetId: number }) =>
    o.targetType === 'role' ? (roles.find((r) => r.id === o.targetId)?.isDefault ? '@everyone' : (roles.find((r) => r.id === o.targetId)?.name ?? '…')) : (users[o.targetId]?.displayName ?? '…');
  const listed: { targetType: 'role' | 'member'; targetId: number }[] = [
    ...roles.filter((r) => r.isDefault).map((r) => ({ targetType: 'role' as const, targetId: r.id })),
    ...overwrites.filter((o) => !(o.targetType === 'role' && roles.find((r) => r.id === o.targetId)?.isDefault)),
  ];
  if (!listed.some((o) => `${o.targetType}:${o.targetId}` === selected) && selected) listed.push({ targetType: type as 'role' | 'member', targetId });
  const save = async () => {
    const ch = await run(() => api.put<Channel>(`/api/channels/${channel.id}/overwrites/${type}/${targetId}`, draft), t('common.saved'));
    if (ch) setOverwrites(ch.overwrites);
  };
  return (
    <>
      <H sub={t('cs.permissionsHint')}>{t('cs.permissions')}</H>
      <div className="flex gap-6 max-md:flex-col">
        <div className="flex w-56 shrink-0 flex-col gap-1">
          <Select
            value={adding}
            onChange={(v) => {
              setAdding('');
              if (v) setSelected(v);
            }}
            options={[
              { value: '', label: t('cs.addRoleOrMember') },
              ...roles.filter((r) => !r.isDefault).map((r) => ({ value: `role:${r.id}`, label: `@${r.name}` })),
              ...Object.values(members ?? {}).map((m) => ({ value: `member:${m.userId}`, label: m.nickname || m.user.displayName })),
            ]}
          />
          <ul className="mt-2 flex flex-col gap-0.5">
            {listed.map((o) => {
              const key = `${o.targetType}:${o.targetId}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setSelected(key)}
                    className={cx('w-full rounded-lg px-2.5 py-1.5 text-start text-[14px]', selected === key ? 'bg-accent-soft text-text-1' : 'text-text-2 hover:bg-hover')}
                  >
                    {label(o)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {selected && (
          <div className="min-w-0 flex-1">
            <PermissionToggles tri mask={CHANNEL_PERMISSIONS} overwrite={draft} onOverwrite={setDraft} />
            <div className="sticky bottom-0 mt-6 flex gap-2 bg-bg-2 py-3">
              <Button disabled={draft.allow === current.allow && draft.deny === current.deny} onClick={() => void save()}>
                {t('common.save')}
              </Button>
              {overwrites.some((o) => o.targetType === type && o.targetId === targetId) && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const ch = await run(() => api.del<Channel>(`/api/channels/${channel.id}/overwrites/${type}/${targetId}`));
                    if (ch) setOverwrites(ch.overwrites);
                  }}
                >
                  {t('cs.resetOverwrite')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---------- user settings ----------

export function UserSettings({ initialTab, onClose }: { initialTab?: string; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState(initialTab ?? 'account');
  const tabs: (TabDef | string)[] = [
    t('us.userSettings'),
    { key: 'account', label: t('us.account') },
    { key: 'profile', label: t('us.profile') },
    t('us.appSettings'),
    { key: 'appearance', label: t('us.appearance') },
    { key: 'voice', label: t('us.voice') },
    { key: 'notifications', label: t('us.notifications') },
    { key: 'logout', label: t('us.logout'), danger: true },
  ];
  return (
    <SettingsLayout title={t('settings.title')} tabs={tabs} tab={tab} setTab={(k) => (k === 'logout' ? void logout() : setTab(k))} onClose={onClose}>
      {tab === 'account' && <AccountTab />}
      {tab === 'profile' && <ProfileTab />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'voice' && <VoiceTab />}
      {tab === 'notifications' && <UserNotificationsTab />}
    </SettingsLayout>
  );
}

function AccountTab() {
  const t = useT();
  const me = useStore((s) => s.me)!;
  const [username, setUsername] = useState(me.username);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [deletePw, setDeletePw] = useState('');
  return (
    <>
      <H>{t('us.account')}</H>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <Field label={t('auth.username')} hint={t('auth.usernameHint')}>
            {(id) => <Input id={id} value={username} dir="ltr" onChange={(e) => setUsername(e.target.value.toLowerCase())} />}
          </Field>
          <Field label={t('auth.email')}>{(id) => <Input id={id} value={me.email} readOnly dir="ltr" />}</Field>
          <div>
            <Button disabled={username === me.username} onClick={() => void updateProfile({ username }).then((ok) => ok && toast(t('common.saved'), 'success'))}>
              {t('common.save')}
            </Button>
          </div>
        </section>
        <section className="flex flex-col gap-4 border-t border-line pt-6">
          <h3 className="font-semibold text-text-1">{t('us.changePassword')}</h3>
          <Field label={t('us.currentPassword')}>{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
          <Field label={t('us.newPassword')} hint={t('auth.passwordHint', { min: LIMITS.passwordMin })}>
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
          </Field>
          <div>
            <Button
              disabled={!current || next.length < LIMITS.passwordMin}
              onClick={async () => {
                if (await run(() => api.post('/api/users/me/password', { currentPassword: current, newPassword: next }), t('us.passwordChanged'))) {
                  setCurrent('');
                  setNext('');
                }
              }}
            >
              {t('us.changePassword')}
            </Button>
          </div>
        </section>
        <section className="flex flex-col gap-4 border-t border-line pt-6">
          <h3 className="font-semibold text-danger-text">{t('us.deleteAccount')}</h3>
          <p className="text-[13px] text-text-3">{t('us.deleteAccountHint')}</p>
          <Field label={t('us.currentPassword')}>{(id) => <Input id={id} type="password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />}</Field>
          <div>
            <Button
              variant="danger"
              disabled={!deletePw}
              onClick={async () => {
                if (!(await confirmDialog({ title: t('us.deleteAccount'), body: t('us.deleteAccountConfirm'), confirmText: t('common.delete'), danger: true }))) return;
                if (await run(() => api.del('/api/users/me', { password: deletePw }))) window.location.href = '/login';
              }}
            >
              {t('us.deleteAccount')}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

function ProfileTab() {
  const t = useT();
  const me = useStore((s) => s.me)!;
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [activity, setActivity] = useState(me.activity);
  const [customStatus, setCustomStatus] = useState(me.customStatus);
  const [bannerColor, setBannerColor] = useState(me.bannerColor ?? '#2ec4b6');
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = displayName !== me.displayName || bio !== me.bio || activity !== me.activity || customStatus !== me.customStatus || bannerColor !== (me.bannerColor ?? '#2ec4b6');
  return (
    <>
      <H sub={t('us.profileHint')}>{t('us.profile')}</H>
      <div className="flex gap-8 max-lg:flex-col">
        <div className="flex flex-1 flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar user={me} size={80} />
            <div className="flex gap-2">
              <Button variant="secondary" small onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> {t('us.changeAvatar')}
              </Button>
              {me.avatar && (
                <Button
                  variant="ghost"
                  small
                  onClick={async () => {
                    const r = await run(() => api.del<{ user: SelfUser }>('/api/users/me/avatar'));
                    if (r) useStore.getState().setMe(r.user);
                  }}
                >
                  {t('common.remove')}
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const form = new FormData();
                form.append('file', f);
                const r = await run(() => api.upload<{ user: SelfUser }>('PUT', '/api/users/me/avatar', form));
                if (r) useStore.getState().setMe(r.user);
              }}
            />
          </div>
          <Field label={t('auth.displayName')}>{(id) => <Input id={id} value={displayName} maxLength={LIMITS.displayNameMax} onChange={(e) => setDisplayName(e.target.value)} />}</Field>
          <Field label={t('us.activity')} hint={t('us.activityHint')}>
            {(id) => <Input id={id} value={activity} maxLength={LIMITS.activityMax} onChange={(e) => setActivity(e.target.value)} placeholder="Valorant, CS2, FIFA…" />}
          </Field>
          <Field label={t('status.custom')}>{(id) => <Input id={id} value={customStatus} maxLength={LIMITS.customStatusMax} onChange={(e) => setCustomStatus(e.target.value)} />}</Field>
          <Field label={t('profile.about')} hint={t('us.bioHint', { max: LIMITS.bioMax })}>
            {(id) => <TextArea id={id} value={bio} maxLength={LIMITS.bioMax} rows={3} onChange={(e) => setBio(e.target.value)} />}
          </Field>
          <Field label={t('us.bannerColor')}>
            {(id) => <input id={id} type="color" value={bannerColor} onChange={(e) => setBannerColor(e.target.value)} className="h-10 w-20 cursor-pointer rounded-lg border border-line bg-transparent" />}
          </Field>
          <div>
            <Button disabled={!dirty || !displayName.trim()} onClick={() => void updateProfile({ displayName: displayName.trim(), bio, activity: activity.trim(), customStatus: customStatus.trim(), bannerColor }).then((ok) => ok && toast(t('common.saved'), 'success'))}>
              {t('common.save')}
            </Button>
          </div>
        </div>
        <div className="w-72 shrink-0">
          <div className="text-[12px] font-semibold text-text-3">{t('us.preview')}</div>
          <div className="mt-2 overflow-hidden rounded-xl bg-bg-1">
            <div className="h-14" style={{ background: bannerColor }} />
            <div className="px-4 pb-4">
              <Avatar user={me} size={64} className="-mt-8 rounded-full ring-4 ring-bg-1" />
              <div className="mt-2 font-display text-[20px] text-text-1">{displayName || me.username}</div>
              <div className="text-[13px] text-text-3" dir="ltr" style={{ textAlign: 'start' }}>
                @{me.username}
              </div>
              {customStatus && <p className="mt-2 text-[13px] text-text-2">{customStatus}</p>}
              {activity && <p className="mt-2 text-[13px] text-text-2">{t('presence.playing', { game: activity })}</p>}
              {bio && <p className="mt-2 whitespace-pre-wrap text-[13px] text-text-2">{bio}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function getTheme(): 'dark' | 'light' | 'system' {
  try {
    const v = localStorage.getItem('lgcp.theme');
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme = getTheme()) {
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#D3DEEC' : '#0B1626');
}

function AppearanceTab() {
  const t = useT();
  const lang = useLang();
  const [theme, setTheme] = useState(getTheme());
  return (
    <>
      <H>{t('us.appearance')}</H>
      <div className="flex flex-col gap-6">
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-text-2">{t('us.theme')}</h3>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {(['dark', 'light', 'system'] as const).map((th) => (
              <button
                key={th}
                type="button"
                role="radio"
                aria-checked={theme === th}
                onClick={() => {
                  setTheme(th);
                  try {
                    localStorage.setItem('lgcp.theme', th);
                  } catch {
                    // ignore
                  }
                  applyTheme(th);
                }}
                className={cx('rounded-xl border p-3 text-start', theme === th ? 'border-accent bg-accent-soft' : 'border-line hover:border-text-3')}
              >
                <span
                  className="mb-2 block h-12 rounded-lg border border-line"
                  style={{ background: th === 'dark' ? '#142843' : th === 'light' ? '#f7f9fc' : 'linear-gradient(90deg,#142843 50%,#f7f9fc 50%)' }}
                />
                <span className="text-[14px] text-text-1">{t(`us.theme.${th}`)}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-text-2">{t('us.language')}</h3>
          <div role="radiogroup" className="flex gap-2">
            {(['fa', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={lang === l}
                onClick={() => {
                  setLang(l);
                  void updateProfile({ locale: l });
                }}
                className={cx('rounded-xl border px-4 py-2.5 text-[15px]', lang === l ? 'border-accent bg-accent-soft text-text-1' : 'border-line text-text-2 hover:border-text-3')}
              >
                {l === 'fa' ? 'فارسی' : 'English'}
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function VoiceTab() {
  const t = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = useState(getVoicePrefs());
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const testStream = useRef<MediaStream | null>(null);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => undefined);
    return () => testStream.current?.getTracks().forEach((tr) => tr.stop());
  }, []);
  useEffect(() => {
    if (!testing) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    void (async () => {
      try {
        testStream.current = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.inputId ? { exact: prefs.inputId } : undefined } });
        setDevices(await navigator.mediaDevices.enumerateDevices());
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(testStream.current).connect(analyser);
        const buf = new Float32Array(512);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        toast(t('error.mic_unavailable'), 'error');
        setTesting(false);
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      testStream.current?.getTracks().forEach((tr) => tr.stop());
      void ctx?.close();
    };
  }, [testing, prefs.inputId, t]);
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const update = (patch: Partial<typeof prefs>) => setPrefs(setVoicePrefs(patch));
  const opts = (list: MediaDeviceInfo[]) => [{ value: '', label: t('us.defaultDevice') }, ...list.map((d, i) => ({ value: d.deviceId, label: d.label || `${t('us.device')} ${num(i + 1)}` }))];
  return (
    <>
      <H sub={t('us.voiceHint')}>{t('us.voice')}</H>
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('us.input')}>
            {(id) => (
              <Select
                id={id}
                value={prefs.inputId ?? ''}
                onChange={(v) => {
                  update({ inputId: v || undefined });
                  if (v) void voice.switchInput(v).catch(() => undefined);
                }}
                options={opts(inputs)}
              />
            )}
          </Field>
          <Field label={t('us.output')}>
            {(id) => (
              <Select
                id={id}
                value={prefs.outputId ?? ''}
                onChange={(v) => {
                  update({ outputId: v || undefined });
                  if (v) voice.setOutput(v);
                }}
                options={opts(outputs)}
              />
            )}
          </Field>
          <Field label={t('us.camera')}>{(id) => <Select id={id} value={prefs.videoId ?? ''} onChange={(v) => update({ videoId: v || undefined })} options={opts(cameras)} />}</Field>
        </div>
        <section>
          <div className="mb-2 flex items-center gap-3">
            <Button variant="secondary" small onClick={() => setTesting((v) => !v)}>
              {testing ? t('us.stopTest') : t('us.micTest')}
            </Button>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-1" role="meter" aria-label={t('us.micLevel')} aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          </div>
          <p className="text-[12px] text-text-3">{t('us.micTestHint')}</p>
        </section>
        <Switch checked={prefs.noiseSuppression} onChange={(v) => update({ noiseSuppression: v })} label={t('us.noiseSuppression')} description={t('us.noiseSuppressionHint')} />
        <Switch checked={prefs.echoCancellation} onChange={(v) => update({ echoCancellation: v })} label={t('us.echoCancellation')} description={t('us.rejoinHint')} />
      </div>
    </>
  );
}

function UserNotificationsTab() {
  const t = useT();
  const [prefs, setPrefsState] = useState(getNotifyPrefs());
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const update = (p: typeof prefs) => {
    setNotifyPrefs(p);
    setPrefsState(p);
  };
  return (
    <>
      <H sub={t('us.notificationsHint')}>{t('us.notifications')}</H>
      <Switch
        checked={prefs.desktop && permission === 'granted'}
        onChange={async (on) => {
          if (on) {
            const ok = await requestDesktopPermission();
            setPermission(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
            if (!ok) {
              toast(t('us.notificationsBlocked'), 'error');
              return;
            }
          }
          update({ ...prefs, desktop: on });
        }}
        label={t('us.desktopNotifications')}
        description={permission === 'denied' ? t('us.notificationsBlocked') : t('us.desktopNotificationsHint')}
      />
      <Switch checked={prefs.sounds} onChange={(on) => update({ ...prefs, sounds: on })} label={t('us.sounds')} description={t('us.soundsHint')} />
    </>
  );
}
