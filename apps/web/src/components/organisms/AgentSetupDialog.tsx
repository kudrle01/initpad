import { useEffect, useState } from 'react';
import { Bot, Download, ExternalLink, ShieldAlert, Sparkles, WifiOff } from 'lucide-react';
import type {
  AgentDistribution,
  AgentEnrollment,
  AgentJobSummary,
  AgentStatus,
  AgentUpdateStatus,
  Target,
} from '@/types';
import { api } from '@/api';
import { CopyField } from '@/components/molecules/CopyField';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Spinner } from '@/components/atoms/Spinner';
import { AgentDiagnosticsPanel } from '@/components/organisms/agent-setup/AgentDiagnosticsPanel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirmation } from '@/confirmation';
import { t, msg, rich, formatDateTime, formatTime, type MessageKey } from '@/i18n';

interface Props {
  open: boolean;
  target: Target | null;
  agent: AgentStatus | null;
  jobs: AgentJobSummary[];
  protocolError: string | null;
  testBusy: 'protocol' | 'lifecycle' | 'gateway' | 'update' | null;
  busy: boolean;
  enrollment: AgentEnrollment | null;
  onOpenChange: (open: boolean) => void;
  onIssueEnrollment: () => void;
  onDisable: () => void;
  onTestProtocol: () => void;
  onTestLifecycle: () => void;
  onTestGateway: () => void;
  onUpdateAgent: () => void;
}

const STATE_LABEL: Record<string, MessageKey> = {
  'not-enrolled': msg('not enrolled'),
  offline: msg('offline'),
  online: msg('online'),
  disabled: msg('disabled'),
};

