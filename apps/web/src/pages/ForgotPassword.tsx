import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { AuthCard } from '@/components/molecules/AuthCard';
import { FormField } from '@/components/molecules/FormField';
import { Button } from '@/components/ui/button';

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
    <AuthCard
      title="Reset your password"
      description={
        done
          ? 'If an account matches that username or e-mail, a reset link has been created. Check your inbox — or, on a self-hosted instance without e-mail, ask your administrator for the link.'
          : 'Enter your username or e-mail and we’ll send a reset link.'
      }
    >
      {!done && (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
          <FormField
            label="Username or e-mail"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={busy || !identity.trim()}>
            {busy ? 'Please wait…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <Link
        to="/login"
        className="text-link mt-5 inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0"
      >
        Back to sign in
      </Link>
    </AuthCard>
  );
}
