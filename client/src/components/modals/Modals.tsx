import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, Download, Gamepad2, Hash, Lock, Megaphone, Minus, Plus, Users, Volume2, X } from 'lucide-react';
import type { Channel, Invite, ServerBundle } from '@shared/types';
import { INVITE_MAX_AGES, INVITE_MAX_USES, LIMITS } from '@shared/constants';
import { errorText, num, useT } from '../../i18n';
import { api } from '../../lib/api';
import { joinInvite, sendMessage } from '../../lib/actions';
import { registerEmojiUrls } from '../../lib/markdown';
import { NO_ROLES, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, Button, cx, Field, IconButton, Input, Modal, Select, Switch, toast } from '../ui';
import { ChannelSettings, ServerSettings, UserSettings } from '../settings/Settings';

export function ModalHost() {
  const modal = useUi((s) => s.modal);
  const close = useUi((s) => s.close);
  if (!modal) return null;
  switch (modal.type) {
    case 'createServer':
      return <CreateServerModal onClose={close} />;
    case 'invite':
      return <InviteModal serverId={modal.serverId} channelId={modal.channelId} onClose={close} />;
    case 'createChannel':
      return <CreateChannelModal serverId={modal.serverId} parentId={modal.parentId ?? null} kind={modal.kind} onClose={close} />;
    case 'createThread':
      return <CreateThreadModal channelId={modal.channelId} messageId={modal.message?.id} defaultName={modal.message?.content.slice(0, 60) ?? ''} onClose={close} />;
    case 'poll':
      return <PollModal channelId={modal.channelId} onClose={close} />;
    case 'newDm':
      return <NewDmModal onClose={close} />;
    case 'lightbox':
      return <Lightbox url={modal.url} filename={modal.filename} onClose={close} />;
    case 'serverSettings':
      return <ServerSettings serverId={modal.serverId} initialTab={modal.tab} onClose={close} />;
    case 'channelSettings':
      return <ChannelSettings channelId={modal.channelId} onClose={close} />;
    case 'userSettings':
      return <UserSettings initialTab={modal.tab} onClose={close} />;
    default:
      return null;
  }
}

function CreateServerModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const me = useStore((s) => s.me);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState(t('createServer.defaultName', { name: me?.displayName ?? '' }));
  const [template, setTemplate] = useState<'gaming' | 'friends' | 'default'>('gaming');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const bundle = await api.post<ServerBundle>('/api/servers', { name: name.trim(), template });
      useStore.getState().applyServerBundle(bundle);
      registerEmojiUrls(bundle.emojis);
      onClose();
      const first = bundle.channels.find((c) => c.id === bundle.server.systemChannelId) ?? bundle.channels.find((c) => c.type === 'text');
      navigate(`/channels/${bundle.server.id}${first ? `/${first.id}` : ''}`);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const code = invite.trim().split('/').filter(Boolean).pop() ?? '';
    if (!code) return;
    setBusy(true);
    try {
      const bundle = await joinInvite(code);
      onClose();
      navigate(`/channels/${bundle.server.id}`);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const templates = [
    { key: 'gaming' as const, icon: <Gamepad2 size={22} />, title: t('createServer.gaming'), body: t('createServer.gamingBody') },
    { key: 'friends' as const, icon: <Users size={22} />, title: t('createServer.friends'), body: t('createServer.friendsBody') },
    { key: 'default' as const, icon: <Hash size={22} />, title: t('createServer.basic'), body: t('createServer.basicBody') },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? t('createServer.title') : t('createServer.joinTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={() => setMode(mode === 'create' ? 'join' : 'create')} className="me-auto">
            {mode === 'create' ? t('createServer.haveInvite') : t('createServer.createInstead')}
          </Button>
          {mode === 'create' ? (
            <Button onClick={() => void create()} busy={busy} disabled={!name.trim()}>
              {t('createServer.create')}
            </Button>
          ) : (
            <Button onClick={() => void join()} busy={busy} disabled={!invite.trim()}>
              {t('createServer.join')}
            </Button>
          )}
        </>
      }
    >
      {mode === 'create' ? (
        <div className="flex flex-col gap-4">
          <p className="text-[14px] text-text-2">{t('createServer.body')}</p>
          <div role="radiogroup" className="flex flex-col gap-2">
            {templates.map((x) => (
              <button
                key={x.key}
                type="button"
                role="radio"
                aria-checked={template === x.key}
                onClick={() => setTemplate(x.key)}
                className={cx('flex items-center gap-3 rounded-xl border p-3 text-start', template === x.key ? 'border-accent bg-accent-soft' : 'border-line hover:border-text-3')}
              >
                <span className="text-accent">{x.icon}</span>
                <span className="flex-1">
                  <span className="block font-semibold text-text-1">{x.title}</span>
                  <span className="block text-[13px] text-text-3">{x.body}</span>
                </span>
                {template === x.key && <Check size={18} className="text-accent" />}
              </button>
            ))}
          </div>
          <Field label={t('createServer.name')}>
            {(id) => <Input id={id} value={name} maxLength={LIMITS.serverNameMax} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />}
          </Field>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-text-2">{t('createServer.joinBody')}</p>
          <Field label={t('createServer.inviteLink')} hint={t('createServer.inviteHint')}>
            {(id) => <Input id={id} value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="https://…/invite/Ab3dE9xYz2" dir="ltr" onKeyDown={(e) => e.key === 'Enter' && void join()} autoFocus />}
          </Field>
        </div>
      )}
    </Modal>
  );
}

