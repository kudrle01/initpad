import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api';
import { BrandMark } from '@/components/atoms/BrandMark';

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
    api.verifyEmail(token)
      .then(() => setState('ok'))
      .catch((e) => {
        setError((e as Error).message);
        setState('error');
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card p-6 text-center shadow-[0_6px_24px_hsl(var(--foreground)/0.09)] sm:p-9">
        <BrandMark className="mx-auto mb-4 h-10 w-10" />
        {state === 'verifying' && <p className="text-sm text-muted-foreground">Verifying your e-mail…</p>}
        {state === 'ok' && (
          <>
            <h1 className="text-[19px] font-semibold tracking-tight">E-mail verified</h1>
            <p className="mt-1 text-sm text-muted-foreground">Thanks — your e-mail address is confirmed.</p>
            <Link to="/" className="text-link mt-5 inline-block text-sm font-medium">Go to InitPad</Link>
          </>
        )}
        {state === 'error' && (
          <>
            <h1 className="text-[19px] font-semibold tracking-tight">Verification failed</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error ?? 'This link is invalid or has expired.'}</p>
            <Link to="/" className="text-link mt-5 inline-block text-sm font-medium">Go to InitPad</Link>
          </>
        )}
      </div>
    </div>
  );
}
