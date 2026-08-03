import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { CopyField } from '@/components/molecules/CopyField';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';

export function EmailVerificationSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [verifyLink, setVerifyLink] = useState<string | null>(null);

  if (user?.edition !== 'self-hosted' || !user.email || user.emailVerified) return null;

  async function sendVerification() {
    try {
      const { verifyUrl } = await api.requestEmailVerification();
      setVerifyLink(verifyUrl);
      toast.success('Verification link created');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <SettingsSection
      icon={Mail}
      title="Verify your e-mail"
      tone="warning"
      description={
        <>
          Confirm <strong className="font-medium text-foreground">{user.email}</strong> to secure
          account recovery. On an instance without e-mail delivery, open the link shown below.
        </>
      }
    >
      {!verifyLink ? (
        <Button variant="secondary" onClick={sendVerification}>
          Send verification link
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Open this link to verify (shown once):
          </p>
          <CopyField command={verifyLink} />
        </div>
      )}
    </SettingsSection>
  );
}
