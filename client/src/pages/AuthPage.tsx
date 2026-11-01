import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { SelfUser } from '@shared/types';
import { LIMITS } from '@shared/constants';
import { errorText, getLang, setLang, useLang, useT } from '../i18n';
import { api, ApiError } from '../lib/api';
import { BrandMark, Button, Field, Input } from '../components/ui';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const next = new URLSearchParams(location.search).get('next') || '/channels/@me';
  const [login, setLogin] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      if (mode === 'login') await api.post<{ user: SelfUser }>('/api/auth/login', { login, password });
      else await api.post<{ user: SelfUser }>('/api/auth/register', { username, displayName: displayName || undefined, email, password, locale: getLang() });
      navigate(next.startsWith('/') ? next : '/channels/@me', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_body') {
        const fields = (err.data.fields as { path: string }[] | undefined) ?? [];
        const map: Record<string, string> = {};
        for (const f of fields) map[f.path] = t(`auth.invalid.${f.path}`);
        setFieldErrors(map);
      } else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tile-bg flex min-h-full items-center justify-center overflow-y-auto p-4">
      <div className="flex w-full max-w-[940px] overflow-hidden rounded-3xl bg-bg-2" style={{ boxShadow: 'var(--shadow)' }}>
        <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-bg-0 p-10 md:flex">
          <div className="flex items-center gap-3">
            <BrandMark size={44} />
            <span className="font-display text-[22px] text-text-1">{t('app.title')}</span>
          </div>
          <div>
            <h1 className="font-display text-[46px] leading-[1.15] text-text-1">{t('auth.heroTitle')}</h1>
            <p className="mt-4 max-w-sm text-[15px] text-text-2">{t('auth.heroBody')}</p>
          </div>
          <ul className="flex flex-col gap-2 text-[14px] text-text-2">
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" /> {t('auth.point1')}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-saffron" /> {t('auth.point2')}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-text-2" /> {t('auth.point3')}
            </li>
          </ul>
          <svg viewBox="0 0 64 64" aria-hidden="true" className="pointer-events-none absolute -end-24 -bottom-24 h-72 w-72 opacity-[0.07]">
            <path fill="var(--accent)" d="M32 3.7 40.3 12H52v11.7l8.3 8.3-8.3 8.3V52H40.3L32 60.3 23.7 52H12V40.3L3.7 32 12 23.7V12h11.7z" />
          </svg>
        </section>

        <section className="flex flex-1 flex-col p-8 sm:p-10">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2 md:hidden">
              <BrandMark size={32} />
              <span className="font-display text-[18px]">{t('app.title')}</span>
            </div>
            <button
              type="button"
              onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
              className="ms-auto rounded-lg px-2.5 py-1 text-[13px] text-text-2 hover:bg-hover"
              lang={lang === 'fa' ? 'en' : 'fa'}
            >
              {lang === 'fa' ? 'English' : 'فارسی'}
            </button>
          </div>
          <h2 className="font-display text-[30px] text-text-1">{mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle')}</h2>
          <p className="mt-1 text-[14px] text-text-3">{mode === 'login' ? t('auth.loginBody') : t('auth.registerBody')}</p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
            {mode === 'login' ? (
              <Field label={t('auth.usernameOrEmail')}>
                {(id) => <Input id={id} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" dir="ltr" required autoFocus />}
              </Field>
            ) : (
              <>
                <Field label={t('auth.email')} error={fieldErrors.email}>
                  {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" dir="ltr" required autoFocus />}
                </Field>
                <Field label={t('auth.displayName')} hint={t('auth.displayNameHint')}>
                  {(id) => <Input id={id} value={displayName} maxLength={LIMITS.displayNameMax} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" />}
                </Field>
                <Field label={t('auth.username')} hint={t('auth.usernameHint')} error={fieldErrors.username}>
                  {(id) => (
                    <Input id={id} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} autoComplete="username" dir="ltr" required />
                  )}
                </Field>
              </>
            )}
            <Field label={t('auth.password')} hint={mode === 'register' ? t('auth.passwordHint', { min: LIMITS.passwordMin }) : undefined} error={fieldErrors.password}>
              {(id) => (
                <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} dir="ltr" required />
              )}
            </Field>
            {error && (
              <p role="alert" className="rounded-lg bg-danger/15 px-3 py-2 text-[14px] text-danger-text">
                {error}
              </p>
            )}
            <Button type="submit" busy={busy} className="mt-2 h-11 text-[15px]">
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </Button>
          </form>
          <p className="mt-6 text-[14px] text-text-3">
            {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
            <Link to={`${mode === 'login' ? '/register' : '/login'}${location.search}`} className="font-semibold text-accent hover:underline">
              {mode === 'login' ? t('auth.register') : t('auth.login')}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
