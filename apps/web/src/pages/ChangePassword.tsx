import { useState } from 'react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { AuthCard } from '@/components/molecules/AuthCard';
import { FormField } from '@/components/molecules/FormField';
import { Notice } from '@/components/molecules/Notice';
import { Button } from '@/components/ui/button';

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
    <AuthCard
      title="Choose a new password"
      description={
        <>
          {user?.username ? (
            <>
              Signed in as <strong className="font-medium text-foreground">@{user.username}</strong>
              .{' '}
            </>
          ) : null}
          Your account uses a temporary password. Set a new one to continue.
        </>
      }
    >
      <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
        <FormField
          id="cp-current"
          label="Temporary password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <FormField
          id="cp-new"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={12}
          hint="Use at least 12 characters."
        />
        <FormField
          id="cp-confirm"
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
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Please wait…' : 'Update password'}
        </Button>
      </form>

      <Button variant="ghost" className="mt-3 w-full" onClick={() => void logout()}>
        Sign out
      </Button>
    </AuthCard>
  );
}
