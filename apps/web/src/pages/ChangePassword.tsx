import { useState } from 'react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Full-screen gate shown while an account is under a forced password change
// (admin-provisioned temporary credentials, post-reset). It is the only view
// reachable until the password is changed; the API enforces the same rule.
export default function ChangePassword() {
  const { user, signIn, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.changePassword(currentPassword, newPassword);
      signIn(updated); // clears the flag and starts a normal session
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[380px] rounded-lg border border-border bg-card p-9 shadow-[0_6px_24px_hsl(var(--foreground)/0.09)]">
        <h1 className="text-[20px] font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {user?.username ? <>Signed in as <strong className="font-medium text-foreground">@{user.username}</strong>. </> : null}
          Your account uses a temporary password. Set a new one to continue.
        </p>

        <form className="mt-6 flex flex-col gap-2.5" onSubmit={submit}>
          <label htmlFor="cp-current" className="text-xs font-medium text-muted-foreground">Temporary password</label>
          <Input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <label htmlFor="cp-new" className="mt-1 text-xs font-medium text-muted-foreground">New password</label>
          <Input
            id="cp-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={12}
          />
          <label htmlFor="cp-confirm" className="mt-1 text-xs font-medium text-muted-foreground">Confirm new password</label>
          <Input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={12}
          />
          <p className="text-xs text-muted-foreground">Use at least 12 characters.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? 'Please wait…' : 'Update password'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => void logout()}
          className="text-link mt-4 w-full text-center text-xs font-medium"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
