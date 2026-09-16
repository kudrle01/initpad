import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Container,
  Download,
  ExternalLink,
  Globe2,
  ShieldAlert,
  Sparkles,
  WifiOff,
} from 'lucide-react';
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
import { InfoTip } from '@/components/molecules/InfoTip';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Spinner } from '@/components/atoms/Spinner';
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

const STATE_LABEL: Record<string, string> = {
  'not-enrolled': 'not enrolled',
  offline: 'offline',
  online: 'online',
  disabled: 'disabled',
};

function hasExpiredLease(job: AgentJobSummary, now = Date.now()): boolean {
  return (
    job.status === 'leased' &&
    job.leaseExpiresAt !== null &&
    new Date(job.leaseExpiresAt).getTime() <= now
  );
}

function agentJobMessage(job: AgentJobSummary, leaseExpired: boolean): string {
  if (leaseExpired) {
    return 'Lease expired. Waiting for the Agent to reconnect and retry automatically.';
  }
  if (
    job.kind === 'lifecycle-test' &&
    job.status === 'failed' &&
    job.progressPercent <= 8 &&
    job.message === 'Docker API timed out'
  ) {
    return 'The diagnostic image pull timed out. Docker may have cached partial layers; verify registry access and run Test Docker again.';
  }
  return job.message ?? job.progressStage;
}

