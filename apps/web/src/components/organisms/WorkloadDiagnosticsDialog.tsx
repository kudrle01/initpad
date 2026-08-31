import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  RefreshCw,
  ScrollText,
  WifiOff,
} from 'lucide-react';
import { api } from '@/api';
import { Spinner } from '@/components/atoms/Spinner';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Environment, WorkloadDiagnostic, WorkloadHealth } from '@/types';

interface Props {
  projectId: string;
  environment: Environment | null;
  onOpenChange: (open: boolean) => void;
}

const HEALTH_PRESENTATION: Record<WorkloadHealth, { status: string; label: string }> = {
  healthy: { status: 'success', label: 'healthy' },
  unhealthy: { status: 'failed', label: 'unhealthy' },
  'not-running': { status: 'stopped', label: 'not running' },
  missing: { status: 'empty', label: 'missing' },
};

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-secondary/20 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-medium ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </p>
    </div>
  );
}

/**
 * Read-only, point-in-time workload inspection. The only remote operation is
 * the Agent's fixed diagnostics method; this surface cannot execute commands,
 * restart containers or mutate a deployment.
 */
export function WorkloadDiagnosticsDialog({ projectId, environment, onOpenChange }: Props) {
  const [snapshot, setSnapshot] = useState<WorkloadDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const environmentName = environment?.name ?? null;

  const load = useCallback(async (initial = false) => {
    if (!environmentName) return;
    if (initial) setLoading(true);
    try {
      setSnapshot(await api.getWorkloadDiagnostic(projectId, environmentName));
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      if (initial) setLoading(false);
    }
  }, [environmentName, projectId]);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (environmentName) void load(true);
  }, [environmentName, load]);

  const active = snapshot?.status === 'queued' || snapshot?.status === 'running';
  useEffect(() => {
    if (!active || !environmentName) return;
    // Keep polling even when progress is unchanged or one request fails. A
    // one-shot timeout tied only to scalar progress would silently stop in
    // both cases and leave a queued snapshot looking stuck.
    const timer = window.setInterval(() => void load(), snapshot.agentOnline ? 1_500 : 3_000);
    return () => window.clearInterval(timer);
  }, [active, environmentName, load, snapshot?.agentOnline]);

  async function requestSnapshot() {
    if (!environmentName) return;
    setRequesting(true);
    setError(null);
    try {
      setSnapshot(await api.requestWorkloadDiagnostic(
        projectId,
        environmentName,
        crypto.randomUUID(),
      ));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setRequesting(false);
    }
  }

  const observed = snapshot?.observedAt !== null && snapshot?.observedAt !== undefined;
  const health = snapshot?.health ? HEALTH_PRESENTATION[snapshot.health] : null;
  const progress = Math.min(100, Math.max(0, snapshot?.progressPercent ?? 0));

  return (
    <Dialog open={environment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle><Activity className="h-[18px] w-[18px]" /> Workload diagnostics — {environmentName}</DialogTitle>
          <DialogDescription>
            A read-only snapshot from {environment?.target?.name ?? 'the Agent target'}. It does not
            deploy, restart or execute a shell command in the workload.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner className="h-5 w-5" /> Loading diagnostics
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {snapshot && !snapshot.agentOnline && (
              <div className="flex items-start gap-3 rounded-lg border border-warning/60 bg-warning/10 p-4" role="status">
                <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                  <p className="text-sm font-semibold">Agent is offline</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {active
                      ? 'This request is safely queued and will continue when the Agent reconnects.'
                      : 'The last successful snapshot remains available, but it may no longer describe the current workload.'}
                  </p>
                </div>
              </div>
            )}

            {snapshot && (
              <div className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Diagnostic request</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {snapshot.requestedAt
                        ? new Date(snapshot.requestedAt).toLocaleString()
                        : 'Not requested yet'}
                    </p>
                  </div>
                  <StatusBadge status={snapshot.status} />
                </div>
                {active && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{snapshot.message ?? 'Waiting for Agent'}</span>
                      <span className="shrink-0">{progress}%</span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-secondary"
                      role="progressbar"
                      aria-label="Workload diagnostics progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <div
                        className="h-full rounded-full bg-warning transition-[width] duration-500"
                        style={{ width: `${Math.max(progress, 3)}%` }}
                      />
                    </div>
                  </div>
                )}
                {snapshot.status === 'failed' && snapshot.message && (
                  <p className="mt-3 flex items-start gap-1.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {snapshot.message}
                  </p>
                )}
              </div>
            )}

            {observed && snapshot ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    {snapshot.runtimeState === 'running'
                      ? <CheckCircle2 className="h-4 w-4 text-success" />
                      : <CircleStop className="h-4 w-4 text-muted-foreground" />}
                    Last successful snapshot
                  </p>
                  <span className="text-xs text-muted-foreground">
                    Observed {new Date(snapshot.observedAt!).toLocaleString()}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Runtime" value={snapshot.runtimeState ?? 'unknown'} />
                  <div className="min-w-0 rounded-md border border-border bg-secondary/20 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Health</p>
                    <div className="mt-1"><StatusBadge status={health?.status ?? 'idle'} label={health?.label ?? 'unknown'} /></div>
                  </div>
                  <Detail label="Exit code" value={snapshot.exitCode === null ? '—' : String(snapshot.exitCode)} mono />
                  <Detail label="Revision" value={snapshot.revision?.slice(0, 12) ?? '—'} mono />
                </div>
                <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-foreground/[0.035]">
                  <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium"><ScrollText className="h-4 w-4" /> Application output</p>
                    <span className="text-[11px] text-muted-foreground">last 200 lines · max 32 KiB</span>
                  </div>
                  {snapshot.logs ? (
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-foreground" tabIndex={0}>
                      {snapshot.logs}
                    </pre>
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">No output was captured in the bounded window.</p>
                  )}
                </div>
              </>
            ) : !snapshot ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <ScrollText className="mx-auto h-7 w-7 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No diagnostic snapshot yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Run diagnostics to read container state, health, exit code and bounded recent output.
                </p>
              </div>
            ) : null}

            <p className="text-xs leading-relaxed text-muted-foreground">
              Application output can contain sensitive business data. Access is limited to project
              members who can change the project, and each refresh replaces the previous stored output.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button disabled={loading || requesting || active} onClick={requestSnapshot}>
            {requesting || active ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            {active ? 'Diagnostics running' : observed ? 'Refresh diagnostics' : 'Run diagnostics'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
