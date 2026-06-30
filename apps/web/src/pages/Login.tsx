import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api, loginUrl } from '@/api';
import { useAuth } from '@/auth';
import { Icon } from '@/components/Icon';

type Mode = 'signin' | 'register';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [params] = useSearchParams();
  const oauthError = params.get('error');
  // Cíl po přihlášení – typicky OIDC authorize URL (SSO do Gitey).
  const next = params.get('next');

  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Po přihlášení pokračuj na ?next (plná URL na backendu) – dokončí SSO.
  useEffect(() => {
    if (user && next) window.location.assign(next);
  }, [user, next]);

  if (loading) return <div className="login-screen" />;
  if (user && next) return <div className="login-screen" />;
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
    <div className="login-screen">
      <div className="login-card">
        <span className="brand-mark login-mark">IP</span>
        <h1>InitPad</h1>
        <p className="muted">Internal developer platform</p>

        <div className="login-tabs">
          <button
            className={`login-tab ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => {
              setMode('register');
              setError(null);
            }}
          >
            Create account
          </button>
        </div>

        <form className="login-form" onSubmit={submit}>
          <input
            className="input"
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          {mode === 'register' && (
            <input
              className="input"
              type="email"
              placeholder="E-mail"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
          <input
            className="input"
            type="password"
            placeholder="Password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {(error || oauthError) && (
            <p className="error" style={{ margin: 0 }}>
              {error ?? 'Sign-in failed, please try again.'}
            </p>
          )}

          <button className="btn btn-primary btn-block" disabled={busy} type="submit">
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="login-divider">
          <span>or</span>
        </div>

        <a className="btn btn-block" href={loginUrl}>
          <Icon name="git" size={16} /> Continue with Gitea
        </a>
      </div>
    </div>
  );
}