function formatMemory(bytes: number): string {
  const gibibytes = bytes / 1024 ** 3;
  return `${gibibytes >= 10 ? gibibytes.toFixed(0) : gibibytes.toFixed(1)} GiB`;
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
            : 'Agent release information is unavailable',
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
  const publishedHost =
    currentTarget.routingMode === 'direct-port' && currentTarget.publicUrl
      ? new URL(currentTarget.publicUrl).hostname
      : null;
  const desiredImage =
    updateStatus?.updateAvailable && updateStatus.image ? updateStatus.image : distribution?.image;
  const installCommand =
    distribution?.available && desiredImage && installerUrl
      ? `curl -fsSLo initpad-agent-install.sh '${installerUrl}' && printf '%s  %s\\n' '${distribution.installer.sha256}' initpad-agent-install.sh | sha256sum -c - && sudo sh ./initpad-agent-install.sh --url '${window.location.origin}' --image '${desiredImage}'${publishedHost ? ` --published-host '${publishedHost}'` : ''}${insecureFlag}`
      : null;
  const reEnrollCommand = installCommand ? `${installCommand} --re-enroll` : null;
  const desiredAgentVersion = updateStatus?.updateAvailable
    ? updateStatus.latestVersion
    : (distribution?.version ?? null);

  async function issueEnrollment() {
    if (enrollment || agent?.enrollmentPending) {
      const confirmed = await confirmAction({
        title: 'Replace the pending enrollment token?',
        description: 'Only one unused enrollment token can be valid for this target.',
        confirmLabel: 'Generate a new token',
        tone: 'warning',
        consequences: [
          'The previously generated token stops working immediately.',
          'A currently enrolled Agent remains connected until the new token is redeemed.',
        ],
      });
      if (!confirmed) return;
    }
    onIssueEnrollment();
  }

  async function disableAgent() {
    const confirmed = await confirmAction({
      title: `Disconnect the Agent for ${currentTarget.name}?`,
      description:
        'This revokes the server identity used to receive work from InitPad without stopping its workloads.',
      confirmLabel: 'Disconnect Agent',
      tone: 'danger',
      consequences: [
        'Queued work is cancelled and the server cannot receive further jobs.',
        'Running applications stay untouched.',
        'Restoring the connection requires a new enrollment.',
      ],
    });
    if (confirmed) onDisable();
  }

  async function updateAgent() {
    const nextVersion = updateStatus?.latestVersion;
    if (!nextVersion) return;
    const confirmed = await confirmAction({
      title: `Install Agent ${nextVersion}?`,
      description:
        'InitPad will send the signed release manifest to this Agent and replace only the Agent container.',
      confirmLabel: 'Install update',
      tone: 'warning',
      consequences: [
        'Application workloads keep running while the Agent restarts.',
        'New jobs wait briefly until the updated Agent reconnects.',
        'If the new Agent cannot authenticate, the previous container is restored automatically.',
      ],
    });
    if (confirmed) onUpdateAgent();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <Bot className="h-[18px] w-[18px]" /> InitPad Agent
          </DialogTitle>
          <DialogDescription>
            {target.name} connects outbound to this control plane. InitPad never needs inbound SSH
            access or a public management port on the Docker server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Agent status</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {agent?.version
                  ? `Version ${agent.version} · protocol ${agent.protocolVersion}`
                  : 'No Agent heartbeat received yet'}
              </p>
              {agent?.credentialGeneration ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Credential generation {agent.credentialGeneration}
                  {agent.credentialActivatedAt
                    ? ` · active since ${new Date(agent.credentialActivatedAt).toLocaleString()}`
                    : ''}
                </p>
              ) : null}
            </div>
            <StatusBadge
              status={state}
              label={STATE_LABEL[state]}
              className={
                state === 'offline' ? 'border-warning/50 bg-warning/10 text-foreground' : undefined
              }
            />
          </div>

          {state === 'offline' && (
            <div
              className="flex items-start gap-3 rounded-lg border border-warning/60 bg-warning/10 p-4"
              role="status"
              aria-live="polite"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <WifiOff className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Agent is offline</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The control plane has not received a heartbeat for more than 90 seconds. Jobs
                  remain safely queued and continue automatically after the Agent reconnects.
                </p>
                {agent?.lastSeenAt && (
                  <p className="mt-2 text-xs font-medium text-foreground">
                    Last contact: {new Date(agent.lastSeenAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {agent?.credentialRotationPending && (
            <div
              className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm"
              role="status"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p>
                Credential rotation is waiting for Agent confirmation. The current credential
                remains valid, so reconnecting the Agent is safe.
              </p>
            </div>
          )}

          {updateStatus?.updateAvailable && (
            <div
              className="flex items-start gap-3 rounded-lg border border-primary/35 bg-primary/5 p-4"
              role="status"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  Agent {updateStatus.latestVersion} is available
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {updateStatus.updateMethod === 'manual'
                    ? 'This is the final manual, identity-preserving update. Agent 0.13 and newer can install later verified releases remotely.'
                    : 'The release manifest and immutable image identity were verified. Installation still requires your confirmation.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {updateStatus.updateMethod === 'remote' && (
                    <Button
                      size="sm"
                      disabled={busy || testBusy !== null || state !== 'online'}
                      title={
                        state === 'online'
                          ? 'Install the verified update on this Agent'
                          : 'The Agent must be online before it can update itself'
                      }
                      onClick={() => void updateAgent()}
                    >
                      {testBusy === 'update' ? <Spinner className="h-4 w-4" /> : <Sparkles />}
                      Install update
                    </Button>
                  )}
                  {updateStatus.releaseUrl && (
                    <a
                      className="app-link"
                      href={updateStatus.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Release details <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {updateStatus.stale && (
                    <span className="text-warning">Showing the last verified check</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {updateStatus?.error && !updateStatus.releaseUrl && (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-muted-foreground">
              {updateStatus.error} Agent management remains available.
            </p>
          )}

          {agent?.capabilities && (
            <div className="grid gap-1 rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground sm:grid-cols-2">
              <span>
                Docker {agent.capabilities.engineVersion} · API {agent.capabilities.apiVersion}
              </span>
              <span className="sm:text-right">
                {agent.capabilities.os}/{agent.capabilities.arch}
                {agent.capabilities.rootless ? ' · rootless' : ''}
              </span>
              <span className="sm:col-span-2">
                {agent.capabilities.cpus} CPU · {formatMemory(agent.capabilities.memoryBytes)}{' '}
                available to Docker
              </span>
            </div>
          )}

          {enrollment ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <div className="flex items-start gap-2 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  This token is shown once and expires at{' '}
                  <b className="font-medium">
                    {new Date(enrollment.enrollmentExpiresAt!).toLocaleTimeString()}
                  </b>
                  . Closing this dialog discards the plaintext.
                </p>
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Enrollment token
                </p>
                <CopyField command={enrollment.enrollmentToken} />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {installCommand ? 'Install and enroll on the Docker server' : 'Agent installer'}
                  </p>
                  {installCommand && installerUrl && (
                    <Button asChild variant="ghost" size="sm">
                      <a
                        href={installerUrl}
                        download="initpad-agent-install.sh"
                        title="Downloads the script without running it"
                      >
                        <Download className="h-3.5 w-3.5" /> Download script only
                      </a>
                    </Button>
                  )}
                </div>
                {installCommand ? (
                  <>
                    <p className="mb-1.5 text-xs text-muted-foreground">
                      Copy and run this command in an interactive terminal on the Docker server.
                    </p>
                    <CopyField command={installCommand} />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      It verifies the checksum and immutable Agent {distribution?.version} image,
                      verifies any saved identity, then starts and health-checks the Agent. A new
                      server requests the token through a hidden prompt, so it never enters shell
                      history.
                    </p>
                    {reEnrollCommand && (
                      <details className="mt-2 rounded-md border border-border bg-secondary/20 p-2.5 text-xs">
                        <summary className="cursor-pointer font-medium text-foreground">
                          Replace an invalid existing identity
                        </summary>
                        <p className="mb-2 mt-1.5 text-muted-foreground">
                          Use this only if verification says the saved credential was rejected, or
                          when reconnecting a server from a deleted or restored target. It replaces
                          the old identity using the enrollment token above.
                        </p>
                        <CopyField command={reEnrollCommand} />
                      </details>
                    )}
                    {window.location.protocol === 'http:' && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-foreground">
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        HTTP enrollment is for a trusted local test only. Use HTTPS before exposing
                        InitPad or this Agent connection outside an isolated network.
                      </p>
                    )}
                  </>
                ) : (
                  <div
                    className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
                    role="status"
                  >
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {distribution || distributionError
                          ? 'Agent installer is not configured'
                          : 'Loading Agent release information…'}
                      </p>
                      {(distribution || distributionError) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {distribution?.unavailableReason ?? distributionError}. Ask the instance
                          administrator to run <code>deploy/install.sh</code>. Source-build lab
                          users can enroll with <code>deploy/agent-lab.sh enroll</code>.
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {currentTarget.routingMode === 'managed-gateway' && installCommand && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Managed gateway installations also need the target-local Caddy socket, gateway
                    container and optional private CA flags shown by the installer help.
                  </p>
                )}
              </div>
            </div>
          ) : canUpdateExistingAgent ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-secondary/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {installCommand && desiredAgentVersion && agent?.version === desiredAgentVersion
                      ? `Agent ${desiredAgentVersion} matches this instance's reviewed release`
                      : `Update Agent${desiredAgentVersion ? ` to ${desiredAgentVersion}` : ''}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The existing server identity is verified and preserved. No new enrollment token
                    is required.
                  </p>
                </div>
                {installCommand && installerUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={installerUrl}
                      download="initpad-agent-install.sh"
                      title="Downloads the script without running it"
                    >
                      <Download className="h-3.5 w-3.5" /> Download script only
                    </a>
                  </Button>
                )}
              </div>
              {installCommand ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Copy and run this command in an interactive terminal on the Docker server.
                  </p>
                  <CopyField command={installCommand} />
                  <p className="text-xs text-muted-foreground">
                    The installer verifies the checksum, immutable image and saved credential before
                    replacing the running container. If the new Agent cannot heartbeat, it restores
                    the previous container.
                  </p>
                  {window.location.protocol === 'http:' && (
                    <p className="flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      HTTP is suitable only for a trusted local test network. Use HTTPS in
                      production.
                    </p>
                  )}
                </>
              ) : (
                <div
                  className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
                  role="status"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {distribution || distributionError
                        ? 'Agent installer is not configured'
                        : 'Loading Agent release information…'}
                    </p>
                    {(distribution || distributionError) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {distribution?.unavailableReason ?? distributionError}. Ask the instance
                        administrator to update the reviewed Agent release.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">
              Generate a short-lived, single-use enrollment when you are ready at the Docker server.
              A new enrollment does not disconnect the current Agent until it is redeemed.
            </div>
          )}

          {agent?.lastSeenAt && state !== 'offline' && (
            <p className="text-xs text-muted-foreground">
              Last contact: {new Date(agent.lastSeenAt).toLocaleString()}
            </p>
          )}

          <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Activity className="h-4 w-4 text-primary" /> Durable job protocol
                  </p>
                  <InfoTip
                    label="About the Agent protocol test"
                    items={[
                      {
                        title: 'Checks',
                        description:
                          'Claim, progress reporting, lease renewal and completion over 35 seconds.',
                      },
                      {
                        title: 'Impact',
                        description:
                          'Does not run a shell command or create a workload. Offline jobs wait safely in the queue.',
                      },
                    ]}
                  />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Checks Agent queue and lease handling without creating a workload.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || testBusy !== null || !canQueueProbe}
                title={canQueueProbe ? 'Queue a protocol probe' : 'The Agent must be enrolled'}
                onClick={onTestProtocol}
              >
                {testBusy === 'protocol' ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Activity className="h-4 w-4" />
                )}
                Test protocol
              </Button>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Container className="h-4 w-4 text-primary" /> Restricted Docker lifecycle
                  </p>
                  <InfoTip
                    label="About the Docker lifecycle test"
                    items={[
                      {
                        title: 'Checks',
                        description:
                          'Deploy, health, bounded logs, replacement, rollback, stop and restart.',
                      },
                      {
                        title: 'Cleanup',
                        description:
                          'Removes the temporary container, diagnostic image and empty network afterwards.',
                      },
                      {
                        title: 'Restrictions',
                        description:
                          'No shell command, host mount or deployment secret is sent to the Agent.',
                      },
                    ]}
                  />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Runs a temporary isolated workload and removes it after the test.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || testBusy !== null || !canQueueProbe}
                title={
                  canQueueProbe
                    ? 'Queue a Docker lifecycle test'
                    : 'Agent 0.3.0 or newer must be enrolled'
                }
                onClick={onTestLifecycle}
              >
                {testBusy === 'lifecycle' ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Container className="h-4 w-4" />
                )}
                Test Docker
              </Button>
            </div>

            {target.routingMode === 'managed-gateway' && (
              <div className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <Globe2 className="h-4 w-4 text-primary" /> Production gateway preflight
                    </p>
                    <InfoTip
                      label="About the gateway preflight"
                      items={[
                        {
                          title: 'Checks',
                          description:
                            'The configured DNS zone, trusted TLS on port 443 and the private Caddy adapter.',
                        },
                        {
                          title: 'Impact',
                          description:
                            'Read-only: no route is created and gateway configuration is not changed.',
                        },
                      ]}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Checks DNS, TLS and the private gateway without changing routes.
                  </p>
                  {target.gatewayPreflight && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge
                        status={
                          target.gatewayPreflight.status === 'passed'
                            ? 'success'
                            : target.gatewayPreflight.status
                        }
                        label={`preflight ${target.gatewayPreflight.status}`}
                      />
                      {target.gatewayPreflight.checkedAt && (
                        <span className="text-muted-foreground">
                          {new Date(target.gatewayPreflight.checkedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                  {target.gatewayPreflight?.error && (
                    <p className="mt-2 text-xs text-destructive">{target.gatewayPreflight.error}</p>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || testBusy !== null || !canQueueProbe}
                  title={
                    canQueueProbe
                      ? 'Queue a read-only gateway preflight (Agent 0.5.0 or newer)'
                      : 'The Agent must be enrolled'
                  }
                  onClick={onTestGateway}
                >
                  {testBusy === 'gateway' ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Globe2 className="h-4 w-4" />
                  )}
                  Test gateway
                </Button>
              </div>
            )}

            {protocolError && <p className="text-xs text-destructive">{protocolError}</p>}
            {jobs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No protocol jobs yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Recent Agent tests · newest first
                </p>
                {jobs.slice(0, 3).map((job) => {
                  const leaseExpired = hasExpiredLease(job);
                  const displayStatus = leaseExpired ? 'waiting' : job.status;
                  const displayMessage = agentJobMessage(job, leaseExpired);
                  return (
                    <div key={job.id} className="rounded-md bg-secondary/30 p-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">
                          {job.kind} · attempt {job.attempt}
                        </span>
                        <StatusBadge status={displayStatus} />
                      </div>
                      <time
                        className="mt-0.5 block text-[11px] text-muted-foreground"
                        dateTime={job.createdAt}
                      >
                        {new Date(job.createdAt).toLocaleString()}
                      </time>
                      <p className="mt-1 text-xs text-muted-foreground">{displayMessage}</p>
                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
                        role="progressbar"
                        aria-label={`${job.kind} job progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={job.progressPercent}
                      >
                        <div
                          className={`h-full rounded-full transition-[width] duration-500 ${
                            job.status === 'failed'
                              ? 'bg-destructive'
                              : leaseExpired
                                ? 'bg-warning'
                                : 'bg-primary'
                          }`}
                          style={{ width: `${job.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          {agent && agent.state !== 'disabled' && agent.state !== 'not-enrolled' && (
            <Button variant="ghost" disabled={busy} onClick={() => void disableAgent()}>
              Disconnect Agent
            </Button>
          )}
          <Button disabled={busy} onClick={() => void issueEnrollment()}>
            {busy && <Spinner className="h-4 w-4" />}
            {enrollment || agent?.enrollmentPending
              ? 'Generate a new token'
              : 'Generate enrollment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
