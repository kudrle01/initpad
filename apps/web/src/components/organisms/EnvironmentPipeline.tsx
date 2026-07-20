import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Cloud,
  Container,
  ExternalLink,
  History,
  MoreVertical,
  Play,
  RefreshCw,
  Server,
  Square,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import { cleanupNotice } from '@/lib/deployment';
import type { Commit, EnvName, Environment, Project, ProviderKind } from '@/types';

const NEXT: Record<EnvName, EnvName | null> = { dev: 'test', test: 'prod', prod: null };

const STRIPE: Record<string, string> = {
  running: 'bg-success',
  deploying: 'bg-warning',
  failed: 'bg-destructive',
  stopped: 'bg-muted-foreground/50',
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
  commitsBySha: Record<string, Commit>;
  onPromote: (target: EnvName) => void;
  onRedeploy: (env: EnvName) => void;
  onRunAgain: () => void;
  onStop: (env: EnvName) => void;
  onStart: (env: EnvName) => void;
  onRemoveEnv: (env: EnvName) => void;
  onConfigureTarget: (env: EnvName) => void;
  readOnly?: boolean;
}

export function EnvironmentPipeline({
  project,
  busy,
  commitsBySha,
  onPromote,
  onRedeploy,
  onRunAgain,
  onStop,
  onStart,
  onRemoveEnv,
  onConfigureTarget,
  readOnly = false,
}: Props) {
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
          !!target &&
          !!env.version &&
          target.status === 'running' &&
          target.version === env.version &&
          (env.artifact ? target.artifact?.id === env.artifact.id : !target.artifact);
        const canPromote = !readOnly && busy === null && env.status === 'running' && !synced;
        const deploying = busy === next || target?.status === 'deploying';
        const ProviderIcon = PROVIDER_ICON[env.provider] ?? Server;
        const deployedCommit = env.version ? commitsBySha[env.version] : undefined;
        const deploymentHistoryUrl = `/projects/${project.id}/deployments`;
        // While deploying, statusReason carries the live step (e.g.
        // 'Uploading 340/1200 files'); derive a % for the bar when it has a ratio.
        const ratio =
          env.status === 'deploying' && env.statusReason
            ? env.statusReason.match(/(\d+)\s*\/\s*(\d+)/)
            : null;
        const pct = ratio
          ? Math.min(100, Math.round((Number(ratio[1]) / Math.max(1, Number(ratio[2]))) * 100))
          : null;
        // Stop/Start only makes sense for process targets (Docker/SSH), not static hosting (SFTP).
        const canStopStart = env.provider !== 'sftp';
        const hasDeployment = env.status !== 'empty' && !!env.version;
        const cleanupPending = env.status === 'empty' && !!env.statusReason;
        const targetNeedsDeploy =
          env.deploymentRequired && ['empty', 'failed'].includes(env.status);
        const canDeployToTarget =
          targetNeedsDeploy && (!!env.version || env.name === 'dev');
        const canRunAgain =
          env.name === 'dev' &&
          !env.version &&
          (env.status === 'empty' || env.status === 'failed') &&
          !targetNeedsDeploy;
        // Any environment can be pointed at a different target.
        const canTarget = true;

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
                    <Link
                      to={deploymentHistoryUrl}
                      title="View InitPad deployment history"
                      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <StatusBadge status={env.status} className="cursor-pointer hover:bg-secondary/70" />
                    </Link>
                  ) : (
                    <StatusBadge status={env.status} />
                  )}
                  {!readOnly && (hasDeployment || canTarget) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy !== null}
                          aria-label="Environment actions"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {canDeployToTarget && (
                          <DropdownMenuItem
                            onSelect={() => env.version ? onRedeploy(env.name) : onRunAgain()}
                          >
                            <Play className="h-4 w-4" /> {env.version ? 'Deploy verified build' : 'Deploy'}
                          </DropdownMenuItem>
                        )}
                        {canRunAgain && (
                          <DropdownMenuItem onSelect={onRunAgain}>
                            <Play className="h-4 w-4" /> Run again
                          </DropdownMenuItem>
                        )}
                        {hasDeployment && !targetNeedsDeploy && (
                          <DropdownMenuItem onSelect={() => onRedeploy(env.name)}>
                            <RefreshCw className="h-4 w-4" /> Redeploy verified build
                          </DropdownMenuItem>
                        )}
                        {hasDeployment &&
                          canStopStart &&
                          (env.status === 'stopped' ? (
                            <DropdownMenuItem onSelect={() => onStart(env.name)}>
                              <Play className="h-4 w-4" /> Start
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => onStop(env.name)}
                              disabled={env.status !== 'running'}
                            >
                              <Square className="h-4 w-4" /> Stop
                            </DropdownMenuItem>
                          ))}
                        {canTarget && (
                          <DropdownMenuItem onSelect={() => onConfigureTarget(env.name)}>
                            <Server className="h-4 w-4" /> Change target
                          </DropdownMenuItem>
                        )}
                        {(hasDeployment || env.status === 'deploying' || cleanupPending) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => onRemoveEnv(env.name)}>
                              <Trash2 className="h-4 w-4" />{' '}
                              {env.status === 'deploying'
                                ? 'Cancel deploy'
                                : cleanupPending
                                  ? 'Retry cleanup'
                                  : 'Remove deployment'}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              <div className="mt-2 font-mono text-sm">
                {env.version ? `v${env.version.slice(0, 7)}` : '—'}
              </div>
              {env.artifact && (
                <div
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={`Verified build sha256:${env.artifact.digest}`}
                >
                  build {env.artifact.digest.slice(0, 12)}
                </div>
              )}
              {deployedCommit && (
                <div className="truncate text-xs text-muted-foreground" title={deployedCommit.message}>
                  {deployedCommit.message}
                </div>
              )}
              <div
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
                title={env.target?.host ?? env.provider}
              >
                <ProviderIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{env.target?.name ?? env.provider}</span>
                {env.target?.scope === 'user' && (
                  <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[10px] font-medium uppercase tracking-wide">
                    yours
                  </span>
                )}
              </div>

              {targetNeedsDeploy && (
                <div className="mt-2 flex items-start gap-1 text-xs text-primary">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Target changed — deploy to apply it.</span>
                </div>
              )}

              <a
                href={env.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'text-link mt-2 flex min-w-0 items-center gap-1 text-xs',
                  !env.url && 'invisible',
                )}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{env.url?.replace(/^https?:\/\//, '') ?? '—'}</span>
              </a>

              {env.status === 'deploying' && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Spinner className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {env.statusReason ?? 'Deploying…'}
                      {pct !== null ? ` · ${pct}%` : ''}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full bg-warning transition-all duration-500',
                        pct === null && 'w-1/3 animate-pulse',
                      )}
                      style={pct !== null ? { width: `${pct}%` } : undefined}
                    />
                  </div>
                </div>
              )}

              {env.status === 'failed' && env.statusReason && (
                <Link
                  to={deploymentHistoryUrl}
                  className="mt-2 flex items-center gap-1 rounded-sm text-left text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0" /> {env.statusReason}
                  <History className="h-3 w-3 shrink-0" />
                </Link>
              )}

              {cleanupPending && (
                <div className="mt-2 flex items-start gap-1 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{cleanupNotice(env.statusReason!)}</span>
                </div>
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
