import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import { BrandMark } from '@/components/atoms/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Public page reached from a reset link (/reset-password/:token). A successful
// reset revokes every existing session, so the user signs in fresh afterwards.
export default function ResetPassword() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => void navigate('/login'), 1500);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-6 shadow-[0_6px_24px_hsl(var(--foreground)/0.09)] sm:p-9">
        <BrandMark className="mb-4 h-10 w-10" />
        <h1 className="text-[20px] font-semibold tracking-tight">Set a new password</h1>
        {done ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Your password has been reset. Redirecting you to sign in…
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a new password for your account.
            </p>
            <form className="mt-6 flex flex-col gap-2.5" onSubmit={submit}>
              <Input
                type="password"
                placeholder="New password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={12}
              />
              <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Please wait…' : 'Reset password'}
              </Button>
            </form>
            <Link to="/login" className="text-link mt-4 inline-block text-xs font-medium">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
