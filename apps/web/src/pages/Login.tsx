import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
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
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    api.authConfig()
      .then((x) => setRegistrationAvailable(x.registrationAvailable))
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
        mode === 'register'
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

        <div className="mb-4 mt-6 flex gap-1 rounded-md bg-secondary p-1">
          {(['signin', ...(registrationAvailable ? ['register' as const] : [])] as const).map((m) => (
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
          {mode === 'register' && (
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
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'register' ? 12 : undefined}
          />

          {mode === 'register' && (
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

      </div>
    </div>
  );
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
