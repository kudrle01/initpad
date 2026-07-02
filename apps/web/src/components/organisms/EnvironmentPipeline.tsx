import { Fragment } from 'react';
import { ArrowRight, Check, Cloud, Container, ExternalLink, RefreshCw, Server, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import type { EnvName, Environment, Project, ProviderKind } from '@/types';

const NEXT: Record<EnvName, EnvName | null> = { dev: 'test', test: 'prod', prod: null };

const STRIPE: Record<string, string> = {
  running: 'bg-success',
  deploying: 'bg-warning',
  failed: 'bg-destructive',
  empty: 'bg-muted-foreground/25',
};

const PROVIDER_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

interface Props {
  project: Project;
  busy: string | null;
  onPromote: (target: EnvName) => void;
  onRedeploy: (env: EnvName) => void;
  onOpenLogs: (env: EnvName) => void;
}

export function EnvironmentPipeline({ project, busy, onPromote, onRedeploy, onOpenLogs }: Props) {
  const byEnv = Object.fromEntries(project.environments.map((e) => [e.name, e])) as Record<
    EnvName,
    Environment
  >;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      {project.environments.map((env) => {
        const next = NEXT[env.name];
        const target = next ? byEnv[next] : undefined;
        const synced =
          !!target && !!env.version && target.status === 'running' && target.version === env.version;
        const canPromote = busy === null && env.status === 'running' && !synced;
        const deploying = busy === next;
        const ProviderIcon = PROVIDER_ICON[env.provider] ?? Server;

        return (
          <Fragment key={env.name}>
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card p-4">
              <span
                className={cn('absolute inset-x-0 top-0 h-1', STRIPE[env.status] ?? 'bg-muted-foreground/25')}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider">{env.name}</span>
                <div className="flex items-center gap-1.5">
                  {env.status !== 'empty' ? (
                    <StatusBadge
                      status={env.status}
                      onClick={() => onOpenLogs(env.name)}
                      title="View deploy detail & logs"
                    />
                  ) : (
                    <StatusBadge status={env.status} />
                  )}
                  {env.version && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy !== null}
                      onClick={() => onRedeploy(env.name)}
                      title="Redeploy this environment"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-2 font-mono text-sm">
                {env.version ? `v${env.version.slice(0, 7)}` : '—'}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <ProviderIcon className="h-3.5 w-3.5 shrink-0" /> {env.provider}
              </div>

              <a
                href={env.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'mt-2 flex min-w-0 items-center gap-1 text-xs text-primary hover:underline',
                  !env.url && 'invisible',
                )}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{env.url?.replace(/^https?:\/\//, '') ?? '—'}</span>
              </a>

              {env.status === 'failed' && env.statusReason && (
                <button
                  type="button"
                  onClick={() => onOpenLogs(env.name)}
                  className="mt-2 flex items-center gap-1 rounded-sm text-left text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" /> {env.statusReason}
                </button>
              )}
            </div>

            {next && (
              <div className="flex shrink-0 flex-row items-center justify-center gap-2 sm:w-16 sm:flex-col">
                {synced ? (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success/15 text-success">
                      <Check className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] text-muted-foreground">in sync</span>
                  </>
                ) : deploying ? (
                  <>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/15 text-warning">
                      <Spinner className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] text-muted-foreground">deploying…</span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!canPromote}
                      onClick={() => onPromote(next)}
                      title={
                        canPromote
                          ? `Deploy v${env.version} from ${env.name} to ${next}`
                          : `Deploy to ${env.name} first`
                      }
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                        canPromote
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm hover:brightness-95'
                          : 'border-border text-muted-foreground/50',
                      )}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <span className="text-[11px] text-muted-foreground">
                      {canPromote ? `Deploy to ${next}` : next}
                    </span>
                  </>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
