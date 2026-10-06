import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { AuthCard } from '@/components/molecules/AuthCard';
import { FormField } from '@/components/molecules/FormField';
import { Notice } from '@/components/molecules/Notice';
import { SegmentedControl } from '@/components/molecules/SegmentedControl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

type Mode = 'signin' | 'register';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [params] = useSearchParams();
  const next = safeLocalDestination(params.get('next'));

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationAvailable, setRegistrationAvailable] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [passwordAuthEnabled, setPasswordAuthEnabled] = useState(false);
  const [edition, setEdition] = useState<'self-hosted' | 'saas'>('self-hosted');
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState(false);
  const oauthError = oauthErrorMessage(params.get('error'));

  useEffect(() => {
    api
      .authConfig()
      .then((x) => {
        setRegistrationAvailable(x.registrationAvailable);
        setGithubEnabled(x.githubEnabled);
        setPasswordAuthEnabled(x.passwordAuthEnabled);
        setEdition(x.edition);
      })
      .catch(() => setConfigError(true))
      .finally(() => setConfigLoading(false));
  }, []);

  useEffect(() => {
    if (user && next) window.location.assign(next);
  }, [user, next]);

  if (loading) return <div className="min-h-dvh bg-background" />;
  if (user && next) return <div className="min-h-dvh bg-background" />;
  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u =
        mode !== 'signin'
          ? await api.register(username.trim(), email.trim(), password)
          : await api.signin(username.trim(), password);
      signIn(u);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const registering = mode === 'register';

  return (
    <AuthCard title="InitPad" description={t('Internal developer platform')} align="center">
      {oauthError && (
        <Notice tone="danger" role="alert" className="mt-6 text-left">
          {oauthError}
        </Notice>
      )}

      {configLoading && (
        <p role="status" className="mt-6 text-center text-sm text-muted-foreground">
          {t('Loading sign-in options…')}
        </p>
      )}

      {configError && (
        <Notice tone="danger" role="alert" className="mt-6 text-left">
          {t('Authentication service is unavailable. Refresh and try again.')}
        </Notice>
      )}

      {!configLoading && githubEnabled && (
        <div className="mt-6">
          <Button asChild variant="secondary" className="w-full">
            <a href="/api/auth/github?mode=login">
              <GithubIcon /> {t('Continue with GitHub')}
            </a>
          </Button>
          {passwordAuthEnabled && (
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> {t('or')}{' '}
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
        </div>
      )}

      {!configLoading && passwordAuthEnabled && (
        <>
          {registrationAvailable && (
            <SegmentedControl
              label={t('Sign in or create an account')}
              stretch
              className={cn('mb-5', !githubEnabled && 'mt-6')}
              options={[
                { value: 'signin', label: t('Sign in') },
                { value: 'register', label: t('Create account') },
              ]}
              value={mode}
              onChange={(next) => {
                setMode(next);
                setError(null);
              }}
            />
          )}

          <form
            className={cn(
              'flex flex-col gap-4',
              !registrationAvailable && !githubEnabled && 'mt-6',
            )}
            onSubmit={submit}
          >
            <FormField
              id="login-username"
              label={registering ? t('Username') : t('Username or e-mail')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            {registering && (
              <FormField
                id="login-email"
                label={t('E-mail')}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
            <FormField
              id="login-password"
              label={t('Password')}
              type="password"
              autoComplete={registering ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={registering ? 12 : undefined}
              hint={registering ? t('Use at least 12 characters.') : undefined}
            />

            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t('Please wait…') : registering ? t('Create account') : t('Sign in')}
            </Button>
          </form>

          {!registering && (
            <div className="mt-3 text-center">
              <Link
                to="/forgot-password"
                className="text-link inline-flex min-h-11 items-center justify-center text-sm font-medium sm:min-h-0"
              >
                {t('Forgot your password?')}
              </Link>
            </div>
          )}
        </>
      )}

      {!configLoading && passwordAuthEnabled && !registrationAvailable && !configError && (
        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          {t(
            'Accounts are created by the instance administrator. Ask your InitPad admin for a sign-in link.',
          )}
        </p>
      )}

      {!configLoading &&
        !passwordAuthEnabled &&
        edition === 'saas' &&
        githubEnabled &&
        !configError && (
          <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
            {t(
              'Your GitHub account creates or opens your InitPad account. Repository access is granted separately through the GitHub App.',
            )}
          </p>
        )}

      {!configLoading && !passwordAuthEnabled && !githubEnabled && !configError && (
        <Notice tone="danger" role="alert" className="mt-5 text-left">
          {t('GitHub sign-in is not configured for this SaaS installation.')}
        </Notice>
      )}
    </AuthCard>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function oauthErrorMessage(code: string | null): string | null {
  switch (code) {
    case 'github_no_account':
      return t(
        'No InitPad account is linked to that GitHub account. Sign in another way, then link GitHub in Settings.',
      );
    case 'account_deactivated':
      return t('This account has been deactivated. Contact your administrator.');
    case 'github_state':
      return t('The GitHub sign-in could not be verified. Please try again.');
    case 'github_exchange':
      return t('GitHub sign-in failed. Please try again.');
    case 'github_unavailable':
      return t('GitHub sign-in is not enabled on this instance.');
    case 'login_required':
      return t('Please sign in first, then link your GitHub account.');
    default:
      return null;
  }
}

function safeLocalDestination(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
