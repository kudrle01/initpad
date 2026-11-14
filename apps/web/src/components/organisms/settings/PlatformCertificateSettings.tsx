import { useEffect, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { HelpLink } from '@/components/molecules/HelpLink';
import { CaInstallSteps, formatFingerprint } from '@/components/molecules/CaInstallSteps';
import { CopyField } from '@/components/molecules/CopyField';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { AgentDistribution } from '@/types';

type PrivateCa = NonNullable<AgentDistribution['privateCa']>;

const FILE_NAME = 'initpad-root-ca.crt';

/**
 * The root of the installation's own CA ("tls internal", ADR-161), so a
 * browser trusts InitPad and its Git server without a warning. The same file
 * the Agent command pins is offered here with the fingerprint browsers show.
 * Installations with a public certificate have no private CA and no section.
 */
export function PlatformCertificateSettings() {
  const { user } = useAuth();
  const [ca, setCa] = useState<PrivateCa | null>(null);
  const selfHosted = user?.edition === 'self-hosted';

  useEffect(() => {
    if (!selfHosted) return;
    let active = true;
    api
      .getAgentDistribution()
      .then((distribution) => {
        if (active) setCa(distribution.privateCa);
      })
      // Without metadata there is nothing to offer; the section stays hidden.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [selfHosted]);

  if (!selfHosted || !ca) return null;

  // Other computers fetch the file over plain HTTP, because a browser cannot
  // trust HTTPS before it has the CA. The fingerprint makes that safe.
  const httpUrl = new URL(ca.path, `http://${window.location.hostname}`).toString();

  return (
    <SettingsSection
      icon={ShieldCheck}
      title={t('Platform certificate')}
      description={
        <>
          {t(
            'This InitPad issues its own HTTPS certificates. Install its certificate authority once on every computer, so the browser trusts InitPad and its Git server without a warning.',
          )}{' '}
          <HelpLink topic="self-hosted" />
        </>
      }
      actions={
        <Button asChild variant="secondary" size="sm">
          <a href={ca.path} download={FILE_NAME}>
            <Download className="h-4 w-4" /> {t('Download certificate')}
          </a>
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {ca.fingerprintSha256 && (
          <div className="min-w-0">
            <p className="mb-1 text-xs text-muted-foreground">
              {t('SHA-256 fingerprint. Compare it with the downloaded file before installing it:')}
            </p>
            <CopyField command={formatFingerprint(ca.fingerprintSha256)} />
          </div>
        )}
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('On a computer that does not trust InitPad yet, download it from:')}
          </p>
          <CopyField command={httpUrl} />
        </div>
        <CaInstallSteps fileName={FILE_NAME} />
      </div>
    </SettingsSection>
  );
}