function InviteModal({ serverId, channelId, onClose }: { serverId: number; channelId?: number; onClose: () => void }) {
  const t = useT();
  const server = useStore((s) => s.servers[serverId]?.server);
  const [maxAge, setMaxAge] = useState(604800);
  const [maxUses, setMaxUses] = useState(0);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api
      .post<Invite>(`/api/servers/${serverId}/invites`, { maxAgeSeconds: maxAge, maxUses, channelId })
      .then(setInvite)
      .catch((err) => toast(errorText(err), 'error'));
  }, [serverId, channelId, maxAge, maxUses]);
  const link = invite ? `${window.location.origin}/invite/${invite.code}` : '';
  return (
    <Modal open onClose={onClose} title={t('invite.title', { name: server?.name ?? '' })}>
      <div className="flex flex-col gap-4">
        <Field label={t('invite.link')}>
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                disabled={!invite}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? t('invite.copied') : t('invite.copy')}
              </Button>
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('invite.expires')}>
            {(id) => (
              <Select
                id={id}
                value={String(maxAge)}
                onChange={(v) => setMaxAge(Number(v))}
                options={INVITE_MAX_AGES.map((a) => ({ value: String(a), label: a === 0 ? t('invite.never') : t(`duration.${a}`) }))}
              />
            )}
          </Field>
          <Field label={t('invite.maxUses')}>
            {(id) => (
              <Select
                id={id}
                value={String(maxUses)}
                onChange={(v) => setMaxUses(Number(v))}
                options={INVITE_MAX_USES.map((u) => ({ value: String(u), label: u === 0 ? t('invite.unlimited') : num(u) }))}
              />
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function CreateChannelModal({ serverId, parentId, kind, onClose }: { serverId: number; parentId: number | null; kind?: 'text' | 'voice' | 'category' | 'announcement'; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const roles = useStore((s) => s.servers[serverId]?.roles ?? NO_ROLES);
  const [type, setType] = useState<'text' | 'voice' | 'category' | 'announcement'>(kind ?? 'text');
  const [name, setName] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [allowed, setAllowed] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const ch = await api.post<Channel>(`/api/servers/${serverId}/channels`, {
        name: name.trim(),
        type,
        parentId: type === 'category' ? null : parentId,
        private: isPrivate,
        allowedRoleIds: allowed,
      });
      useStore.getState().upsertChannel(ch);
      onClose();
      if (ch.type === 'text' || ch.type === 'announcement') navigate(`/channels/${serverId}/${ch.id}`);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const types = [
    { key: 'text' as const, icon: <Hash size={20} />, label: t('channel.type.text'), body: t('channel.type.textBody') },
    { key: 'voice' as const, icon: <Volume2 size={20} />, label: t('channel.type.voice'), body: t('channel.type.voiceBody') },
    { key: 'announcement' as const, icon: <Megaphone size={20} />, label: t('channel.type.announcement'), body: t('channel.type.announcementBody') },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={type === 'category' ? t('channel.createCategory') : t('channel.create')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void create()} busy={busy} disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {type !== 'category' && (
          <div role="radiogroup" aria-label={t('channel.typeLabel')} className="flex flex-col gap-2">
            {types.map((x) => (
              <button
                key={x.key}
                type="button"
                role="radio"
                aria-checked={type === x.key}
                onClick={() => setType(x.key)}
                className={cx('flex items-center gap-3 rounded-xl border p-3 text-start', type === x.key ? 'border-accent bg-accent-soft' : 'border-line hover:border-text-3')}
              >
                <span className="text-text-2">{x.icon}</span>
                <span className="flex-1">
                  <span className="block font-semibold text-text-1">{x.label}</span>
                  <span className="block text-[13px] text-text-3">{x.body}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <Field label={type === 'category' ? t('channel.categoryName') : t('channel.name')}>
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={LIMITS.channelNameMax}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'voice' ? t('channel.voicePlaceholder') : type === 'category' ? '' : t('channel.textPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
              autoFocus
            />
          )}
        </Field>
        <Switch checked={isPrivate} onChange={setPrivate} label={t('channel.private')} description={t('channel.privateBody')} />
        {isPrivate && roles.filter((r) => !r.isDefault).length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-text-2">{t('channel.whoCanSee')}</span>
            {roles
              .filter((r) => !r.isDefault)
              .map((r) => (
                <label key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
                  <input
                    type="checkbox"
                    checked={allowed.includes(r.id)}
                    onChange={(e) => setAllowed((a) => (e.target.checked ? [...a, r.id] : a.filter((x) => x !== r.id)))}
                    className="accent-[var(--accent)]"
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color ?? 'var(--text-3)' }} />
                  <span className="text-[14px]">{r.name}</span>
                  <Lock size={13} className="ms-auto text-text-3" />
                </label>
              ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateThreadModal({ channelId, messageId, defaultName, onClose }: { channelId: number; messageId?: number; defaultName: string; onClose: () => void }) {
  const t = useT();
  const setSide = useUi((s) => s.setSide);
  const [name, setName] = useState(defaultName.replace(/<[@#&!a-z:0-9]+>/gi, '').trim().slice(0, 60));
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const thread = await api.post<Channel>(`/api/channels/${channelId}/threads`, { name: name.trim(), messageId });
      useStore.getState().upsertChannel(thread);
      onClose();
      setSide({ type: 'thread', channelId: thread.id });
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('thread.create')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void create()} busy={busy} disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <Field label={t('thread.name')} hint={t('thread.hint')}>
        {(id) => <Input id={id} value={name} maxLength={LIMITS.channelNameMax} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} autoFocus />}
      </Field>
    </Modal>
  );
}

function PollModal({ channelId, onClose }: { channelId: number; onClose: () => void }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const valid = question.trim() && options.filter((o) => o.trim()).length >= LIMITS.pollOptionsMin;
  const submit = async () => {
    setBusy(true);
    const ok = await sendMessage(channelId, {
      content: '',
      poll: { question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean), multi, durationHours: hours },
    });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('poll.create')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} busy={busy} disabled={!valid}>
            {t('poll.post')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('poll.question')}>
          {(id) => <Input id={id} value={question} maxLength={LIMITS.pollQuestionMax} onChange={(e) => setQuestion(e.target.value)} placeholder={t('poll.questionPlaceholder')} autoFocus />}
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-text-2">{t('poll.options')}</span>
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={o}
                maxLength={LIMITS.pollOptionMax}
                onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={t('poll.optionN', { n: i + 1 })}
                aria-label={t('poll.optionN', { n: i + 1 })}
              />
              {options.length > LIMITS.pollOptionsMin && (
                <IconButton label={t('poll.removeOption')} onClick={() => setOptions((list) => list.filter((_, j) => j !== i))} className="h-10 w-10">
                  <Minus size={18} />
                </IconButton>
              )}
            </div>
          ))}
          {options.length < LIMITS.pollOptionsMax && (
            <Button variant="secondary" small onClick={() => setOptions((list) => [...list, ''])} className="w-fit">
              <Plus size={15} /> {t('poll.addOption')}
            </Button>
          )}
        </div>
        <Field label={t('poll.duration')}>
          {(id) => (
            <Select
              id={id}
              value={String(hours)}
              onChange={(v) => setHours(Number(v))}
              options={[1, 4, 8, 24, 72, 168].map((h) => ({ value: String(h), label: t(`duration.${h * 3600}`) }))}
            />
          )}
        </Field>
        <Switch checked={multi} onChange={setMulti} label={t('poll.allowMulti')} />
      </div>
    </Modal>
  );
}

function NewDmModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const relationships = useStore((s) => s.relationships);
  const users = useStore((s) => s.users);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const friends = useMemo(
    () =>
      Object.entries(relationships)
        .filter(([, type]) => type === 'friend')
        .map(([id]) => users[Number(id)])
        .filter((u) => u && (u.displayName.toLowerCase().includes(q.toLowerCase()) || u.username.includes(q.toLowerCase()))),
    [relationships, users, q],
  );
  const create = async () => {
    setBusy(true);
    try {
      const ch = await api.post<Channel>('/api/dms', { recipientIds: selected });
      useStore.getState().upsertChannel(ch);
      onClose();
      navigate(`/channels/@me/${ch.id}`);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('newDm.title')}
      footer={
        <Button onClick={() => void create()} busy={busy} disabled={selected.length === 0}>
          {selected.length > 1 ? t('newDm.createGroup') : t('newDm.create')}
        </Button>
      }
    >
      <p className="mb-3 text-[13px] text-text-3">{t('newDm.body', { max: LIMITS.groupDmMax - 1 })}</p>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('newDm.search')} aria-label={t('newDm.search')} autoFocus />
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selected.map((id) => (
            <button key={id} type="button" onClick={() => setSelected((s) => s.filter((x) => x !== id))} className="flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[13px] text-text-1">
              {users[id]?.displayName} <X size={12} />
            </button>
          ))}
        </div>
      )}
      <ul className="mt-3 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {friends.length === 0 && <li className="py-6 text-center text-[13px] text-text-3">{t('newDm.noFriends')}</li>}
        {friends.map((u) => {
          const on = selected.includes(u.id);
          return (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                <Avatar user={u} size={32} status={u.status} ring="var(--bg-2)" />
                <span className="flex-1">
                  <span className="block text-[15px] text-text-1">{u.displayName}</span>
                  <span className="block text-[12px] text-text-3" dir="ltr" style={{ textAlign: 'start' }}>
                    @{u.username}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!on && selected.length >= LIMITS.groupDmMax - 1}
                  onChange={() => setSelected((s) => (on ? s.filter((x) => x !== u.id) : [...s, u.id]))}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function Lightbox({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  const t = useT();
  return (
    <Modal open onClose={onClose} bare wide labelledBy="lightbox-title">
      <div className="relative flex flex-col bg-black">
        <span id="lightbox-title" className="sr-only">
          {filename}
        </span>
        <img src={url} alt={filename} className="max-h-[80vh] w-full object-contain" />
        <div className="flex items-center gap-2 bg-bg-1 px-4 py-2">
          <span className="flex-1 truncate text-[13px] text-text-2" dir="auto">
            {filename}
          </span>
          <a href={url} download={filename} className="flex items-center gap-1 text-[13px] text-accent hover:underline">
            <Download size={15} /> {t('message.download')}
          </a>
          <IconButton label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </div>
    </Modal>
  );
}
