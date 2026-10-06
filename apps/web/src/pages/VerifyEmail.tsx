import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api';
import { AuthCard } from '@/components/molecules/AuthCard';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

type State = 'verifying' | 'ok' | 'error';

// Public page reached from a verification link (/verify-email/:token).
export default function VerifyEmail() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>('verifying');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // one-shot token: never fire twice (StrictMode)
    ran.current = true;
    api
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((e) => {
        setError((e as Error).message);
        setState('error');
      });
  }, [token]);

  return (
    <AuthCard
      align="center"
      title={
        state === 'verifying'
          ? t('Verifying your e-mail…')
          : state === 'ok'
            ? t('E-mail verified')
            : t('Verification failed')
      }
      description={
        state === 'verifying'
          ? t('This only takes a moment.')
          : state === 'ok'
            ? t('Thanks — your e-mail address is confirmed.')
            : (error ?? t('This link is invalid or has expired.'))
      }
    >
      {state !== 'verifying' && (
        <Button asChild className="mt-6 w-full">
          <Link to="/">{t('Go to InitPad')}</Link>
        </Button>
      )}
    </AuthCard>
  );
}
