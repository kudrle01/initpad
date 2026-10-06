import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { CopyField } from '@/components/molecules/CopyField';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import { t, rich } from '@/i18n';

export function EmailVerificationSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [verifyLink, setVerifyLink] = useState<string | null>(null);
  const [emailQueued, setEmailQueued] = useState(false);

  if (user?.edition !== 'self-hosted' || !user.email || user.emailVerified) return null;

  async function sendVerification() {
    try {
      const result = await api.requestEmailVerification();
      setVerifyLink(result.verifyUrl ?? null);
      setEmailQueued(result.delivery === 'email');
      toast.success(
        result.delivery === 'email'
          ? t('Verification e-mail queued')
          : t('Verification link created'),
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <SettingsSection
      icon={Mail}
      title={t('Verify your e-mail')}
      tone="warning"
      description={
        <>
          {rich(
            'Confirm <b>{email}</b> to secure account recovery. Configured instances deliver the link by e-mail; otherwise it is shown here once.',
            {
              email: user.email,
              b: (chunk) => <strong className="font-medium text-foreground">{chunk}</strong>,
            },
          )}
        </>
      }
    >
      {emailQueued ? (
        <p className="text-sm text-primary">
          {t('Check your inbox. The single-use verification link has been queued for delivery.')}
        </p>
      ) : !verifyLink ? (
        <Button variant="secondary" onClick={sendVerification}>
          {t('Send verification link')}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('Open this link to verify (shown once)')}</p>
          <CopyField command={verifyLink} />
        </div>
      )}
    </SettingsSection>
  );
}
