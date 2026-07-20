import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Public page reached from an admin activation link (/activate/:token). The
// user sets their own password and is signed in immediately.
export default function Activate() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.activateAccount(token, password);
      signIn(user);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-9 shadow-[0_6px_24px_hsl(var(--foreground)/0.09)]">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
          IP
        </span>
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Activate your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a password to finish setting up your InitPad account.</p>
        <form className="mt-6 flex flex-col gap-2.5" onSubmit={submit}>
          <Input
            type="password"
            placeholder="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
          <Input
            type="password"
            placeholder="Confirm password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
          />
          <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : 'Activate and sign in'}
          </Button>
        </form>
        <Link to="/login" className="text-link mt-4 inline-block text-xs font-medium">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
