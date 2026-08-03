import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Public password-reset request. The response is intentionally identical whether
// or not the account exists, so it cannot be used to probe for users.
export default function ForgotPassword() {
  const [identity, setIdentity] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.requestPasswordReset(identity.trim());
    } finally {
      setDone(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-6 shadow-[0_6px_24px_hsl(var(--foreground)/0.09)] sm:p-9">
        <h1 className="text-[20px] font-semibold tracking-tight">Reset your password</h1>
        {done ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              If an account matches that username or e-mail, a reset link has been created. Check your
              inbox — or, on a self-hosted instance without e-mail, ask your administrator for the link.
            </p>
            <Link to="/login" className="text-link mt-5 inline-block text-sm font-medium">Back to sign in</Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your username or e-mail and we’ll send a reset link.
            </p>
            <form className="mt-6 flex flex-col gap-2.5" onSubmit={submit}>
              <Input
                placeholder="Username or e-mail"
                autoComplete="username"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                required
              />
              <Button type="submit" className="w-full" disabled={busy || !identity.trim()}>
                {busy ? 'Please wait…' : 'Send reset link'}
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
