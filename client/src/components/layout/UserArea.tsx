import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, PhoneOff, Settings, Video, VideoOff } from 'lucide-react';
import type { PresenceStatus } from '@shared/types';
import { useT } from '../../i18n';
import { updateProfile } from '../../lib/actions';
import { canShareScreen, useVoice, voice } from '../../lib/voice';
import { dmName, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, cx, IconButton, Popover, STATUS_COLOR, type Anchor } from '../ui';

const STATUSES: PresenceStatus[] = ['online', 'idle', 'dnd', 'invisible'];

/** Shown while connected to a voice channel or call. */
export function VoicePanel() {
  const t = useT();
  const navigate = useNavigate();
  const v = useVoice();
  const channel = useStore((s) => (v.channelId ? s.channels[v.channelId] : undefined));
  const server = useStore((s) => (channel?.serverId ? s.servers[channel.serverId]?.server : undefined));
  const state = useStore.getState();
  if (!v.channelId && !v.joining) return null;
  const connecting = v.joining || Object.values(v.connection).some((c) => c === 'connecting' || c === 'new');
  const title = channel ? (channel.serverId ? channel.name : dmName(state, channel)) : '';
  const go = () => channel && navigate(channel.serverId ? `/channels/${channel.serverId}/${channel.id}` : `/channels/@me/${channel.id}`);
  return (
    <div className="border-t border-bg-0/60 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={go} className="min-w-0 flex-1 text-start">
          <span className={cx('block text-[13px] font-semibold', connecting ? 'text-saffron' : 'text-accent')}>
            {connecting ? t('voice.connecting') : t('voice.connected')}
          </span>
          <span className="block truncate text-[12px] text-text-3">
            {title}
            {server ? ` / ${server.name}` : ''}
          </span>
        </button>
        <IconButton label={t('voice.disconnect')} danger onClick={() => void voice.leave()}>
          <PhoneOff size={18} />
        </IconButton>
      </div>
      <div className={cx('mt-2 grid gap-1.5', canShareScreen ? 'grid-cols-2' : 'grid-cols-1')}>
        <button
          type="button"
          onClick={() => void voice.toggleCamera()}
          className={cx('flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px]', v.video ? 'bg-accent text-accent-ink' : 'bg-bg-3 text-text-2 hover:text-text-1')}
          aria-pressed={v.video}
        >
          {v.video ? <Video size={16} /> : <VideoOff size={16} />}
          {t('voice.camera')}
        </button>
        {canShareScreen && (
        <button
          type="button"
          onClick={() => void voice.toggleScreen()}
          className={cx('flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px]', v.screen ? 'bg-accent text-accent-ink' : 'bg-bg-3 text-text-2 hover:text-text-1')}
          aria-pressed={v.screen}
        >
          <MonitorUp size={16} />
          {t('voice.screen')}
        </button>
        )}
      </div>
    </div>
  );
}

export function UserPanel() {
  const t = useT();
  const me = useStore((s) => s.me);
  const v = useVoice();
  const open = useUi((s) => s.open);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [custom, setCustom] = useState('');
  if (!me) return null;
  const status = me.preferredStatus;
  return (
    <div className="flex h-[58px] shrink-0 items-center gap-1 bg-bg-0/40 px-2">
      <button
        type="button"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setCustom(me.customStatus);
          setAnchor({ x: r.left, y: r.top, w: r.width, h: r.height });
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-start hover:bg-hover"
        aria-haspopup="dialog"
      >
        <Avatar user={me} size={34} status={status === 'invisible' ? 'offline' : status} ring="var(--bg-1)" />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold leading-5 text-text-1">{me.displayName}</span>
          <span className="block truncate text-[12px] leading-4 text-text-3">{me.customStatus || t(`status.${status}`)}</span>
        </span>
      </button>
      <IconButton label={v.selfMute ? t('voice.unmute') : t('voice.mute')} active={false} danger={v.selfMute} onClick={() => voice.setMute(!v.selfMute)}>
        {v.selfMute ? <MicOff size={18} /> : <Mic size={18} />}
      </IconButton>
      <IconButton label={v.selfDeaf ? t('voice.undeafen') : t('voice.deafen')} danger={v.selfDeaf} onClick={() => voice.setDeaf(!v.selfDeaf)}>
        {v.selfDeaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
      </IconButton>
      <IconButton label={t('settings.title')} onClick={() => open({ type: 'userSettings' })}>
        <Settings size={18} />
      </IconButton>

      <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="above">
        <div className="w-64 p-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void updateProfile({ customStatus: custom.trim() });
              setAnchor(null);
            }}
            className="mb-2"
          >
            <label className="mb-1 block px-1 text-[12px] font-semibold text-text-3" htmlFor="custom-status">
              {t('status.custom')}
            </label>
            <input
              id="custom-status"
              value={custom}
              maxLength={128}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={t('status.customPlaceholder')}
              className="h-9 w-full rounded-lg border border-line bg-bg-0/60 px-2.5 text-[14px] focus:border-accent focus:outline-none"
            />
          </form>
          <div role="menu" className="flex flex-col">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={status === s}
                onClick={() => {
                  void updateProfile({ status: s });
                  setAnchor(null);
                }}
                className={cx('flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-hover', status === s && 'bg-accent-soft')}
              >
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s === 'invisible' ? 'transparent' : STATUS_COLOR[s], border: s === 'invisible' ? '2px solid var(--offline)' : undefined }} />
                <span>
                  <span className="block text-[14px] text-text-1">{t(`status.${s}`)}</span>
                  <span className="block text-[12px] text-text-3">{t(`status.${s}Hint`)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </div>
  );
}
