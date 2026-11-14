import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import { AuthCard } from '@/components/molecules/AuthCard';
import { FormField } from '@/components/molecules/FormField';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

// Public password-reset request. The response is intentionally identical whether
// or not the account exists, so it cannot be used to probe for users. Without
// SMTP the API creates no link at all, so the page says so up front instead of
// pretending one was sent.
export default function ForgotPassword() {
  const [identity, setIdentity] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // null while unknown: a failed config read keeps the form usable.
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .authConfig()
      .then((value) => {
        if (!cancelled) setEmailEnabled(value.emailDeliveryEnabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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

  const noEmail = emailEnabled === false;

  return (
    <AuthCard
      title={t('Reset your password')}
      description={
        noEmail
          ? t(
              'This InitPad instance cannot send e-mail, so it cannot send a reset link. Ask your administrator to reset your password; you will get a temporary password to sign in with.',
            )
          : done
            ? t(
                'If an account matches that username or e-mail, we sent a reset link to its e-mail address. Check your inbox.',
              )
            : t('Enter your username or e-mail and we’ll send a reset link.')
      }
    >
      {!done && !noEmail && (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
          <FormField
            label={t('Username or e-mail')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={busy || !identity.trim()}>
            {busy ? t('Please wait…') : t('Send reset link')}
          </Button>
        </form>
      )}
      <Link
        to="/login"
        className="text-link mt-5 inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0"
      >
        {t('Back to sign in')}
      </Link>
    </AuthCard>
  );
}
