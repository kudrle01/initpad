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
  const [emailQueued, setEmailQueued] = useState(false);

  if (user?.edition !== 'self-hosted' || !user.email || user.emailVerified) return null;

  async function sendVerification() {
    try {
      const result = await api.requestEmailVerification();
      setVerifyLink(result.verifyUrl ?? null);
      setEmailQueued(result.delivery === 'email');
      toast.success(
        result.delivery === 'email' ? 'Verification e-mail queued' : 'Verification link created',
      );
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
          account recovery. Configured instances deliver the link by e-mail; otherwise it is shown
          here once.
        </>
      }
    >
      {emailQueued ? (
        <p className="text-sm text-primary">
          Check your inbox. The single-use verification link has been queued for delivery.
        </p>
      ) : !verifyLink ? (
        <Button variant="secondary" onClick={sendVerification}>
          Send verification link
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Open this link to verify (shown once):</p>
          <CopyField command={verifyLink} />
        </div>
      )}
    </SettingsSection>
  );
}
