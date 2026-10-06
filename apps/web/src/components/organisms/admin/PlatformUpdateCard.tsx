import { ExternalLink, PackageCheck, RefreshCw } from 'lucide-react';
import type { PlatformUpdateOperation, PlatformUpdateStatus } from '@/types';
import { Spinner } from '@/components/atoms/Spinner';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { Notice } from '@/components/molecules/Notice';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const UPDATE_STAGE_PROGRESS: Record<string, number> = {
  requesting: 5,
  accepted: 10,
  verifying: 20,
  backup: 35,
  pulling: 50,
  switching: 58,
  api: 65,
  web: 82,
  supervisor: 94,
  completed: 100,
  failed: 100,
  'request-failed': 100,
  'rolled-back': 100,
};

function updateTone(status: PlatformUpdateOperation['status']) {
  if (status === 'succeeded') return 'text-success';
  if (status === 'failed' || status === 'rolled-back') return 'text-destructive';
  return 'text-warning';
}

export function PlatformUpdateCard({
  status,
  loading,
  error,
  installing,
  onRefresh,
  onInstall,
}: {
  status: PlatformUpdateStatus | null;
  loading: boolean;
  error: string | null;
  installing: boolean;
  onRefresh: () => void;
  onInstall: () => void;
}) {
  const operation = status?.operation;
  const active = operation && ['requesting', 'accepted', 'running'].includes(operation.status);
  const reconnecting = Boolean(error && active);
  const progress = operation ? (UPDATE_STAGE_PROGRESS[operation.stage] ?? (active ? 15 : 100)) : 0;

  return (
    <SettingsSection
      icon={PackageCheck}
      title="Platform updates"
      description="Signed releases with automatic backup, readiness checks and image rollback."
      actions={
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      }
    >
      {loading && !status ? (
        <ContentLoading label="Checking platform updates" count={1} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-lg bg-muted p-4">
              <p className="eyebrow">Installed</p>
              <p className="mt-1 font-mono text-xl font-semibold tracking-tight">
                {status?.currentVersion ?? 'Unknown'}
              </p>
            </div>
            <div className="min-w-0 rounded-lg bg-muted p-4">
              <p className="eyebrow">Latest verified</p>
              <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-xl font-semibold tracking-tight">
                  {status?.latestVersion ?? '—'}
                </span>
                {status?.releaseUrl && (
                  <a
                    href={status.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link inline-flex items-center gap-1 text-xs font-medium"
                  >
                    Release <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {status?.channel === 'candidate' && (
            <Notice tone="warning" role="status">
              Candidate update channel · use only on a disposable acceptance server.
            </Notice>
          )}

          {reconnecting ? (
            <Notice
              tone="warning"
              role="status"
              aria-live="polite"
              icon={RefreshCw}
              iconClassName="animate-spin"
            >
              Connection interrupted while InitPad restarts. Reconnecting…
            </Notice>
          ) : (
            (error || status?.catalogError || status?.supervisorError) && (
              <Notice tone="danger">
                {error || status?.supervisorError || status?.catalogError}
              </Notice>
            )
          )}

          {status?.supervisorOnline &&
            !status.updateAvailable &&
            !status.catalogError &&
            !status.catalogStale &&
            !active && (
              <Notice tone="success" title={`InitPad ${status.currentVersion} is current`}>
                Supervisor online · no newer verified release.
              </Notice>
            )}

          {operation && operation.status !== 'succeeded' && (
            <div className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-medium">
                  {operation.fromVersion} → {operation.toVersion}
                </p>
                <span className={cn('text-xs font-semibold', updateTone(operation.status))}>
                  {operation.status}
                </span>
              </div>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {operation.message || operation.stage}
              </p>
              {active && (
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
                  role="progressbar"
                  aria-label="Platform update progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div
                    className="h-full rounded-full bg-warning transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {(status?.updateAvailable || active || status?.catalogStale) && (
            <div className="flex flex-wrap items-center gap-3">
              {(status?.updateAvailable || active) && (
                <Button disabled={!status?.canInstall || installing} onClick={onInstall}>
                  {installing || active ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <PackageCheck className="h-4 w-4" />
                  )}
                  {active ? 'Installing…' : 'Install update'}
                </Button>
              )}
              {status?.catalogStale && (
                <span className="text-xs text-warning">
                  Release information is stale; refresh before installing.
                </span>
              )}
            </div>
          )}

          {status && status.history.length > 0 && (
            <div>
              <p className="eyebrow">Recent update history</p>
              <ul className="mt-2 divide-y divide-border/70 overflow-hidden rounded-lg border border-border/70">
                {status.history.slice(0, 3).map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-xs"
                  >
                    <span className="font-mono text-[13px]">
                      {item.fromVersion} → {item.toVersion}
                    </span>
                    <span className={cn('font-semibold', updateTone(item.status))}>
                      {item.status}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {item.requestedByUsername ? `@${item.requestedByUsername} · ` : ''}
                      {new Date(item.startedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
