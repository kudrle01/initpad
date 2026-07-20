import { ExternalLink } from 'lucide-react';
import { StatusDot } from '@/components/atoms/StatusDot';
import type { DeploymentOperation } from '@/types';

function elapsed(operation: DeploymentOperation): string {
  const start = new Date(operation.startedAt).getTime();
  const end = operation.finishedAt ? new Date(operation.finishedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

interface Props {
  operations: DeploymentOperation[];
  repoUrl: string | null;
  scmProvider: 'gitea' | 'github';
}

export function DeploymentActivity({ operations, repoUrl, scmProvider }: Props) {
  return (
    <div>
      <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        CI builds and tests an immutable artifact once. Deploy and redeploy publish that verified
        artifact through InitPad, so they do not start another {scmProvider === 'github' ? 'GitHub' : 'Gitea'} runner.
        Runner links below are the original build audit log; this list is the current deployment activity.
      </div>
      {operations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No deployment activity yet.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {operations.slice(0, 10).map((operation, index) => {
            const visualStatus =
              operation.status === 'succeeded'
                ? 'success'
                : operation.status === 'cancelled'
                  ? 'pending'
                  : operation.status;
            const runUrl =
              scmProvider === 'github' && repoUrl && operation.artifactRunId
                ? `${repoUrl}/actions/runs/${operation.artifactRunId}`
                : null;
            return (
              <div
                key={operation.id}
                className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-3"
                aria-live={index === 0 && operation.status === 'running' ? 'polite' : undefined}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <StatusDot status={visualStatus} kind="ci" className="mt-1" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium uppercase">{operation.environment}</span>
                      <span>{operation.kind.replaceAll('-', ' ')}</span>
                      <span className="text-muted-foreground">→ {operation.target}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {operation.message ?? (operation.status === 'succeeded' ? 'Deployment completed' : operation.status)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 pl-4 text-xs text-muted-foreground sm:pl-0">
                  {operation.version && <span className="font-mono">{operation.version.slice(0, 7)}</span>}
                  <span>{elapsed(operation)}</span>
                  {runUrl && (
                    <a
                      href={runUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link inline-flex items-center gap-1 font-medium"
                    >
                      CI build log <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
