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
  Link2Off,
  PackageCheck,
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
import type { Commit, EnvName, Project, ProviderKind } from '@/types';
import { t, rich, formatDateTime } from '@/i18n';
import { statusLabel } from '@/i18n/labels';

// One stage of the pipeline. The promote control between two stages is the
// only primary action here; everything else lives in the stage menu.
const STAGE_CARD = 'min-w-0 flex-1 rounded-xl border border-border/70 bg-card p-4 shadow-sm sm:p-5';
const STAGE_NOTE = 'mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs leading-relaxed';
// The stages sit side by side only when the pipeline itself is wide enough for
// them — a container query, because the same component lives in a full-width
// page, beside a sidebar and on a phone. Fewer stages need less room.
const LAYOUT = {
  three: {
    track:
      'flex flex-col gap-3 [@container(min-width:52rem)]:flex-row [@container(min-width:52rem)]:items-stretch',
    connector:
      'flex shrink-0 flex-row items-center justify-center gap-2 [@container(min-width:52rem)]:w-[4.5rem] [@container(min-width:52rem)]:flex-col [@container(min-width:52rem)]:gap-1.5',
    arrow: 'h-4 w-4 rotate-90 [@container(min-width:52rem)]:rotate-0',
  },
  two: {
    track:
      'flex flex-col gap-3 [@container(min-width:34rem)]:flex-row [@container(min-width:34rem)]:items-stretch',
    connector:
      'flex shrink-0 flex-row items-center justify-center gap-2 [@container(min-width:34rem)]:w-[4.5rem] [@container(min-width:34rem)]:flex-col [@container(min-width:34rem)]:gap-1.5',
    arrow: 'h-4 w-4 rotate-90 [@container(min-width:34rem)]:rotate-0',
  },
} as const;
const CONNECTOR_LABEL = 'text-center text-xs leading-tight text-muted-foreground';

function promoteButtonClass(enabled: boolean) {
  return cn(
    'flex h-10 w-10 items-center justify-center rounded-full border transition-colors sm:h-9 sm:w-9',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    enabled
      ? 'border-primary bg-primary text-primary-foreground shadow-xs hover:bg-primary/90'
      : 'border-border bg-card text-muted-foreground/50',
  );
}

