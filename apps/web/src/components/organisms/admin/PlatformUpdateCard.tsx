import { CheckCircle2, ExternalLink, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import type { PlatformUpdateOperation, PlatformUpdateStatus } from '@/types';
import { Spinner } from '@/components/atoms/Spinner';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { Button } from '@/components/ui/button';

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
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <PackageCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Platform updates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed releases with automatic backup, readiness checks and image rollback.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && !status ? (
        <ContentLoading className="mt-5" label="Checking platform updates" count={1} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Installed
              </p>
              <p className="mt-1 font-mono text-sm">{status?.currentVersion ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest verified
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm">{status?.latestVersion ?? '—'}</span>
                {status?.releaseUrl && (
                  <a
                    href={status.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Release <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {reconnecting ? (
            <div
              className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
              role="status"
              aria-live="polite"
            >
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <span>Connection interrupted while InitPad restarts. Reconnecting…</span>
            </div>
          ) : (
            (error || status?.catalogError || status?.supervisorError) && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error || status?.supervisorError || status?.catalogError}</span>
              </div>
            )
          )}

          {status?.supervisorOnline &&
            !status.updateAvailable &&
            !status.catalogError &&
            !status.catalogStale &&
            !active && (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium">InitPad {status.currentVersion} is current</p>
                  <p className="mt-0.5 text-xs">Supervisor online · no newer verified release.</p>
                </div>
              </div>
            )}

          {operation && operation.status !== 'succeeded' && (
            <div className="rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {operation.fromVersion} → {operation.toVersion}
                </p>
                <span className={`text-xs font-semibold ${updateTone(operation.status)}`}>
                  {operation.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {operation.message || operation.stage}
              </p>
              {active && (
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
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

          {status && status.history.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent update history
              </p>
              <div className="mt-2 divide-y divide-border rounded-md border border-border">
                {status.history.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs"
                  >
                    <span className="font-mono">
                      {item.fromVersion} → {item.toVersion}
                    </span>
                    <span className={`font-semibold ${updateTone(item.status)}`}>
                      {item.status}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {item.requestedByUsername ? `@${item.requestedByUsername} · ` : ''}
                      {new Date(item.startedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
