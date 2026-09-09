import {
  Archive,
  Bot,
  ChevronDown,
  Cloud,
  Container,
  Link2Off,
  Pencil,
  Play,
  PowerOff,
  RotateCcw,
  Server,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TargetAllocation } from '@/api';
import { Spinner } from '@/components/atoms/Spinner';
import { InfoTip } from '@/components/molecules/InfoTip';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { TargetUsageList } from '@/components/molecules/TargetUsageList';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProviderKind, Target } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

interface Props {
  target: Target;
  allocation: TargetAllocation | null;
  workspaceName: string;
  busy: boolean;
  readOnly: boolean;
  canManageAgent: boolean;
  canManageLifecycle: boolean;
  canManageAccess: boolean;
  onVerify: () => void;
  onManageAgent: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDisconnect: () => void;
  onRetire: () => void;
  onRestore: () => void;
  onEnableAccess: () => void;
  onEditAccess: () => void;
  onToggleAccess: () => void;
  onRemoveAccess: () => void;
}

function TargetState({ target }: { target: Target }) {
  const managementState = target.managementState ?? 'active';
  const isAgentTarget = target.scope === 'user' && target.kind === 'docker';
  const agentState = target.agent?.state ?? 'not-enrolled';

  if (managementState !== 'active') {
    return (
      <StatusBadge
        status={managementState === 'retired' ? 'disabled' : 'offline'}
        label={managementState}
        className={managementState === 'disconnected'
          ? 'border-warning/50 bg-warning/10 text-foreground'
          : undefined}
      />
    );
  }
  if (isAgentTarget) {
    return (
      <StatusBadge
        status={agentState}
        label={agentState.replace('-', ' ')}
        className={agentState === 'offline'
          ? 'border-warning/50 bg-warning/10 text-foreground'
          : undefined}
      />
    );
  }
  return target.verifiedAt ? (
    <span
      className="flex shrink-0 items-center gap-1 text-xs text-success"
      title={`Verified ${new Date(target.verifiedAt).toLocaleString()}`}
    >
      <ShieldCheck className="h-3.5 w-3.5" /> verified
    </span>
  ) : (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <ShieldAlert className="h-3.5 w-3.5" /> not verified
    </span>
  );
}

