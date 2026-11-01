import { useEffect } from 'react';
import { matchPath, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../i18n';
import { setUnauthorizedHandler } from '../lib/api';
import { setToken } from '../lib/env';
import { setNavigator, startRealtime } from '../lib/realtime';
import { useStore } from '../store';
import { useUi } from '../store/ui';
import { ChatView } from '../components/chat/ChatView';
import { ExploreView, FriendsView, InboxView } from '../components/friends/HomeViews';
import { HomeSidebar } from '../components/layout/HomeSidebar';
import { ProfileCard } from '../components/layout/ProfileCard';
import { ServerRail } from '../components/layout/ServerRail';
import { ServerSidebar } from '../components/layout/ServerSidebar';
import { UserPanel, VoicePanel } from '../components/layout/UserArea';
import { ModalHost } from '../components/modals/Modals';
import { BrandMark, cx, EmptyState, Spinner } from '../components/ui';
import { IncomingCall, VoiceView } from '../components/voice/VoiceView';

/** The signed-in app. One mounted shell for every app URL, so the socket and voice calls survive navigation. */
export function AppPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const section: 'channels' | 'explore' | 'inbox' = location.pathname.startsWith('/explore')
    ? 'explore'
    : location.pathname.startsWith('/inbox')
      ? 'inbox'
      : 'channels';
  const params: { serverId?: string; channelId?: string } = matchPath('/channels/:serverId/:channelId?', location.pathname)?.params ?? {};
  const ready = useStore((s) => s.ready);
  const connected = useStore((s) => s.connected);
  const mobileNav = useUi((s) => s.mobileNav);
  const setMobileNav = useUi((s) => s.setMobileNav);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      useStore.getState().reset();
      navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`, { replace: true });
    });
    setNavigator((p) => navigate(p));
    return startRealtime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serverParam = params.serverId;
  const isHome = section !== 'channels' || serverParam === '@me' || !serverParam;
  const serverId = !isHome ? Number(serverParam) : null;
  const channelId = params.channelId ? Number(params.channelId) : null;
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const channel = useStore((s) => (channelId ? s.channels[channelId] : undefined));
  const firstChannel = useStore((s) => {
    if (!serverId || channelId) return null;
    const list = Object.values(s.channels)
      .filter((c) => c.serverId === serverId && (c.type === 'text' || c.type === 'announcement'))
      .sort((a, b) => a.position - b.position);
    const sys = s.servers[serverId]?.server.systemChannelId;
    return (list.find((c) => c.id === sys) ?? list[0])?.id ?? null;
  });

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg-0">
        <BrandMark size={72} />
        <Spinner />
      </div>
    );
  }
  if (section === 'channels' && !location.pathname.startsWith('/channels/')) return <Navigate to="/channels/@me" replace />;
  if (serverId !== null && (!Number.isInteger(serverId) || !server)) return <Navigate to="/channels/@me" replace />;
  if (serverId && !channelId && firstChannel) return <Navigate to={`/channels/${serverId}/${firstChannel}`} replace />;

  let main: React.ReactNode;
  if (section === 'explore') main = <ExploreView />;
  else if (section === 'inbox') main = <InboxView />;
  else if (channelId && channel) main = channel.type === 'voice' ? <VoiceView channelId={channelId} /> : <ChatView channelId={channelId} />;
  else if (channelId && !channel) main = <EmptyState title={t('chat.notFound')} body={t('chat.notFoundBody')} />;
  else if (isHome) main = <FriendsView />;
  else main = <EmptyState title={t('chat.noChannels')} body={t('chat.noChannelsBody')} />;

  const homeSection = section === 'explore' ? 'explore' : section === 'inbox' ? 'inbox' : channelId ? 'dm' : 'friends';

  return (
    <div className="flex h-full overflow-hidden bg-bg-2">
      {!connected && (
        <div role="status" className="fixed inset-x-0 top-0 z-[80] bg-saffron py-1 text-center text-[13px] font-semibold text-[#0b1626]">
          {t('app.reconnecting')}
        </div>
      )}
      {/* Rail + sidebar: always visible on desktop, a drawer on phones. */}
      <div
        className={cx('fixed inset-0 z-40 md:hidden', mobileNav ? 'block' : 'hidden')}
        style={{ background: 'var(--scrim)' }}
        onClick={() => setMobileNav(false)}
        aria-hidden="true"
      />
      <div className={cx('z-40 flex h-full shrink-0 max-md:fixed max-md:inset-y-0 max-md:start-0', mobileNav ? 'max-md:flex' : 'max-md:hidden')}>
        <ServerRail />
        <div className="flex w-60 flex-col bg-bg-1">
          {isHome ? <HomeSidebar channelId={channelId} section={homeSection} /> : <ServerSidebar serverId={serverId!} channelId={channelId} />}
          <VoicePanel />
          <UserPanel />
        </div>
      </div>
      <main className="flex min-w-0 flex-1 flex-col">{main}</main>
      <ModalHost />
      <ProfileCard />
      <IncomingCall />
    </div>
  );
}
