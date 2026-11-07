import { Download, ShieldCheck } from 'lucide-react';
import { CopyField } from '@/components/molecules/CopyField';
import { CaInstallSteps, formatFingerprint } from '@/components/molecules/CaInstallSteps';
import { Button } from '@/components/ui/button';
import { gatewayDomainOf } from '@/lib/agent-install-command';
import { t } from '@/i18n';
import type { Target } from '@/types';

// Where a browser's user gets the gateway CA of a managed-gateway target, with
// the fingerprint the Agent reported so the downloaded file can be checked.
export function GatewayCaDownload({ target }: { target: Target }) {
  const domain = gatewayDomainOf(target.publicUrl);
  if (target.routingMode !== 'managed-gateway' || !domain) return null;
  // Plain HTTP is deliberate: a browser cannot trust the CA before it has it.
  // The fingerprint below is what makes that safe.
  const url = `http://${domain}/initpad-ca.crt`;
  const fingerprint = target.gatewayPreflight?.caSha256
    ? formatFingerprint(target.gatewayPreflight.caSha256)
    : null;

  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheck className="h-4 w-4" /> {t('Gateway certificate')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(
              'Install this certificate authority in the browser of every computer that opens the applications, so it trusts their HTTPS addresses.',
            )}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <a href={url} download="initpad-gateway-ca.crt">
            <Download className="h-4 w-4" /> {t('Download certificate')}
          </a>
        </Button>
      </div>
      {fingerprint ? (
        <div className="mt-2 min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('SHA-256 fingerprint. Compare it with the downloaded file before installing it:')}
          </p>
          <CopyField command={fingerprint} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(
            'The fingerprint is not known yet. Run the gateway test, or compare the file with the fingerprint printed by the installer on the Agent server.',
          )}
        </p>
      )}
      <CaInstallSteps fileName="initpad-gateway-ca.crt" className="mt-2" />
    </div>
  );
}
