import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InvitationPreview } from '@/types';

// Public acceptance page for /invite/:token. Signed-in users whose e-mail
// matches accept directly; everyone else registers an account bound to the
// invited address or signs in with the matching one.
export default function AcceptInvite() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, refreshWorkspaces } = useAuth();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.previewInvitation(token)
      .then(setPreview)
      .catch((e) => setLoadError((e as Error).message));
  }, [token]);

  const emailMatches = !!user && (user.email ?? '').toLowerCase() === preview?.email.toLowerCase();

  async function acceptAsCurrentUser() {
    setBusy(true);
    setError(null);
    try {
      await api.acceptInvitation(token);
      await refreshWorkspaces();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function registerAndAccept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.registerViaInvitation(token, username.trim(), password);
      signIn(created);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[400px] rounded-lg border border-border bg-card p-9 shadow-[0_6px_24px_hsl(var(--foreground)/0.09)]">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
          IP
        </span>

        {loadError && (
          <div className="mt-5 text-center">
            <h1 className="text-lg font-semibold">Invitation unavailable</h1>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
            <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">Go to sign in</Link>
          </div>
        )}

        {!loadError && !preview && (
          <p className="mt-6 text-center text-sm text-muted-foreground">Loading invitation…</p>
        )}

        {preview && (
          <div className="mt-5">
            <h1 className="text-center text-[19px] font-semibold tracking-tight">Join {preview.workspaceName}</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              @{preview.invitedBy} invited <strong className="font-medium text-foreground">{preview.email}</strong> as{' '}
              <strong className="font-medium text-foreground">{preview.role}</strong>.
            </p>

            {!authLoading && user && emailMatches && (
              <div className="mt-6">
                <Button className="w-full" disabled={busy} onClick={acceptAsCurrentUser}>
                  {busy ? 'Please wait…' : `Accept as @${user.username}`}
                </Button>
              </div>
            )}

            {!authLoading && user && !emailMatches && (
              <p className="mt-6 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
                You are signed in as @{user.username}, but this invitation was sent to {preview.email}.
                Sign out and use the matching account to accept it.
              </p>
            )}

            {!authLoading && !user && (
              <>
                <form className="mt-6 flex flex-col gap-2.5" onSubmit={registerAndAccept}>
                  <p className="text-xs font-medium text-muted-foreground">Create your account</p>
                  <Input
                    placeholder="Username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                  />
                  <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? 'Please wait…' : 'Create account & join'}
                  </Button>
                </form>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Already have an account?{' '}
                  <Link to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-primary hover:underline">
                    Sign in
                  </Link>{' '}
                  with {preview.email} to accept.
                </p>
              </>
            )}

            {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