export function TargetCard({
  target,
  allocation,
  workspaceName,
  busy,
  readOnly,
  canManageAgent,
  canManageLifecycle,
  canManageAccess,
  onVerify,
  onManageAgent,
  onEdit,
  onDelete,
  onDisconnect,
  onRetire,
  onRestore,
  onEnableAccess,
  onEditAccess,
  onToggleAccess,
  onRemoveAccess,
}: Props) {
  const Icon = KIND_ICON[target.kind] ?? Server;
  const isUserTarget = target.scope === 'user';
  const isAgentTarget = isUserTarget && target.kind === 'docker';
  const agentState = target.agent?.state ?? 'not-enrolled';
  const managementState = target.managementState ?? 'active';
  const unavailable = managementState !== 'active';
  const legacySsh = target.kind === 'ssh';
  const accessDisabled = allocation?.status === 'disabled';
  const usage = allocation?.usage ?? target.usage ?? [];

  return (
    <Card className={cn(
      'min-w-0 p-0',
      ((isAgentTarget && agentState === 'offline') || managementState === 'disconnected')
        && 'border-warning/60',
      managementState === 'retired' && 'border-muted-foreground/30',
    )}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold sm:text-base">{target.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {isAgentTarget
                  ? 'INITPAD AGENT · Workspace server'
                  : legacySsh
                    ? 'SSH · Legacy connector'
                    : target.kind === 'docker'
                      ? 'DOCKER · Self-hosted direct'
                      : `SFTP · ${target.scope === 'builtin' ? 'Self-hosted demo' : 'Shared web hosting'}`}
              </div>
            </div>
          </div>
          <TargetState target={target} />
        </div>

        {legacySsh && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-foreground">Legacy SSH runtime</p>
              <p className="mt-0.5 text-muted-foreground">
                Existing deployments can remain online and be maintained. New environment assignments are disabled;
                use an Agent-backed Docker server for runtime applications.
              </p>
            </div>
          </div>
        )}

        {isAgentTarget && agentState === 'offline' && managementState === 'active' && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-foreground">Agent is offline</p>
              <p className="mt-0.5 text-muted-foreground">
                Running applications are unaffected. New jobs wait safely until the Agent reconnects.
              </p>
            </div>
          </div>
        )}

        {managementState === 'disconnected' && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-foreground">Disconnected from InitPad</p>
              <p className="mt-0.5 text-muted-foreground">
                Existing workloads stay online, but InitPad cannot deploy, stop, inspect or remove them.
              </p>
            </div>
          </div>
        )}

        {managementState === 'retired' && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-3 text-xs">
            <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">Retained as unmanaged</p>
              <p className="mt-0.5 text-muted-foreground">
                History and URLs remain visible. InitPad no longer manages this server.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-secondary/20 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold">Workspace access</h3>
            <InfoTip
              label="About workspace access"
              items={[
                {
                  title: 'Isolation',
                  description: `${workspaceName} receives a separate namespace on this server.`,
                },
                {
                  title: 'Policy',
                  description: 'Allowed runtimes and the environment quota apply only to this workspace.',
                },
              ]}
            />
          </div>
          {allocation && (
            <span className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium',
              accessDisabled || unavailable
                ? 'bg-muted text-muted-foreground'
                : 'bg-success/10 text-success',
            )}>
              {unavailable ? `server ${managementState}` : accessDisabled ? 'paused' : 'enabled'}
            </span>
          )}
        </div>

        {allocation ? (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Isolated namespace</dt>
                <dd className="mt-1 truncate font-mono font-medium text-foreground">{allocation.namespace}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Environment usage</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {allocation.inUse} of {allocation.maxEnvironments}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Allowed runtimes</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {allocation.capabilities.map((capability) => (
                    <span key={capability} className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {capability}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>

            {allocation.publicUrl && (
              <div className="mt-3 truncate font-mono text-xs text-muted-foreground">
                {allocation.publicUrl}
              </div>
            )}

            <div className="mt-3 text-xs text-muted-foreground">
              {allocation.cpuLimitMillicores / 1000} CPU · {allocation.memoryLimitMb} MB · {allocation.pidsLimit} processes
              {(allocation.devTtlHours || allocation.testTtlHours) && (
                <span> · cleanup {allocation.devTtlHours ? `dev ${allocation.devTtlHours}h` : ''}{allocation.devTtlHours && allocation.testTtlHours ? ', ' : ''}{allocation.testTtlHours ? `test ${allocation.testTtlHours}h` : ''}</span>
              )}
            </div>

            {unavailable && (
              <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-muted-foreground">
                Access settings are preserved, but management remains unavailable until the server is reconnected.
              </p>
            )}

            <div className="mt-3">
              <TargetUsageList usage={usage} />
            </div>

            {canManageAccess && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={busy} onClick={onEditAccess}>
                  <Pencil className="h-4 w-4" /> Edit access
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || (accessDisabled && unavailable)}
                  title={accessDisabled && unavailable ? 'Reconnect the server before resuming access' : undefined}
                  onClick={onToggleAccess}
                >
                  {accessDisabled ? <Play className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                  {accessDisabled ? 'Resume access' : 'Pause access'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || usage.length > 0}
                  title={usage.length > 0
                    ? `Used by ${usage.length} environment${usage.length === 1 ? '' : 's'}`
                    : 'Remove workspace access'}
                  onClick={onRemoveAccess}
                >
                  <Trash2 className="h-4 w-4" /> Remove access
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-dashed border-border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {legacySsh ? 'Legacy access unavailable' : 'Not enabled for this workspace'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {legacySsh
                  ? 'New workspace access is disabled. Existing SSH deployments remain visible for migration.'
                  : 'Enable access before assigning environments to this server.'}
              </p>
            </div>
            {canManageAccess && !legacySsh && (
              <Button
                size="sm"
                disabled={busy || unavailable}
                title={unavailable ? 'Reconnect the server before enabling workspace access' : undefined}
                onClick={onEnableAccess}
              >
                Enable for {workspaceName}
              </Button>
            )}
          </div>
        )}
      </div>

      <details className="group border-t border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 sm:px-5">
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" /> Server connection and settings
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border px-4 py-4 sm:px-5">
          <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Connection</dt>
              <dd className="mt-1 break-all font-mono text-foreground">
                {target.host
                  ? `${target.username ? `${target.username}@` : ''}${target.host}${target.port ? `:${target.port}` : ''}`
                  : isAgentTarget ? 'Outbound InitPad Agent' : 'Platform configuration'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Application address</dt>
              <dd className="mt-1 break-all font-mono text-foreground">{target.publicUrl ?? 'Assigned during deployment'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Server supports</dt>
              <dd className="mt-1 text-foreground">{target.capabilities.join(', ')}</dd>
            </div>
          </dl>

          {!readOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isAgentTarget && managementState !== 'retired' ? (
                canManageAgent && (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={onManageAgent}>
                    {busy ? <Spinner className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    {managementState === 'disconnected' ? 'Reconnect Agent' : 'Manage Agent'}
                  </Button>
                )
              ) : !isAgentTarget && managementState === 'active' ? (
                <Button variant="secondary" size="sm" disabled={busy} onClick={onVerify}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                  Test connection
                </Button>
              ) : !isAgentTarget && managementState === 'disconnected' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={target.credentialConfigured ? onVerify : onEdit}
                >
                  <RotateCcw className="h-4 w-4" />
                  {target.credentialConfigured ? 'Verify & reconnect' : 'Reconnect'}
                </Button>
              ) : null}

              {isUserTarget && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || unavailable}
                  title={unavailable ? 'Restore or reconnect this server before editing it' : undefined}
                  onClick={onEdit}
                >
                  <Pencil className="h-4 w-4" /> Edit server
                </Button>
              )}
              {isUserTarget && canManageLifecycle && managementState === 'active' && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={onDisconnect}>
                  <Link2Off className="h-4 w-4" /> Disconnect
                </Button>
              )}
              {isUserTarget && canManageLifecycle && managementState !== 'retired' && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={onRetire}>
                  <Archive className="h-4 w-4" /> Retire
                </Button>
              )}
              {isUserTarget && canManageLifecycle && managementState === 'retired' && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={onRestore}>
                  <RotateCcw className="h-4 w-4" /> Restore
                </Button>
              )}
              {isUserTarget && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || usage.length > 0}
                  title={usage.length > 0
                    ? `Used by ${usage.length} environment${usage.length === 1 ? '' : 's'}`
                    : 'Delete server'}
                  onClick={onDelete}
                >
                  <Trash2 className="h-4 w-4" /> Delete server
                </Button>
              )}
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}
