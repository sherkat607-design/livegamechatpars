import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, HeadphoneOff, Maximize2, Menu as MenuIcon, Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import type { Channel, VoiceParticipant } from '@shared/types';
import { errorText, useT } from '../../i18n';
import { channelPerms, has, P } from '../../lib/perms';
import { stopRinging } from '../../lib/notify';
import { canShareScreen, useVoice, voice } from '../../lib/voice';
import { dmName, displayName, NO_PARTICIPANTS, useStore } from '../../store';
import { useUi } from '../../store/ui';
import { Avatar, Button, cx, IconButton, toast } from '../ui';

function VideoEl({ stream, muted, contain }: { stream: MediaStream; muted?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={cx('h-full w-full bg-black', contain ? 'object-contain' : 'object-cover')} />;
}

interface Tile {
  key: string;
  userId: number;
  kind: 'person' | 'camera' | 'screen';
  stream?: MediaStream;
  local: boolean;
  p: VoiceParticipant;
}

export function VoiceStage({ channel, compact }: { channel: Channel; compact?: boolean }) {
  const t = useT();
  const participants = useStore((s) => s.voiceStates[channel.id] ?? NO_PARTICIPANTS);
  const me = useStore((s) => s.me);
  const v = useVoice();
  const joined = v.channelId === channel.id;
  const [focus, setFocus] = useState<string | null>(null);
  const perms = useStore((s) => channelPerms(s, s.channels[channel.id]));
  const title = useStore((s) => (channel.serverId ? channel.name : dmName(s, channel)));

  const tiles: Tile[] = useMemo(() => {
    const out: Tile[] = [];
    for (const p of participants) {
      const local = p.userId === me?.id;
      const remote = v.remote[p.userId] ?? [];
      const find = (id?: string) => (id ? remote.find((s) => s.id === id) : undefined);
      const camera = local ? v.localCamera : find(p.streams.camera);
      const screen = local ? v.localScreen : find(p.streams.screen);
      if (screen && joined) out.push({ key: `s${p.userId}`, userId: p.userId, kind: 'screen', stream: screen, local, p });
      if (camera && joined) out.push({ key: `c${p.userId}`, userId: p.userId, kind: 'camera', stream: camera, local, p });
      else out.push({ key: `u${p.userId}`, userId: p.userId, kind: 'person', local, p });
    }
    return out;
  }, [participants, v.remote, v.localCamera, v.localScreen, me?.id, joined]);

  const focused = tiles.find((x) => x.key === focus) ?? tiles.find((x) => x.kind === 'screen');
  const rest = focused ? tiles.filter((x) => x !== focused) : tiles;

  const join = () => {
    if (!me) return;
    voice.join(channel.id, me.id).catch((err) => toast(errorText({ code: err.message }), 'error'));
  };

  return (
    <div className={cx('flex min-h-0 flex-col bg-bg-0', compact ? 'h-[42%] min-h-56 shrink-0 border-b border-bg-0' : 'flex-1')}>
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-3">
        {tiles.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-2 text-accent">
              <Volume2 size={32} />
            </div>
            <h2 className="font-display text-[24px] text-text-1">{title}</h2>
            <p className="max-w-sm text-[14px] text-text-3">{t('voice.emptyBody')}</p>
          </div>
        ) : focused ? (
          <>
            <div className="min-h-0 flex-1">
              <TileView tile={focused} big onClick={() => setFocus(null)} serverId={channel.serverId} />
            </div>
            {rest.length > 0 && (
              <div className="flex h-28 shrink-0 gap-2 overflow-x-auto">
                {rest.map((tile) => (
                  <div key={tile.key} className="aspect-video h-full shrink-0">
                    <TileView tile={tile} onClick={() => setFocus(tile.key)} serverId={channel.serverId} />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div
            className="grid min-h-0 flex-1 content-center gap-3"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 160 : 240}px, 1fr))` }}
          >
            {tiles.map((tile) => (
              <div key={tile.key} className="aspect-video max-h-full">
                <TileView tile={tile} onClick={() => setFocus(tile.key)} serverId={channel.serverId} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 pb-4">
        {joined ? (
          <>
            <RoundButton label={v.selfMute ? t('voice.unmute') : t('voice.mute')} danger={v.selfMute} onClick={() => voice.setMute(!v.selfMute)}>
              {v.selfMute ? <MicOff size={20} /> : <Mic size={20} />}
            </RoundButton>
            <RoundButton label={v.selfDeaf ? t('voice.undeafen') : t('voice.deafen')} danger={v.selfDeaf} onClick={() => voice.setDeaf(!v.selfDeaf)}>
              {v.selfDeaf ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
            </RoundButton>
            {has(perms, P.VIDEO) && (
              <>
                <RoundButton label={v.video ? t('voice.cameraOff') : t('voice.cameraOn')} active={v.video} onClick={() => void voice.toggleCamera()}>
                  {v.video ? <Video size={20} /> : <VideoOff size={20} />}
                </RoundButton>
                {canShareScreen && (
                  <RoundButton label={v.screen ? t('voice.stopShare') : t('voice.shareScreen')} active={v.screen} onClick={() => void voice.toggleScreen()}>
                    <MonitorUp size={20} />
                  </RoundButton>
                )}
              </>
            )}
            <RoundButton label={t('voice.disconnect')} hangup onClick={() => void voice.leave()}>
              <PhoneOff size={20} />
            </RoundButton>
          </>
        ) : (
          <Button onClick={join} busy={v.joining}>
            {channel.serverId ? t('voice.join') : t('voice.joinCall')}
          </Button>
        )}
      </div>
    </div>
  );
}

function TileView({ tile, big, onClick, serverId }: { tile: Tile; big?: boolean; onClick: () => void; serverId: number | null }) {
  const t = useT();
  const user = useStore((s) => s.users[tile.userId]);
  const name = useStore((s) => displayName(s, tile.userId, serverId));
  const speaking = useVoice((s) => !!s.speaking[tile.userId]);
  const state = useVoice((s) => s.connection[tile.userId]);
  const muted = tile.p.selfMute || tile.p.serverMute;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl bg-bg-2 text-start',
        speaking && tile.kind !== 'screen' && 'ring-[3px] ring-accent',
      )}
      aria-label={name}
    >
      {tile.stream ? (
        <VideoEl stream={tile.stream} muted contain={tile.kind === 'screen'} />
      ) : (
        <Avatar user={user ?? { id: tile.userId, displayName: name, avatar: null }} size={big ? 112 : 72} speaking={speaking} />
      )}
      <span className="absolute start-2 bottom-2 flex max-w-[85%] items-center gap-1.5 rounded-lg bg-black/55 px-2 py-0.5 text-[13px] text-white">
        {muted && <MicOff size={13} className={tile.p.serverMute ? 'text-[#ff7a7e]' : ''} />}
        {(tile.p.selfDeaf || tile.p.serverDeaf) && <HeadphoneOff size={13} />}
        <span className="truncate">
          {tile.kind === 'screen' ? t('voice.screenOf', { name }) : name}
        </span>
      </span>
      {!tile.local && state && state !== 'connected' && (
        <span className="absolute end-2 top-2 rounded-md bg-black/55 px-1.5 text-[11px] text-white">{t(`voice.state.${state}`)}</span>
      )}
      <Maximize2 size={16} className="absolute end-2 bottom-2 text-white opacity-0 transition group-hover:opacity-80" />
    </button>
  );
}

function RoundButton({ label, active, danger, hangup, onClick, children }: { label: string; active?: boolean; danger?: boolean; hangup?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      aria-pressed={active || danger}
      className={cx(
        'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
        hangup ? 'bg-danger text-white hover:brightness-110' : active ? 'bg-accent text-accent-ink' : danger ? 'bg-bg-3 text-danger-text' : 'bg-bg-3 text-text-1 hover:bg-bg-4',
      )}
    >
      {children}
    </button>
  );
}

/** Full-page view for a server voice channel. */
export function VoiceView({ channelId }: { channelId: number }) {
  const t = useT();
  const channel = useStore((s) => s.channels[channelId]);
  const setMobileNav = useUi((s) => s.setMobileNav);
  if (!channel) return null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-bg-0/60 px-3">
        <IconButton label={t('nav.open')} onClick={() => setMobileNav(true)} className="md:hidden">
          <MenuIcon size={20} />
        </IconButton>
        <Volume2 size={20} className="text-text-3" />
        <h1 className="truncate text-[16px] font-bold text-text-1">{channel.name}</h1>
      </header>
      <VoiceStage channel={channel} />
    </div>
  );
}

export function IncomingCall() {
  const t = useT();
  const incoming = useVoice((s) => s.incoming);
  const caller = useStore((s) => (incoming ? s.users[incoming.from] : undefined));
  const me = useStore((s) => s.me);
  const navigate = useNavigate();
  if (!incoming || !me) return null;
  const close = async () => {
    stopRinging();
    useVoice.setState({ incoming: null });
  };
  return (
    <div role="alertdialog" aria-label={t('voice.incoming')} className="pop-in fixed end-6 top-6 z-[65] flex w-72 flex-col items-center gap-3 rounded-2xl border border-line bg-bg-3 p-5 text-center" style={{ boxShadow: 'var(--shadow)' }}>
      <Avatar user={caller} size={72} speaking />
      <div>
        <div className="font-display text-[20px] text-text-1">{caller?.displayName ?? '…'}</div>
        <div className="text-[13px] text-text-3">{t('voice.incoming')}</div>
      </div>
      <div className="flex gap-3">
        <RoundButton label={t('voice.decline')} hangup onClick={() => void close()}>
          <PhoneOff size={20} />
        </RoundButton>
        <RoundButton
          label={t('voice.accept')}
          active
          onClick={async () => {
            await close();
            const ch = useStore.getState().channels[incoming.channelId];
            navigate(`/channels/@me/${incoming.channelId}`);
            if (ch) voice.join(ch.id, me.id).catch((err) => toast(errorText({ code: err.message }), 'error'));
          }}
        >
          <Mic size={20} />
        </RoundButton>
      </div>
    </div>
  );
}
