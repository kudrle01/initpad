import { useEffect, useState } from 'react';
import { Activity, Bot, Container, Download, Globe2, ShieldAlert, WifiOff } from 'lucide-react';
import type { AgentDistribution, AgentEnrollment, AgentJobSummary, AgentStatus, Target } from '@/types';
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
  testBusy: 'protocol' | 'lifecycle' | 'gateway' | null;
  busy: boolean;
  enrollment: AgentEnrollment | null;
  onOpenChange: (open: boolean) => void;
  onIssueEnrollment: () => void;
  onDisable: () => void;
  onTestProtocol: () => void;
  onTestLifecycle: () => void;
  onTestGateway: () => void;
}

const STATE_LABEL: Record<string, string> = {
  'not-enrolled': 'not enrolled',
  offline: 'offline',
  online: 'online',
  disabled: 'disabled',
};

function hasExpiredLease(job: AgentJobSummary, now = Date.now()): boolean {
  return job.status === 'leased'
    && job.leaseExpiresAt !== null
    && new Date(job.leaseExpiresAt).getTime() <= now;
}

function formatMemory(bytes: number): string {
  const gibibytes = bytes / (1024 ** 3);
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
}: Props) {
  const confirmAction = useConfirmation();
  const [distribution, setDistribution] = useState<AgentDistribution | null>(null);
  const [distributionError, setDistributionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setDistributionError(null);
    void api.getAgentDistribution()
      .then((release) => {
        if (current) setDistribution(release);
      })
      .catch((cause: unknown) => {
        if (current) setDistributionError((cause as Error).message);
      });
    return () => {
      current = false;
    };
  }, [open]);

  if (!target) return null;
  const currentTarget = target;
  const state = agent?.state ?? 'not-enrolled';
  const canQueueProbe = state === 'online' || state === 'offline';
  const insecureFlag = window.location.protocol === 'http:' ? ' --allow-insecure-http' : '';
  const enrollCommand = `sudo initpad-agent enroll --url '${window.location.origin}'${insecureFlag}`;
  const installerUrl = distribution
    ? new URL(distribution.installer.path, window.location.origin).toString()
    : null;
  const publishedHost = currentTarget.routingMode === 'direct-port' && currentTarget.publicUrl
    ? new URL(currentTarget.publicUrl).hostname
    : null;
  const installCommand = distribution?.available && distribution.image && installerUrl
    ? `curl -fsSLo initpad-agent-install.sh '${installerUrl}' && printf '%s  %s\\n' '${distribution.installer.sha256}' initpad-agent-install.sh | sha256sum -c - && sudo sh ./initpad-agent-install.sh --url '${window.location.origin}' --image '${distribution.image}'${publishedHost ? ` --published-host '${publishedHost}'` : ''}${insecureFlag}`
    : null;

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
      description: 'This revokes the server identity used to receive work from InitPad without stopping its workloads.',
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

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle><Bot className="h-[18px] w-[18px]" /> InitPad Agent</DialogTitle>
          <DialogDescription>
            {target.name} connects outbound to this control plane. InitPad never needs inbound
            SSH access or a public management port on the Docker server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Agent status</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {agent?.version ? `Version ${agent.version} · protocol ${agent.protocolVersion}` : 'No Agent heartbeat received yet'}
              </p>
            </div>
            <StatusBadge
              status={state}
              label={STATE_LABEL[state]}
              className={state === 'offline' ? 'border-warning/50 bg-warning/10 text-foreground' : undefined}
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
                  The control plane has not received a heartbeat for more than 90 seconds.
                  Jobs remain safely queued and continue automatically after the Agent reconnects.
                </p>
                {agent?.lastSeenAt && (
                  <p className="mt-2 text-xs font-medium text-foreground">
                    Last contact: {new Date(agent.lastSeenAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}

          {agent?.capabilities && (
            <div className="grid gap-1 rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground sm:grid-cols-2">
              <span>Docker {agent.capabilities.engineVersion} · API {agent.capabilities.apiVersion}</span>
              <span className="sm:text-right">
                {agent.capabilities.os}/{agent.capabilities.arch}
                {agent.capabilities.rootless ? ' · rootless' : ''}
              </span>
              <span className="sm:col-span-2">
                {agent.capabilities.cpus} CPU · {formatMemory(agent.capabilities.memoryBytes)} available to Docker
              </span>
            </div>
          )}

          {enrollment ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <div className="flex items-start gap-2 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  This token is shown once and expires at{' '}
                  <b className="font-medium">{new Date(enrollment.enrollmentExpiresAt!).toLocaleTimeString()}</b>.
                  Closing this dialog discards the plaintext.
                </p>
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Enrollment token</p>
                <CopyField command={enrollment.enrollmentToken} />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {installCommand ? 'Install and enroll on the Docker server' : 'Enroll on the Docker server'}
                  </p>
                  {installerUrl && (
                    <Button asChild variant="ghost" size="sm">
                      <a href={installerUrl} download="initpad-agent-install.sh">
                        <Download className="h-3.5 w-3.5" /> Download installer
                      </a>
                    </Button>
                  )}
                </div>
                <CopyField command={installCommand ?? enrollCommand} />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {installCommand
                    ? `The checksum and immutable Agent ${distribution?.version} image are verified before installation.`
                    : (distribution?.unavailableReason ?? distributionError ?? 'Loading Agent release information…')}
                  {' '}The token is requested through a hidden prompt and never enters shell history.
                </p>
                {currentTarget.routingMode === 'managed-gateway' && installCommand && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Managed gateway installations also need the target-local Caddy socket,
                    gateway container and optional private CA flags shown by the installer help.
                  </p>
                )}
              </div>
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
                        description: 'Claim, progress reporting, lease renewal and completion over 35 seconds.',
                      },
                      {
                        title: 'Impact',
                        description: 'Does not run a shell command or create a workload. Offline jobs wait safely in the queue.',
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
                {testBusy === 'protocol' ? <Spinner className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
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
                        description: 'Deploy, health, bounded logs, replacement, rollback, stop and restart.',
                      },
                      {
                        title: 'Cleanup',
                        description: 'Removes the temporary container, diagnostic image and empty network afterwards.',
                      },
                      {
                        title: 'Restrictions',
                        description: 'No shell command, host mount or deployment secret is sent to the Agent.',
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
                title={canQueueProbe ? 'Queue a Docker lifecycle test' : 'Agent 0.3.0 or newer must be enrolled'}
                onClick={onTestLifecycle}
              >
                {testBusy === 'lifecycle' ? <Spinner className="h-4 w-4" /> : <Container className="h-4 w-4" />}
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
                          description: 'The configured DNS zone, trusted TLS on port 443 and the private Caddy adapter.',
                        },
                        {
                          title: 'Impact',
                          description: 'Read-only: no route is created and gateway configuration is not changed.',
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
                        status={target.gatewayPreflight.status === 'passed'
                          ? 'success'
                          : target.gatewayPreflight.status}
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
                  title={canQueueProbe
                    ? 'Queue a read-only gateway preflight (Agent 0.5.0 or newer)'
                    : 'The Agent must be enrolled'}
                  onClick={onTestGateway}
                >
                  {testBusy === 'gateway' ? <Spinner className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
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
                  const displayMessage = leaseExpired
                    ? 'Lease expired. Waiting for the Agent to reconnect and retry automatically.'
                    : (job.message ?? job.progressStage);
                  return (
                    <div key={job.id} className="rounded-md bg-secondary/30 p-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">{job.kind} · attempt {job.attempt}</span>
                        <StatusBadge status={displayStatus} />
                      </div>
                      <time className="mt-0.5 block text-[11px] text-muted-foreground" dateTime={job.createdAt}>
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
            {enrollment || agent?.enrollmentPending ? 'Generate a new token' : 'Generate enrollment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
