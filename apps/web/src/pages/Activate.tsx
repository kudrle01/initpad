import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { AuthCard } from '@/components/molecules/AuthCard';
import { FormField } from '@/components/molecules/FormField';
import { MissingLinkToken } from '@/components/molecules/MissingLinkToken';
import { Notice } from '@/components/molecules/Notice';
import { Button } from '@/components/ui/button';
import { useLinkToken } from '@/lib/link-token';
import { t } from '@/i18n';

// Public page reached from an admin activation link (/activate#token). The
// user sets their own password and is signed in immediately.
export default function Activate() {
  const token = useLinkToken();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('Passwords do not match.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.activateAccount(token, password);
      signIn(user);
      void navigate('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!token) return <MissingLinkToken title={t('Activate your account')} />;

  return (
    <AuthCard
      title={t('Activate your account')}
      description={t('Choose a password to finish setting up your InitPad account.')}
    >
      <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
        <FormField
          label={t('Password')}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          hint={t('Use at least 12 characters.')}
        />
        <FormField
          label={t('Confirm password')}
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
          {busy ? t('Please wait…') : t('Activate and sign in')}
        </Button>
      </form>
      <Link
        to="/login"
        className="text-link mt-5 inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0"
      >
        {t('Back to sign in')}
      </Link>
    </AuthCard>
  );
}