function formatMemory(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes >= 10 ? gibibytes.toFixed(0) : gibibytes.toFixed(1)} GiB`;
}

function compareStableVersions(left: string, right: string): number | null {
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const leftMatch = left.match(stableVersion);
  const rightMatch = right.match(stableVersion);
  if (!leftMatch || !rightMatch) return null;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftMatch[index]) - Number(rightMatch[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function AgentSetupDialog({
  open,
  target,
  agent,
  jobs,
  protocolError,
  testBusy,
  busy,
  enrollment,
  onOpenChange,
  onIssueEnrollment,
  onDisable,
  onTestProtocol,
  onTestLifecycle,
  onTestGateway,
  onUpdateAgent,
}: Props) {
  const confirmAction = useConfirmation();
  const [distribution, setDistribution] = useState<AgentDistribution | null>(null);
  const [distributionError, setDistributionError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AgentUpdateStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setDistributionError(null);
    void Promise.allSettled([
      api.getAgentDistribution(),
      api.getAgentUpdateStatus(target?.id ?? ''),
    ]).then(([releaseResult, updateResult]) => {
      if (!current) return;
      if (releaseResult.status === 'fulfilled') setDistribution(releaseResult.value);
      else {
        setDistributionError(
          releaseResult.reason instanceof Error
            ? releaseResult.reason.message
            : t('Agent release information is unavailable'),
        );
      }
      if (updateResult.status === 'fulfilled') {
        setUpdateStatus(updateResult.value);
      }
    });
    return () => {
      current = false;
    };
  }, [agent?.version, open, target?.id]);

  if (!target) return null;
  const currentTarget = target;
  const state = agent?.state ?? 'not-enrolled';
  const canQueueProbe = state === 'online' || state === 'offline';
  const canUpdateExistingAgent = Boolean(
    agent && agent.credentialGeneration > 0 && (state === 'online' || state === 'offline'),
  );
  const insecureFlag = window.location.protocol === 'http:' ? ' --allow-insecure-http' : '';
  const installerUrl = distribution?.available
    ? new URL(distribution.installer.path, window.location.origin).toString()
    : null;
  const catalogReleaseIsNewest = Boolean(
    updateStatus?.latestVersion &&
    updateStatus.image &&
    (!distribution?.version ||
      (compareStableVersions(updateStatus.latestVersion, distribution.version) ?? -1) >= 0),
  );
  const desiredAgentVersion = catalogReleaseIsNewest
    ? updateStatus?.latestVersion
    : (distribution?.version ?? null);
  const desiredImage = catalogReleaseIsNewest ? updateStatus?.image : (distribution?.image ?? null);
  const desiredComparedWithRunning =
    desiredAgentVersion && agent?.version
      ? compareStableVersions(desiredAgentVersion, agent.version)
      : null;
  const wouldDowngradeAgent = desiredComparedWithRunning !== null && desiredComparedWithRunning < 0;
  const installCommand =
    distribution?.available && desiredImage && installerUrl && !wouldDowngradeAgent
      ? `curl -fsSLo initpad-agent-install.sh '${installerUrl}' && printf '%s  %s\\n' '${distribution.installer.sha256}' initpad-agent-install.sh | sha256sum -c - && sudo sh ./initpad-agent-install.sh --url '${window.location.origin}' --image '${desiredImage}' --expected-target-id '${currentTarget.id}'${insecureFlag}`
      : null;
  const reEnrollCommand = installCommand ? `${installCommand} --re-enroll` : null;
  const isCurrentOnline = Boolean(
    state === 'online' &&
    agent?.version &&
    ((updateStatus?.latestVersion && !updateStatus.updateAvailable) ||
      (!updateStatus?.latestVersion &&
        desiredComparedWithRunning !== null &&
        desiredComparedWithRunning <= 0)),
  );
  const hasRemoteUpdateOnline = Boolean(
    state === 'online' && updateStatus?.updateAvailable && updateStatus.updateMethod === 'remote',
  );
  const hasManualUpdateOnline = Boolean(
    state === 'online' && updateStatus?.updateAvailable && updateStatus.updateMethod === 'manual',
  );
  const hasFallbackManualUpdateOnline = Boolean(
    state === 'online' &&
    !updateStatus?.latestVersion &&
    desiredComparedWithRunning !== null &&
    desiredComparedWithRunning > 0,
  );
  const showManualInstaller = Boolean(
    canUpdateExistingAgent &&
    (state === 'offline' || hasManualUpdateOnline || hasFallbackManualUpdateOnline),
  );

  async function issueEnrollment() {
    if (enrollment || agent?.enrollmentPending) {
      const confirmed = await confirmAction({
        title: t('Replace the pending enrollment token?'),
        description: t('Only one unused enrollment token can be valid for this target.'),
        confirmLabel: t('Generate a new token'),
        tone: 'warning',
        consequences: [
          t('The previously generated token stops working immediately.'),
          t('A currently enrolled Agent remains connected until the new token is redeemed.'),
        ],
      });
      if (!confirmed) return;
    }
    onIssueEnrollment();
  }

  async function disableAgent() {
    const confirmed = await confirmAction({
      title: t('Disconnect the Agent for {name}?', { name: currentTarget.name }),
      description: t(
        'This revokes the server identity used to receive work from InitPad without stopping its workloads.',
      ),
      confirmLabel: t('Disconnect Agent'),
      tone: 'danger',
      consequences: [
        t('Queued work is cancelled and the server cannot receive further jobs.'),
        t('Running applications stay untouched.'),
        t('Restoring the connection requires a new enrollment.'),
      ],
    });
    if (confirmed) onDisable();
  }

  async function updateAgent() {
    const nextVersion = updateStatus?.latestVersion;
    if (!nextVersion) return;
    const confirmed = await confirmAction({
      title: t('Install Agent {nextVersion}?', { nextVersion: nextVersion }),
      description: t(
        'InitPad will send the signed release manifest to this Agent and replace only the Agent container.',
      ),
      confirmLabel: t('Install update'),
      tone: 'warning',
      consequences: [
        t('Application workloads keep running while the Agent restarts.'),
        t('New jobs wait briefly until the updated Agent reconnects.'),
        t(
          'If the new Agent cannot authenticate, the previous container is restored automatically.',
        ),
      ],
    });
    if (confirmed) onUpdateAgent();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <Bot className="h-[18px] w-[18px]" /> {t('InitPad Agent')}
          </DialogTitle>
          <DialogDescription>
            {t(
              '{name} connects outbound to this control plane. InitPad never needs inbound SSH access or a public management port on the Docker server.',
              { name: target.name },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('Agent status')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {agent?.version
                  ? t('Version {version} · protocol {protocolVersion}', {
                      version: agent.version,
                      protocolVersion: agent.protocolVersion,
                    })
                  : t('No Agent heartbeat received yet')}
              </p>
              {agent?.credentialGeneration ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {agent.credentialActivatedAt
                    ? t('Credential generation {generation} · active since {date}', {
                        generation: agent.credentialGeneration,
                        date: formatDateTime(agent.credentialActivatedAt),
                      })
                    : t('Credential generation {generation}', {
                        generation: agent.credentialGeneration,
                      })}
                </p>
              ) : null}
            </div>
            <StatusBadge
              status={state}
              label={t(STATE_LABEL[state])}
              className={state === 'offline' ? 'bg-warning/10 text-warning' : undefined}
            />
          </div>

          {state === 'offline' && (
            <div
              className="tint-warning flex items-start gap-3 rounded-lg border border-warning/30 p-4"
              role="status"
              aria-live="polite"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <WifiOff className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{t('Agent is offline')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    'The control plane has not received a heartbeat for more than 90 seconds. Jobs remain safely queued and continue automatically after the Agent reconnects.',
                  )}
                </p>
                {agent?.lastSeenAt && (
                  <p className="mt-2 text-xs font-medium text-foreground">
                    {t('Last contact: {date}', {
                      date: formatDateTime(agent.lastSeenAt),
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {agent?.credentialRotationPending && (
            <div
              className="tint-warning flex items-start gap-2 rounded-lg border border-warning/30 p-3 text-sm"
              role="status"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                {t(
                  'Credential rotation is waiting for Agent confirmation. The current credential remains valid, so reconnecting the Agent is safe.',
                )}
              </p>
            </div>
          )}

          {updateStatus?.updateAvailable && (
            <div
              className="flex items-start gap-3 rounded-lg border border-primary/30 bg-secondary/60 p-4"
              role="status"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {t('Agent {latestVersion} is available', {
                    latestVersion: updateStatus.latestVersion ?? '',
                  })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {updateStatus.updateMethod === 'manual'
                    ? t(
                        'This is the final manual, identity-preserving update. Agent 0.13 and newer can install later verified releases remotely.',
                      )
                    : t(
                        'The release manifest and immutable image identity were verified. Installation still requires your confirmation.',
                      )}
                </p>
                {updateStatus.channel === 'candidate' && (
                  <p className="mt-2 text-xs font-medium text-warning">
                    {t('Candidate update channel · use only on an acceptance server.')}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {updateStatus.updateMethod === 'remote' && (
                    <Button
                      size="sm"
                      disabled={busy || testBusy !== null || state !== 'online'}
                      title={
                        state === 'online'
                          ? t('Install the verified update on this Agent')
                          : t('The Agent must be online before it can update itself')
                      }
                      onClick={() => void updateAgent()}
                    >
                      {testBusy === 'update' ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {t('Install update')}
                    </Button>
                  )}
                  {updateStatus.releaseUrl && (
                    <a
                      className="text-link inline-flex items-center gap-1 font-medium"
                      href={updateStatus.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('Release details')} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {updateStatus.stale && (
                    <span className="text-warning">{t('Showing the last verified check')}</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {updateStatus?.error && !updateStatus.releaseUrl && (
            <p className="tint-warning rounded-lg border border-warning/30 p-2.5 text-xs text-muted-foreground">
              {t('{error} Agent management remains available.', { error: updateStatus.error })}
            </p>
          )}

          {agent?.capabilities && (
            <div className="grid gap-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground sm:grid-cols-2">
              <span>
                {t('Docker {engineVersion} · API {apiVersion}', {
                  engineVersion: agent.capabilities.engineVersion,
                  apiVersion: agent.capabilities.apiVersion,
                })}
              </span>
              <span className="sm:text-right">
                {agent.capabilities.os}/{agent.capabilities.arch}
                {agent.capabilities.rootless ? ` · ${t('rootless')}` : ''}
              </span>
              <span className="sm:col-span-2">
                {t('{cpus} CPU · {memoryBytes} available to Docker', {
                  cpus: agent.capabilities.cpus,
                  memoryBytes: formatMemory(agent.capabilities.memoryBytes),
                })}
              </span>
            </div>
          )}

          {enrollment ? (
            <div className="tint-warning flex min-w-0 flex-col gap-3 rounded-lg border border-warning/30 p-3">
              <div className="flex items-start gap-2 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  {rich(
                    'This token is shown once and expires at <b>{date}</b>. Closing this dialog discards the plaintext.',
                    {
                      date: formatTime(enrollment.enrollmentExpiresAt!),
                      b: (chunk) => <b className="font-medium">{chunk}</b>,
                    },
                  )}
                </p>
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 eyebrow">{t('Enrollment token')}</p>
                <CopyField command={enrollment.enrollmentToken} />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="eyebrow">
                    {installCommand
                      ? t('Install and enroll on the Docker server')
                      : t('Agent installer')}
                  </p>
                  {installCommand && installerUrl && (
                    <Button asChild variant="ghost" size="sm">
                      <a
                        href={installerUrl}
                        download="initpad-agent-install.sh"
                        title={t('Downloads the script without running it')}
                      >
                        <Download className="h-3.5 w-3.5" /> {t('Download script only')}
                      </a>
                    </Button>
                  )}
                </div>
                {installCommand ? (
                  <>
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      {t(
                        'Copy and run this command in an interactive terminal on the Docker server.',
                      )}
                    </p>
                    <CopyField command={installCommand} />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t(
                        'It verifies the checksum and immutable Agent {version} image, verifies that any saved identity belongs to this target, then starts and health-checks the Agent. A new server requests the token through a hidden prompt, so it never enters shell history.',
                        { version: distribution?.version ?? '' },
                      )}
                    </p>
                    {reEnrollCommand && (
                      <details className="mt-2 rounded-lg bg-muted p-2.5 text-xs">
                        <summary className="cursor-pointer font-medium text-foreground">
                          {t('Replace an invalid existing identity')}
                        </summary>
                        <p className="mb-2 mt-1.5 text-muted-foreground">
                          {t(
                            'Use this only if verification says the saved credential was rejected, or when reconnecting a server from a deleted or restored target. It replaces the old identity using the enrollment token above.',
                          )}
                        </p>
                        <CopyField command={reEnrollCommand} />
                      </details>
                    )}
                    {window.location.protocol === 'http:' && (
                      <p className="mt-2 tint-warning flex items-start gap-1.5 rounded-lg border border-warning/30 p-2.5 text-xs text-foreground">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        {t(
                          'HTTP enrollment is for a trusted local test only. Use HTTPS before exposing InitPad or this Agent connection outside an isolated network.',
                        )}
                      </p>
                    )}
                  </>
                ) : (
                  <div
                    className="tint-warning flex items-start gap-2 rounded-lg border border-warning/30 p-3 text-sm"
                    role="status"
                  >
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {distribution || distributionError
                          ? t('Agent installer is not configured')
                          : t('Loading Agent release information…')}
                      </p>
                      {(distribution || distributionError) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {rich(
                            '{reason}. Ask the instance administrator to run <install>deploy/install.sh</install>. Source-build lab users can enroll with <enroll>deploy/agent-lab.sh enroll</enroll>.',
                            {
                              reason: distribution?.unavailableReason ?? distributionError,
                              install: (chunk) => <code>{chunk}</code>,
                              enroll: (chunk) => <code>{chunk}</code>,
                            },
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {currentTarget.routingMode === 'managed-gateway' && installCommand && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t(
                      'Managed gateway installations also need the target-local Caddy socket, gateway container and optional private CA flags shown by the installer help.',
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : isCurrentOnline ? (
            <div className="tint-success rounded-lg border border-success/25 p-3">
              <p className="text-sm font-medium">
                {t('Agent {version} is current', { version: agent?.version ?? '' })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('Connected to this target and ready to receive jobs. No action is required.')}
              </p>
            </div>
          ) : hasRemoteUpdateOnline ? null : showManualInstaller ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {state === 'offline'
                      ? agent?.version
                        ? t('Reconnect Agent {version}', { version: agent.version })
                        : t('Reconnect Agent')
                      : desiredAgentVersion
                        ? t('Update Agent to {version}', { version: desiredAgentVersion })
                        : t('Update Agent')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {state === 'offline'
                      ? t(
                          'Run the verified installer on the Docker server to restore this connection while preserving its identity.',
                        )
                      : t(
                          'The existing server identity is verified and preserved. No new enrollment token is required.',
                        )}
                  </p>
                </div>
                {installCommand && installerUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={installerUrl}
                      download="initpad-agent-install.sh"
                      title={t('Downloads the script without running it')}
                    >
                      <Download className="h-3.5 w-3.5" /> {t('Download script only')}
                    </a>
                  </Button>
                )}
              </div>
              {installCommand ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'Copy and run this command in an interactive terminal on the Docker server.',
                    )}
                  </p>
                  <CopyField command={installCommand} />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'The installer verifies the checksum, immutable image, target binding and saved credential before replacing the running container. If the new Agent cannot heartbeat, it restores the previous container.',
                    )}
                  </p>
                  {window.location.protocol === 'http:' && (
                    <p className="tint-warning flex items-start gap-1.5 rounded-lg border border-warning/30 p-2.5 text-xs text-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      {t(
                        'HTTP is suitable only for a trusted local test network. Use HTTPS in production.',
                      )}
                    </p>
                  )}
                </>
              ) : (
                <div
                  className="tint-warning flex items-start gap-2 rounded-lg border border-warning/30 p-3 text-sm"
                  role="status"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {wouldDowngradeAgent
                        ? t('A safe reconnect image is not available')
                        : distribution || distributionError
                          ? t('Agent installer is not configured')
                          : t('Loading Agent release information…')}
                    </p>
                    {wouldDowngradeAgent ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {rich(
                          'The configured release is older than Agent {version}. Restart the existing <code>initpad-agent</code> container or ask the instance administrator to publish the current release; InitPad will not downgrade this server.',
                          { version: agent?.version, code: (chunk) => <code>{chunk}</code> },
                        )}
                      </p>
                    ) : (
                      (distribution || distributionError) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(
                            '{reason}. Ask the instance administrator to update the reviewed Agent release.',
                            { reason: distribution?.unavailableReason ?? distributionError ?? '' },
                          )}
                        </p>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              {t(
                'Generate a short-lived, single-use enrollment when you are ready at the Docker server. A new enrollment does not disconnect the current Agent until it is redeemed.',
              )}
            </div>
          )}

          {agent?.lastSeenAt && state !== 'offline' && (
            <p className="text-xs text-muted-foreground">
              {t('Last contact: {date}', { date: formatDateTime(agent.lastSeenAt) })}
            </p>
          )}

          <AgentDiagnosticsPanel
            target={target}
            jobs={jobs}
            protocolError={protocolError}
            testBusy={testBusy}
            busy={busy}
            canQueueProbe={canQueueProbe}
            onTestProtocol={onTestProtocol}
            onTestLifecycle={onTestLifecycle}
            onTestGateway={onTestGateway}
          />
        </div>

        <DialogFooter>
          {agent && agent.state !== 'disabled' && agent.state !== 'not-enrolled' && (
            <Button variant="ghost" disabled={busy} onClick={() => void disableAgent()}>
              {t('Disconnect Agent')}
            </Button>
          )}
          <Button disabled={busy} onClick={() => void issueEnrollment()}>
            {busy && <Spinner className="h-4 w-4" />}
            {enrollment || agent?.enrollmentPending
              ? t('Generate a new token')
              : t('Generate enrollment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