const PROVIDER_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
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
  const production = project.environments.find((environment) => environment.name === 'prod');
  const verifiedBuild =
    project.pipelinePreset === 'prod-only' ? project.latestVerifiedArtifact : null;
  const canRequestVerifiedBuild = Boolean(
    verifiedBuild &&
    !readOnly &&
    busy === null &&
    production?.workspaceAccessStatus !== 'disabled' &&
    !(
      production?.target?.scope === 'user' &&
      (production.target.managementState ?? 'active') !== 'active'
    ),
  );

  const stageCount = project.environments.length + (project.pipelinePreset === 'prod-only' ? 1 : 0);
  const layout = LAYOUT[stageCount >= 3 ? 'three' : 'two'];

  return (
    <div className="[container-type:inline-size]">
      <div className={layout.track}>
        {project.pipelinePreset === 'prod-only' && (
          <>
            <div className={STAGE_CARD}>
              <div className="flex min-h-8 items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('Verified build')}
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <PackageCheck className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 font-mono text-xl font-semibold tracking-tight">
                {verifiedBuild ? `v${verifiedBuild.version.slice(0, 7)}` : '—'}
              </div>
              {verifiedBuild ? (
                <div
                  className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                  title={t('Verified build sha256:{digest}', { digest: verifiedBuild.digest })}
                >
                  {t('build {digest}', { digest: verifiedBuild.digest.slice(0, 12) })}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('Push to the default branch and wait for CI verification.')}
                </p>
              )}
            </div>
            <div className={layout.connector}>
              <button
                type="button"
                disabled={!canRequestVerifiedBuild}
                onClick={() => onPromote('prod')}
                aria-label={t('Request verified build for production')}
                title={
                  canRequestVerifiedBuild
                    ? t('Request this verified build for production')
                    : t('A verified build and available production target are required')
                }
                className={promoteButtonClass(canRequestVerifiedBuild)}
              >
                <ArrowRight className={layout.arrow} />
              </button>
              <span className={CONNECTOR_LABEL}>{t('Request prod')}</span>
            </div>
          </>
        )}
        {project.environments.map((env, index) => {
          const target = project.environments[index + 1];
          const next = target?.name ?? null;
          const synced =
            !!target &&
            !!env.version &&
            target.status === 'running' &&
            target.version === env.version &&
            (env.artifact ? target.artifact?.id === env.artifact.id : !target.artifact);
          const canPromote =
            !readOnly &&
            busy === null &&
            env.status === 'running' &&
            !synced &&
            target?.workspaceAccessStatus !== 'disabled' &&
            !(
              target?.target?.scope === 'user' &&
              (target.target.managementState ?? 'active') !== 'active'
            );
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
            env.status === 'deploying' && env.statusReason === 'Waiting for an available CI runner';
          // Providers publish named deployment stages. Known stages advance the
          // end-to-end bar; a moving highlight communicates activity inside a
          // stage without pretending that elapsed time equals real completion.
          const pct = env.status === 'deploying' ? deploymentProgress(env.statusReason) : null;
          // Stop/Start only makes sense for Docker workloads, not static hosting (SFTP).
          const canStopStart = env.provider !== 'sftp';
          const hasDeployment = env.status !== 'empty' && !!env.version;
          const cleanupPending = env.status === 'empty' && !!env.statusReason;
          const targetNeedsDeploy =
            env.deploymentRequired && ['empty', 'failed'].includes(env.status);
          const targetUnavailable = Boolean(
            env.target?.scope === 'user' && (env.target.managementState ?? 'active') !== 'active',
          );
          const workspaceAccessPaused = env.workspaceAccessStatus === 'disabled';
          const targetAcceptsManagement = !targetUnavailable;
          const targetAcceptsDeployments = targetAcceptsManagement && !workspaceAccessPaused;
          const canDeployToTarget =
            targetAcceptsDeployments && targetNeedsDeploy && (!!env.version || env.name === 'dev');
          const canRunAgain =
            targetAcceptsDeployments &&
            env.name === 'dev' &&
            !env.version &&
            (env.status === 'empty' || env.status === 'failed') &&
            !targetNeedsDeploy;
          // Any environment can be pointed at a different target.
          const canTarget = targetAcceptsManagement || env.status === 'empty';
          const canInspectWorkload =
            targetAcceptsManagement &&
            hasDeployment &&
            env.provider === 'docker' &&
            env.target?.kind === 'docker' &&
            env.target.scope === 'user';
          const expiryWarning = Boolean(
            env.expiresAt &&
            env.expiryWarningAt &&
            Date.now() >= new Date(env.expiryWarningAt).getTime(),
          );

          return (
            <Fragment key={env.name}>
              <div className={STAGE_CARD}>
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {env.name}
                  </h3>
                  <div className="flex items-center gap-1">
                    {env.status !== 'empty' ? (
                      <Link
                        to={deploymentHistoryUrl}
                        title={t('View InitPad deployment history')}
                        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <StatusBadge
                          status={waitingForRunner ? 'pending' : env.status}
                          label={waitingForRunner ? t('queued') : undefined}
                          kind={waitingForRunner ? 'ci' : 'deploy'}
                          className="cursor-pointer hover:bg-foreground/10"
                        />
                      </Link>
                    ) : (
                      <StatusBadge
                        status={waitingForRunner ? 'pending' : env.status}
                        label={waitingForRunner ? t('queued') : undefined}
                        kind={waitingForRunner ? 'ci' : 'deploy'}
                      />
                    )}
                    {!readOnly &&
                      (targetAcceptsManagement ? hasDeployment || canTarget : canTarget) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={busy !== null}
                              aria-label={t('Environment actions')}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {hasFailedGitHubJobs && targetAcceptsDeployments && (
                              <DropdownMenuItem onSelect={onRerunFailedJobs}>
                                <RefreshCw className="h-4 w-4" /> {t('Re-run failed GitHub jobs')}
                              </DropdownMenuItem>
                            )}
                            {canDeployToTarget && (
                              <DropdownMenuItem
                                onSelect={() => (env.version ? onRedeploy(env.name) : onRunAgain())}
                              >
                                <Play className="h-4 w-4" />{' '}
                                {env.version ? t('Deploy verified build') : t('Deploy')}
                              </DropdownMenuItem>
                            )}
                            {canRunAgain && (
                              <DropdownMenuItem onSelect={onRunAgain}>
                                <Play className="h-4 w-4" /> {t('Deploy')}
                              </DropdownMenuItem>
                            )}
                            {hasDeployment && targetAcceptsDeployments && !targetNeedsDeploy && (
                              <DropdownMenuItem onSelect={() => onRedeploy(env.name)}>
                                <RefreshCw className="h-4 w-4" />
                                {env.name === 'prod'
                                  ? t('Request production redeploy')
                                  : t('Redeploy verified build')}
                              </DropdownMenuItem>
                            )}
                            {hasDeployment &&
                              targetAcceptsManagement &&
                              !workspaceAccessPaused &&
                              canRollback &&
                              !targetNeedsDeploy && (
                                <DropdownMenuItem onSelect={() => onRollback(env.name)}>
                                  <Undo2 className="h-4 w-4" />
                                  {env.name === 'prod'
                                    ? t('Request production rollback…')
                                    : t('Roll back to previous version…')}
                                </DropdownMenuItem>
                              )}
                            {canInspectWorkload && (
                              <DropdownMenuItem onSelect={() => onDiagnostics(env.name)}>
                                <Activity className="h-4 w-4" /> {t('Workload diagnostics…')}
                              </DropdownMenuItem>
                            )}
                            {hasDeployment &&
                              targetAcceptsManagement &&
                              canStopStart &&
                              (env.status === 'stopped' ? (
                                <DropdownMenuItem onSelect={() => onStart(env.name)}>
                                  <Play className="h-4 w-4" /> {t('Start')}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => onStop(env.name)}
                                  disabled={env.status !== 'running'}
                                >
                                  <Square className="h-4 w-4" /> {t('Stop')}
                                </DropdownMenuItem>
                              ))}
                            {canTarget && (
                              <DropdownMenuItem onSelect={() => onConfigureTarget(env.name)}>
                                <Server className="h-4 w-4" /> {t('Change target')}
                              </DropdownMenuItem>
                            )}
                            {targetAcceptsManagement &&
                              (hasDeployment || env.status === 'deploying' || cleanupPending) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    destructive
                                    onSelect={() => onRemoveEnv(env.name)}
                                  >
                                    <Trash2 className="h-4 w-4" />{' '}
                                    {env.status === 'deploying'
                                      ? t('Cancel deploy')
                                      : cleanupPending
                                        ? t('Retry cleanup')
                                        : t('Remove deployment')}
                                  </DropdownMenuItem>
                                </>
                              )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                  </div>
                </div>

                <div className="mt-2 flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-xl font-semibold tracking-tight">
                    {env.version ? `v${env.version.slice(0, 7)}` : '—'}
                  </span>
                  {env.artifact && (
                    <span
                      className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                      title={t('Verified build sha256:{digest}', { digest: env.artifact.digest })}
                    >
                      {t('build {digest}', { digest: env.artifact.digest.slice(0, 12) })}
                    </span>
                  )}
                </div>
                {deployedCommit ? (
                  <div
                    className="mt-1 truncate text-sm text-muted-foreground"
                    title={deployedCommit.message}
                  >
                    {deployedCommit.message}
                  </div>
                ) : (
                  !env.version && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t('Nothing deployed yet')}
                    </div>
                  )
                )}

                <div className="mt-3 space-y-1.5 border-t border-border/70 pt-3 text-xs">
                  <div
                    className="flex min-w-0 items-center gap-1.5 text-muted-foreground"
                    title={env.target?.host ?? env.target?.name ?? env.provider}
                  >
                    <ProviderIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{env.target?.name ?? env.provider}</span>
                    {env.target?.scope === 'user' && (
                      <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 text-[11px] font-medium leading-4">
                        {t('yours')}
                      </span>
                    )}
                  </div>
                  {env.url && (
                    <a
                      href={env.url}
                      target="_blank"
                      rel="noreferrer"
                      title={env.url}
                      className="text-link flex min-w-0 items-center gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{env.url.replace(/^https?:\/\//, '')}</span>
                    </a>
                  )}
                </div>

                {targetUnavailable && (
                  <div
                    className={cn(
                      STAGE_NOTE,
                      'border-warning/30 bg-warning/[0.08] text-muted-foreground',
                    )}
                  >
                    <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span className="min-w-0">
                      {rich(
                        'Server is {state}. The URL may remain online, but InitPad management is unavailable. <link>Reconnect server</link>.',
                        {
                          state: statusLabel(env.target!.managementState ?? 'disconnected'),
                          link: (chunk) => (
                            <Link to="/infrastructure" className="text-link font-medium">
                              {chunk}
                            </Link>
                          ),
                        },
                      )}
                    </span>
                  </div>
                )}

                {workspaceAccessPaused && (
                  <div
                    className={cn(
                      STAGE_NOTE,
                      'border-warning/30 bg-warning/[0.08] text-foreground',
                    )}
                  >
                    <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span className="min-w-0">
                      {rich(
                        'Workspace access is paused. Existing workloads remain manageable, but deploy, redeploy and rollback are unavailable. <link>Manage access</link>.',
                        {
                          link: (chunk) => (
                            <Link to="/infrastructure" className="text-link font-medium">
                              {chunk}
                            </Link>
                          ),
                        },
                      )}
                    </span>
                  </div>
                )}

                {targetNeedsDeploy && (
                  <div
                    className={cn(
                      'mt-3 flex items-start gap-1.5 text-xs',
                      workspaceAccessPaused ? 'text-warning' : 'text-primary',
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {workspaceAccessPaused
                        ? t('Target change pending — resume workspace access before deploying.')
                        : t('Target changed — deploy to apply it.')}
                    </span>
                  </div>
                )}

                {env.status === 'deploying' && (
                  <div className="mt-3">
                    <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {waitingForRunner ? (
                        <Clock3 className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Spinner className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate">
                        {env.statusReason ?? t('Deploying…')}
                        {pct !== null ? ` · ${pct}%` : ''}
                      </span>
                    </div>
                    {!waitingForRunner && (
                      <div
                        role="progressbar"
                        aria-label={t('{name} deployment progress', { name: env.name })}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct ?? undefined}
                        aria-valuetext={env.statusReason ?? t('Deploying')}
                        className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]"
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

                {env.status === 'failed' &&
                  env.statusReason &&
                  !(
                    workspaceAccessPaused && /workspace access.+paused/i.test(env.statusReason)
                  ) && (
                    <Link
                      to={deploymentHistoryUrl}
                      className="mt-3 flex min-w-0 items-start gap-1.5 rounded-sm text-left text-xs text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{env.statusReason}</span>
                      <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    </Link>
                  )}

                {env.expiresAt && (
                  <div
                    className={cn(
                      'mt-3 flex items-start gap-1.5 text-xs',
                      expiryWarning ? 'text-warning' : 'text-muted-foreground',
                    )}
                  >
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {t('Scheduled cleanup {date}. Redeploy to renew.', {
                        date: formatDateTime(env.expiresAt),
                      })}
                    </span>
                  </div>
                )}

                {cleanupPending && (
                  <div className="mt-3 flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 break-words">{cleanupNotice(env.statusReason!)}</span>
                  </div>
                )}
              </div>

              {next && (
                <div className={layout.connector}>
                  {synced ? (
                    <>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10 text-success sm:h-9 sm:w-9">
                        <Check className="h-4 w-4" />
                      </span>
                      <span className={CONNECTOR_LABEL}>{t('in sync')}</span>
                    </>
                  ) : deploying ? (
                    <>
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning sm:h-9 sm:w-9">
                        <Spinner className="h-4 w-4" />
                      </span>
                      <span className={CONNECTOR_LABEL}>{t('deploying…')}</span>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!canPromote}
                        onClick={() => onPromote(next)}
                        title={
                          canPromote
                            ? next === 'prod'
                              ? t('Request v{version} from {name} for production', {
                                  version: env.version ?? '',
                                  name: env.name,
                                })
                              : t('Deploy v{version} from {name} to {next}', {
                                  version: env.version ?? '',
                                  name: env.name,
                                  next: next,
                                })
                            : target?.workspaceAccessStatus === 'disabled'
                              ? t('Resume workspace access before deploying to {next}', {
                                  next: next,
                                })
                              : target?.target?.scope === 'user' &&
                                  (target.target.managementState ?? 'active') !== 'active'
                                ? t('Reconnect the {next} server before deploying', { next: next })
                                : t('Deploy to {name} first', { name: env.name })
                        }
                        className={promoteButtonClass(canPromote)}
                      >
                        <ArrowRight className={layout.arrow} />
                      </button>
                      <span className={CONNECTOR_LABEL}>
                        {canPromote
                          ? next === 'prod'
                            ? t('Request prod')
                            : t('Deploy to {next}', { next: next })
                          : next}
                      </span>
                    </>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
