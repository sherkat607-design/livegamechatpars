import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { InvitePreview, SelfUser } from '@shared/types';
import { errorText, useT } from '../i18n';
import { api } from '../lib/api';
import { BrandMark, Button, ServerIcon, Spinner } from '../components/ui';

export function InvitePage() {
  const t = useT();
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<SelfUser | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<InvitePreview>(`/api/invites/${code}`).then(setPreview).catch(() => setFailed(true));
    api
      .get<{ user: SelfUser | null }>('/api/auth/session')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, [code]);

  const accept = async () => {
    if (!me) {
      navigate(`/register?next=${encodeURIComponent(`/invite/${code}`)}`);
      return;
    }
    setBusy(true);
    try {
      await api.post(`/api/invites/${code}`);
      navigate(`/channels/${preview!.server.id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="tile-bg flex min-h-full items-center justify-center p-4">
      <div className="pop-in w-full max-w-md rounded-3xl bg-bg-2 p-8 text-center" style={{ boxShadow: 'var(--shadow)' }}>
        {!preview && !failed && (
          <div className="flex justify-center py-10 text-text-3">
            <Spinner />
          </div>
        )}
        {failed && (
          <>
            <BrandMark size={64} className="mx-auto" />
            <h1 className="mt-4 font-display text-[26px] text-text-1">{t('invitePage.invalidTitle')}</h1>
            <p className="mt-2 text-[14px] text-text-3">{t('invitePage.invalidBody')}</p>
            <Button className="mt-6 w-full" onClick={() => navigate('/channels/@me')}>
              {t('invitePage.home')}
            </Button>
          </>
        )}
        {preview && (
          <>
            <span className="mx-auto block w-fit overflow-hidden rounded-3xl bg-bg-3 text-text-1">
              <ServerIcon name={preview.server.name} icon={preview.server.icon} size={84} />
            </span>
            <p className="mt-4 text-[14px] text-text-3">{preview.inviter ? t('invitePage.invitedBy', { name: preview.inviter.displayName }) : t('invitePage.invited')}</p>
            <h1 className="mt-1 font-display text-[30px] leading-tight text-text-1">{preview.server.name}</h1>
            {preview.server.description && (
              <p className="mt-2 text-[14px] text-text-2" dir="auto">
                {preview.server.description}
              </p>
            )}
            <div className="mt-3 flex justify-center gap-5 text-[13px] text-text-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-accent" /> {t('explore.online', { count: preview.onlineCount })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-offline" /> {t('explore.members', { count: preview.memberCount })}
              </span>
            </div>
            {error && <p className="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-[14px] text-danger-text">{error}</p>}
            <Button className="mt-6 h-11 w-full text-[15px]" busy={busy || me === undefined} onClick={() => void accept()}>
              {me ? t('invitePage.accept') : t('invitePage.signUpToJoin')}
            </Button>
            {!me && me !== undefined && (
              <button type="button" onClick={() => navigate(`/login?next=${encodeURIComponent(`/invite/${code}`)}`)} className="mt-3 text-[14px] text-accent hover:underline">
                {t('invitePage.haveAccount')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
