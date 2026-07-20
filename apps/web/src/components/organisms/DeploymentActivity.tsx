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
  limit?: number;
}

export function DeploymentActivity({ operations, repoUrl, scmProvider, limit }: Props) {
  const visibleOperations = limit === undefined ? operations : operations.slice(0, limit);
  const sourceBuilds = Array.from(
    new Set(visibleOperations.map((operation) => operation.artifactRunId).filter(Boolean)),
  ) as string[];
  const visibleSourceBuilds = sourceBuilds.slice(0, 5);

  return (
    <div>
      <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        CI builds and tests an immutable artifact once. Deploy and redeploy publish that verified
        artifact through InitPad, so they do not start another {scmProvider === 'github' ? 'GitHub' : 'Gitea'} runner.
        This list is the current deployment activity.
        {scmProvider === 'github' && repoUrl && sourceBuilds.length > 0 && (
          <span className="ml-1 inline-flex flex-wrap items-center gap-x-2">
            <span>Source CI {sourceBuilds.length === 1 ? 'build:' : 'builds:'}</span>
            {visibleSourceBuilds.map((runId) => (
              <a
                key={runId}
                href={`${repoUrl}/actions/runs/${runId}`}
                target="_blank"
                rel="noreferrer"
                className="text-link inline-flex items-center gap-1 font-medium"
              >
                run {runId} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
            {sourceBuilds.length > visibleSourceBuilds.length && (
              <span>+{sourceBuilds.length - visibleSourceBuilds.length} more</span>
            )}
          </span>
        )}
      </div>
      {operations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No deployment activity yet.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visibleOperations.map((operation, index) => {
            const visualStatus =
              operation.status === 'succeeded'
                ? 'success'
                : operation.status === 'cancelled'
                  ? 'pending'
                  : operation.status;
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
