import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Cloud,
  Clock3,
  Container,
  ExternalLink,
  History,
  MoreVertical,
  Play,
  RefreshCw,
  Undo2,
  Server,
  Square,
  Trash2,
  AlertTriangle,
  Activity,
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
import { deploymentProgress } from '@/lib/deployment-progress';
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
  onRollback: (env: EnvName) => void;
  onRunAgain: () => void;
  onRerunFailedJobs: () => void;
  onStop: (env: EnvName) => void;
  onStart: (env: EnvName) => void;
  onRemoveEnv: (env: EnvName) => void;
  onConfigureTarget: (env: EnvName) => void;
  onDiagnostics: (env: EnvName) => void;
  readOnly?: boolean;
  canRollback?: boolean;
}

export function EnvironmentPipeline({
  project,
  busy,
  commitsBySha,
  onPromote,
  onRedeploy,
  onRollback,
  onRunAgain,
  onRerunFailedJobs,
  onStop,
  onStart,
  onRemoveEnv,
  onConfigureTarget,
  onDiagnostics,
  readOnly = false,
  canRollback = false,
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
        const hasFailedGitHubJobs =
          env.name === 'dev' &&
          project.scm.provider === 'github' &&
          !!env.artifact?.runId &&
          !!deployedCommit?.pipeline.some(
            (stage) => stage.source !== 'platform' && stage.status === 'failed',
          ) &&
          !!deployedCommit?.pipeline.some(
            (stage) => stage.source === 'platform' && stage.status === 'success',
          );
        const deploymentHistoryUrl = `/projects/${project.id}/deployments`;
        const waitingForRunner =
          env.status === 'deploying' &&
          env.statusReason === 'Waiting for an available CI runner';
        // Providers publish named deployment stages. Known stages advance the
        // end-to-end bar; a moving highlight communicates activity inside a
        // stage without pretending that elapsed time equals real completion.
        const pct =
          env.status === 'deploying' ? deploymentProgress(env.statusReason) : null;
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
        const canInspectWorkload =
          hasDeployment &&
          env.provider === 'docker' &&
          env.target?.kind === 'docker' &&
          env.target.scope === 'user';

        return (
          <Fragment key={env.name}>
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card p-4">
              <span
                className={cn(
                  'absolute inset-x-0 top-0 h-1',
                  waitingForRunner
                    ? 'bg-muted-foreground/25'
                    : STRIPE[env.status] ?? 'bg-muted-foreground/25',
                )}
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
                      <StatusBadge
                        status={waitingForRunner ? 'pending' : env.status}
                        label={waitingForRunner ? 'queued' : undefined}
                        kind={waitingForRunner ? 'ci' : 'deploy'}
                        className="cursor-pointer hover:bg-secondary/70"
                      />
                    </Link>
                  ) : (
                    <StatusBadge
                      status={waitingForRunner ? 'pending' : env.status}
                      label={waitingForRunner ? 'queued' : undefined}
                      kind={waitingForRunner ? 'ci' : 'deploy'}
                    />
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
                        {hasFailedGitHubJobs && (
                          <DropdownMenuItem onSelect={onRerunFailedJobs}>
                            <RefreshCw className="h-4 w-4" /> Re-run failed GitHub jobs
                          </DropdownMenuItem>
                        )}
                        {canDeployToTarget && (
                          <DropdownMenuItem
                            onSelect={() => env.version ? onRedeploy(env.name) : onRunAgain()}
                          >
                            <Play className="h-4 w-4" /> {env.version ? 'Deploy verified build' : 'Deploy'}
                          </DropdownMenuItem>
                        )}
                        {canRunAgain && (
                          <DropdownMenuItem onSelect={onRunAgain}>
                            <Play className="h-4 w-4" /> Deploy
                          </DropdownMenuItem>
                        )}
                        {hasDeployment && !targetNeedsDeploy && (
                          <DropdownMenuItem onSelect={() => onRedeploy(env.name)}>
                            <RefreshCw className="h-4 w-4" /> Redeploy verified build
                          </DropdownMenuItem>
                        )}
                        {hasDeployment && canRollback && !targetNeedsDeploy && (
                          <DropdownMenuItem onSelect={() => onRollback(env.name)}>
                            <Undo2 className="h-4 w-4" /> Roll back to previous version…
                          </DropdownMenuItem>
                        )}
                        {canInspectWorkload && (
                          <DropdownMenuItem onSelect={() => onDiagnostics(env.name)}>
                            <Activity className="h-4 w-4" /> Workload diagnostics…
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
                    {waitingForRunner ? (
                      <Clock3 className="h-3 w-3 shrink-0" />
                    ) : (
                      <Spinner className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">
                      {env.statusReason ?? 'Deploying…'}
                      {pct !== null ? ` · ${pct}%` : ''}
                    </span>
                  </div>
                  {!waitingForRunner && (
                    <div
                      role="progressbar"
                      aria-label={`${env.name} deployment progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct ?? undefined}
                      aria-valuetext={env.statusReason ?? 'Deploying'}
                      className="relative h-1 w-full overflow-hidden rounded-full bg-secondary"
                    >
                      {pct === null ? (
                        <div
                          aria-hidden="true"
                          className="deployment-progress-traveller absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-warning/10 via-warning to-warning/10 shadow-[0_0_6px_hsl(var(--warning)/0.45)]"
                        />
                      ) : (
                        <div
                          className="relative h-full overflow-hidden rounded-full bg-warning transition-[width] duration-700 ease-out"
                          style={{ width: `${pct}%` }}
                        >
                          <span
                            aria-hidden="true"
                            className="deployment-progress-sweep absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent"
                          />
                        </div>
                      )}
                    </div>
                  )}
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
