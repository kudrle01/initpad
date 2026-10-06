import { ExternalLink } from 'lucide-react';
import { StatusDot } from '@/components/atoms/StatusDot';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { DeploymentOperation } from '@/types';

function phaseVariant(phase: string): BadgeProps['variant'] {
  if (phase === 'succeeded') return 'success';
  if (phase === 'failed' || phase === 'unhealthy') return 'danger';
  if (phase === 'cancelled') return 'default';
  return 'warning';
}

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
      {scmProvider === 'github' && repoUrl && sourceBuilds.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
          <span className="font-medium text-foreground">
            Source CI {sourceBuilds.length === 1 ? 'build' : 'builds'}
          </span>
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
        </div>
      )}
      {operations.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-muted-foreground">
          No deployment activity yet.
        </div>
      ) : (
        <div className="divide-y divide-border/70">
          {visibleOperations.map((operation, index) => {
            const visualStatus =
              operation.phase === 'succeeded'
                ? 'success'
                : operation.phase === 'failed' || operation.phase === 'unhealthy'
                  ? 'failed'
                  : operation.phase === 'cancelled' || operation.phase === 'queued'
                    ? 'pending'
                    : 'running';
            return (
              <div
                key={operation.id}
                className="flex min-w-0 items-start gap-3 px-4 py-3 sm:px-6"
                aria-live={index === 0 && operation.status === 'running' ? 'polite' : undefined}
              >
                <StatusDot status={visualStatus} kind="ci" className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-semibold uppercase tracking-wide">
                      {operation.environment}
                    </span>
                    <span>{operation.kind.replaceAll('-', ' ')}</span>
                    <Badge variant={phaseVariant(operation.phase)} className="px-2 py-0">
                      {operation.phase.replaceAll('-', ' ')}
                    </Badge>
                  </div>
                  <p
                    className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground"
                    title={operation.message ?? undefined}
                  >
                    <span className="text-foreground/80">→ {operation.target}</span>
                    {' · '}
                    {operation.message ??
                      (operation.status === 'succeeded'
                        ? 'Deployment completed'
                        : operation.status)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                  {operation.version && (
                    <span className="font-mono">{operation.version.slice(0, 7)}</span>
                  )}
                  <span className="whitespace-nowrap tabular-nums">{elapsed(operation)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
