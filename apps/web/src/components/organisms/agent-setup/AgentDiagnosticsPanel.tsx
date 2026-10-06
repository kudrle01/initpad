import { Activity, Container, Globe2 } from 'lucide-react';
import type { AgentJobSummary, Target } from '@/types';
import { Spinner } from '@/components/atoms/Spinner';
import { InfoTip } from '@/components/molecules/InfoTip';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Button } from '@/components/ui/button';
import { t, formatDateTime } from '@/i18n';

interface Props {
  target: Target;
  jobs: AgentJobSummary[];
  protocolError: string | null;
  testBusy: 'protocol' | 'lifecycle' | 'gateway' | 'update' | null;
  busy: boolean;
  canQueueProbe: boolean;
  onTestProtocol: () => void;
  onTestLifecycle: () => void;
  onTestGateway: () => void;
}

function hasExpiredLease(job: AgentJobSummary, now = Date.now()): boolean {
  return (
    job.status === 'leased' &&
    job.leaseExpiresAt !== null &&
    new Date(job.leaseExpiresAt).getTime() <= now
  );
}

function agentJobMessage(job: AgentJobSummary, leaseExpired: boolean): string {
  if (leaseExpired) {
    return t('Lease expired. Waiting for the Agent to reconnect and retry automatically.');
  }
  if (
    job.kind === 'lifecycle-test' &&
    job.status === 'failed' &&
    job.progressPercent <= 8 &&
    job.message === 'Docker API timed out'
  ) {
    return t(
      'The diagnostic image pull timed out. Docker may have cached partial layers; verify registry access and run Test Docker again.',
    );
  }
  return job.message ?? job.progressStage;
}

export function AgentDiagnosticsPanel({
  target,
  jobs,
  protocolError,
  testBusy,
  busy,
  canQueueProbe,
  onTestProtocol,
  onTestLifecycle,
  onTestGateway,
}: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Activity className="h-4 w-4 text-primary" /> {t('Durable job protocol')}
            </p>
            <InfoTip
              label={t('About the Agent protocol test')}
              items={[
                {
                  title: t('Checks'),
                  description: t(
                    'Claim, progress reporting, lease renewal and completion over 35 seconds.',
                  ),
                },
                {
                  title: t('Impact'),
                  description: t(
                    'Does not run a shell command or create a workload. Offline jobs wait safely in the queue.',
                  ),
                },
              ]}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Checks Agent queue and lease handling without creating a workload.')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || testBusy !== null || !canQueueProbe}
          title={canQueueProbe ? t('Queue a protocol probe') : t('The Agent must be enrolled')}
          onClick={onTestProtocol}
        >
          {testBusy === 'protocol' ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Activity className="h-4 w-4" />
          )}
          {t('Test protocol')}
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border/70 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Container className="h-4 w-4 text-primary" /> {t('Restricted Docker lifecycle')}
            </p>
            <InfoTip
              label={t('About the Docker lifecycle test')}
              items={[
                {
                  title: t('Checks'),
                  description: t(
                    'Deploy, health, bounded logs, replacement, rollback, stop and restart.',
                  ),
                },
                {
                  title: t('Cleanup'),
                  description: t(
                    'Removes the temporary container, diagnostic image and empty network afterwards.',
                  ),
                },
                {
                  title: t('Restrictions'),
                  description: t(
                    'No shell command, host mount or deployment secret is sent to the Agent.',
                  ),
                },
              ]}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Runs a temporary isolated workload and removes it after the test.')}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || testBusy !== null || !canQueueProbe}
          title={
            canQueueProbe
              ? t('Queue a Docker lifecycle test')
              : t('Agent 0.3.0 or newer must be enrolled')
          }
          onClick={onTestLifecycle}
        >
          {testBusy === 'lifecycle' ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Container className="h-4 w-4" />
          )}
          {t('Test Docker')}
        </Button>
      </div>

      {target.routingMode === 'managed-gateway' && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border/70 pt-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Globe2 className="h-4 w-4 text-primary" /> {t('Production gateway preflight')}
              </p>
              <InfoTip
                label={t('About the gateway preflight')}
                items={[
                  {
                    title: t('Checks'),
                    description: t(
                      'The configured DNS zone, trusted TLS on port 443 and the private Caddy adapter.',
                    ),
                  },
                  {
                    title: t('Impact'),
                    description: t(
                      'Read-only: no route is created and gateway configuration is not changed.',
                    ),
                  },
                ]}
              />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('Checks DNS, TLS and the private gateway without changing routes.')}
            </p>
            {target.gatewayPreflight && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge
                  status={
                    target.gatewayPreflight.status === 'passed'
                      ? 'success'
                      : target.gatewayPreflight.status
                  }
                  label={t('preflight {status}', { status: target.gatewayPreflight.status })}
                />
                {target.gatewayPreflight.checkedAt && (
                  <span className="text-muted-foreground">
                    {formatDateTime(target.gatewayPreflight.checkedAt)}
                  </span>
                )}
              </div>
            )}
            {target.gatewayPreflight?.error && (
              <p className="mt-2 text-xs text-destructive">{target.gatewayPreflight.error}</p>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || testBusy !== null || !canQueueProbe}
            title={
              canQueueProbe
                ? t('Queue a read-only gateway preflight (Agent 0.5.0 or newer)')
                : t('The Agent must be enrolled')
            }
            onClick={onTestGateway}
          >
            {testBusy === 'gateway' ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <Globe2 className="h-4 w-4" />
            )}
            {t('Test gateway')}
          </Button>
        </div>
      )}

      {protocolError && <p className="text-xs text-destructive">{protocolError}</p>}
      {jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('No protocol jobs yet.')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t('Recent Agent tests · newest first')}
          </p>
          {jobs.slice(0, 3).map((job) => {
            const leaseExpired = hasExpiredLease(job);
            const displayStatus = leaseExpired ? 'waiting' : job.status;
            const displayMessage = agentJobMessage(job, leaseExpired);
            return (
              <div key={job.id} className="min-w-0 rounded-lg bg-muted p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">
                    {t('{kind} · attempt {attempt}', { kind: job.kind, attempt: job.attempt })}
                  </span>
                  <StatusBadge status={displayStatus} />
                </div>
                <time
                  className="mt-0.5 block text-xs text-muted-foreground"
                  dateTime={job.createdAt}
                >
                  {formatDateTime(job.createdAt)}
                </time>
                <p className="mt-1 break-words text-xs text-muted-foreground">{displayMessage}</p>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.1]"
                  role="progressbar"
                  aria-label={t('{kind} job progress', { kind: job.kind })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={job.progressPercent}
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${
                      job.status === 'failed'
                        ? 'bg-destructive'
                        : leaseExpired
                          ? 'bg-warning'
                          : 'bg-primary'
                    }`}
                    style={{ width: `${job.progressPercent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
