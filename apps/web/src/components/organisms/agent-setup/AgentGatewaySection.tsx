import { Globe2 } from 'lucide-react';
import type { Target } from '@/types';
import { Spinner } from '@/components/atoms/Spinner';
import { CopyField } from '@/components/molecules/CopyField';
import { Disclosure } from '@/components/molecules/Disclosure';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Button } from '@/components/ui/button';
import { t, formatDateTime } from '@/i18n';
import { GatewayCaDownload } from './GatewayCaDownload';

interface Props {
  target: Target;
  testing: boolean;
  disabled: boolean;
  canQueueProbe: boolean;
  /** Installer command that re-applies the gateway without a new token. */
  refreshCommand: string | null;
  onTestGateway: () => void;
}

// Everything about the managed gateway in one place: its check, the CA the
// browsers need and the command that re-applies it.
export function AgentGatewaySection({
  target,
  testing,
  disabled,
  canQueueProbe,
  refreshCommand,
  onTestGateway,
}: Props) {
  if (target.routingMode !== 'managed-gateway') return null;
  const preflight = target.gatewayPreflight;
  return (
    <section className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Globe2 className="h-4 w-4 text-primary" /> {t('Application gateway')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Checks DNS, TLS and the private gateway without changing routes.')}
          </p>
          {preflight && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge
                status={preflight.status === 'passed' ? 'success' : preflight.status}
                label={t('preflight {status}', { status: preflight.status })}
              />
              {preflight.checkedAt && (
                <span className="text-muted-foreground">{formatDateTime(preflight.checkedAt)}</span>
              )}
            </div>
          )}
          {preflight?.error && <p className="mt-2 text-xs text-destructive">{preflight.error}</p>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || !canQueueProbe}
          title={
            canQueueProbe
              ? t('Queue a read-only gateway preflight (Agent 0.5.0 or newer)')
              : t('The Agent must be enrolled')
          }
          onClick={onTestGateway}
        >
          {testing ? <Spinner className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
          {t('Test gateway')}
        </Button>
      </div>

      <GatewayCaDownload target={target} />

      {refreshCommand && (
        <Disclosure summary={t('Refresh the gateway on the server')} className="mt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t(
              'Agent 0.16 and newer refresh the gateway themselves after an update. Run this on the Docker server only for an older Agent or if that did not happen. The saved identity is kept, so no enrollment token is needed.',
            )}
          </p>
          <CopyField command={refreshCommand} />
        </Disclosure>
      )}
    </section>
  );
}
