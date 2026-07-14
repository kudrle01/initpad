import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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
  const [registrationMode, setRegistrationMode] = useState<string>('open');
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [configError, setConfigError] = useState(false);
  const oauthError = oauthErrorMessage(params.get('error'));

  useEffect(() => {
    api.authConfig()
      .then((x) => {
        setRegistrationAvailable(x.registrationAvailable);
        setRegistrationMode(x.registrationMode);
        setGithubEnabled(x.githubEnabled);
      })
      .catch(() => setConfigError(true));
  }, []);

  useEffect(() => {
    if (user && next) window.location.assign(next);
  }, [user, next]);

  if (loading) return <div className="min-h-screen bg-background" />;
  if (user && next) return <div className="min-h-screen bg-background" />;
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-9 text-center shadow-[0_6px_24px_hsl(var(--foreground)/0.09)]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
          IP
        </span>
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight">InitPad</h1>
        <p className="text-sm text-muted-foreground">Internal developer platform</p>

        {oauthError && (
          <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-2.5 text-sm text-destructive">
            {oauthError}
          </p>
        )}

        {githubEnabled && (
          <div className="mt-6">
            <a
              href="/api/auth/github?mode=login"
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-input bg-card text-sm font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <GithubIcon /> Continue with GitHub
            </a>
            <div className="my-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <div className={cn('mb-4 flex gap-1 rounded-md bg-secondary p-1', !githubEnabled && 'mt-6')}>
          {([
            'signin',
            ...(registrationAvailable ? ['register' as const] : []),
          ] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={cn(
                'flex-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                mode === m
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form className="flex flex-col gap-2.5 text-left" onSubmit={submit}>
          <label htmlFor="login-username" className="sr-only">Username or e-mail</label>
          <Input
            id="login-username"
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          {mode !== 'signin' && (
            <>
              <label htmlFor="login-email" className="sr-only">E-mail</label>
              <Input
                id="login-email"
                type="email"
                placeholder="E-mail"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </>
          )}
          <label htmlFor="login-password" className="sr-only">Password</label>
          <Input
            id="login-password"
            type="password"
            placeholder="Password"
            autoComplete={mode !== 'signin' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode !== 'signin' ? 12 : undefined}
          />

          {mode !== 'signin' && (
            <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {configError && (
            <p role="alert" className="text-sm text-destructive">
              Authentication service is unavailable. Refresh and try again.
            </p>
          )}

          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        {mode === 'signin' && (
          <Link to="/forgot-password" className="mt-3 inline-block text-xs text-muted-foreground hover:text-foreground">
            Forgot your password?
          </Link>
        )}

        {!registrationAvailable && !configError && (
          <p className="mt-4 text-xs text-muted-foreground">
            {registrationMode === 'invite-only'
              ? 'Registration is by invitation. Open the invite link a workspace owner sent you, or ask them for one.'
              : registrationMode === 'admin-provisioned'
                ? 'Accounts are created by the instance administrator. Ask your InitPad admin for sign-in details.'
                : 'Self-service registration is currently closed.'}
          </p>
        )}

      </div>
    </div>
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
      return 'No InitPad account is linked to that GitHub account. Sign in another way, then link GitHub in Settings.';
    case 'github_state':
      return 'The GitHub sign-in could not be verified. Please try again.';
    case 'github_exchange':
      return 'GitHub sign-in failed. Please try again.';
    case 'github_unavailable':
      return 'GitHub sign-in is not enabled on this instance.';
    case 'login_required':
      return 'Please sign in first, then link your GitHub account.';
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
