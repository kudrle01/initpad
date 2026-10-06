import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import { AuthCard } from '@/components/molecules/AuthCard';
import { FormField } from '@/components/molecules/FormField';
import { Notice } from '@/components/molecules/Notice';
import { Button } from '@/components/ui/button';

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
    <AuthCard
      title="Set a new password"
      description={
        done
          ? 'Your password has been reset. Redirecting you to sign in…'
          : 'Choose a new password for your account.'
      }
    >
      {!done && (
        <>
          <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
            <FormField
              label="New password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              hint="Use at least 12 characters."
            />
            <FormField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={12}
            />
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Please wait…' : 'Reset password'}
            </Button>
          </form>
          <Link
            to="/login"
            className="text-link mt-5 inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0"
          >
            Back to sign in
          </Link>
        </>
      )}
    </AuthCard>
  );
}
