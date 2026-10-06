import { useId, useState, type ReactNode } from 'react';
import {
  Archive,
  Bot,
  ChevronDown,
  Cloud,
  Container,
  Link2Off,
  MoreHorizontal,
  Pencil,
  Play,
  PowerOff,
  RotateCcw,
  Server,
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
import { listRowClassName, listRowInteractiveClassName } from '@/components/molecules/List';
import { Notice } from '@/components/molecules/Notice';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { TargetUsageList } from '@/components/molecules/TargetUsageList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ProviderKind, Target } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
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
  /** Open on first render (used when the list has a single server). */
  defaultOpen?: boolean;
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
        className={managementState === 'disconnected' ? 'bg-warning/10 text-warning' : undefined}
      />
    );
  }
  if (isAgentTarget) {
    return (
      <StatusBadge
        status={agentState}
        label={agentState.replace('-', ' ')}
        className={agentState === 'offline' ? 'bg-warning/10 text-warning' : undefined}
      />
    );
  }
  return target.verifiedAt ? (
    <Badge variant="success" title={`Verified ${new Date(target.verifiedAt).toLocaleString()}`}>
      <ShieldCheck className="h-3.5 w-3.5" /> verified
    </Badge>
  ) : (
    <Badge>
      <ShieldAlert className="h-3.5 w-3.5" /> not verified
    </Badge>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm">{children}</dd>
    </div>
  );
}

const PANEL = 'min-w-0 rounded-lg border border-border/70 bg-card p-4';

// One server is one row. The row answers "is it up, and can this workspace
// deploy to it?"; the access policy, connection details and every management
// action open underneath on demand.
export function TargetRow({
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
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const Icon = KIND_ICON[target.kind] ?? Server;
  const isUserTarget = target.scope === 'user';
  const isAgentTarget = isUserTarget && target.kind === 'docker';
  const agentState = target.agent?.state ?? 'not-enrolled';
  const managementState = target.managementState ?? 'active';
  const unavailable = managementState !== 'active';
  const accessDisabled = allocation?.status === 'disabled';
  const usage = allocation?.usage ?? target.usage ?? [];
  const needsAttention =
    (isAgentTarget && agentState === 'offline' && !unavailable) ||
    managementState === 'disconnected';

  const kindLabel = isAgentTarget
    ? 'InitPad Agent · workspace server'
    : target.kind === 'docker'
      ? 'Docker · self-hosted direct'
      : `SFTP · ${target.scope === 'builtin' ? 'self-hosted demo' : 'shared web hosting'}`;
  const accessSummary = !allocation
    ? 'No workspace access'
    : unavailable
      ? `Server ${managementState}`
      : accessDisabled
        ? 'Access paused'
        : `${allocation.inUse} of ${allocation.maxEnvironments} environments`;

  // Delete is offered for every workspace server; the rest depend on the role.
  const hasLifecycleActions = isUserTarget;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(listRowClassName, listRowInteractiveClassName, 'w-full text-left')}
      >
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            needsAttention ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold" title={target.name}>
            {target.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {kindLabel}
            <span className="md:hidden"> · {accessSummary}</span>
          </span>
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
          {accessSummary}
        </span>
        <TargetState target={target} />
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={panelId} className="space-y-3 bg-muted/50 px-4 pb-4 pt-1 sm:px-6 sm:pb-5">
          {isAgentTarget && agentState === 'offline' && managementState === 'active' && (
            <Notice tone="warning" icon={WifiOff} title="Agent is offline">
              Running applications are unaffected. New jobs wait safely until the Agent reconnects.
            </Notice>
          )}
          {managementState === 'disconnected' && (
            <Notice tone="warning" icon={Link2Off} title="Disconnected from InitPad">
              Existing workloads stay online, but InitPad cannot deploy, stop, inspect or remove
              them.
            </Notice>
          )}
          {managementState === 'retired' && (
            <Notice icon={Archive} title="Retained as unmanaged" className="bg-card">
              History and URLs remain visible. InitPad no longer manages this server.
            </Notice>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <section className={PANEL} aria-label="Workspace access">
              <div className="flex min-h-7 items-center justify-between gap-3">
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
                        description:
                          'Allowed runtimes and the environment quota apply only to this workspace.',
                      },
                    ]}
                  />
                </div>
                {allocation && (
                  <Badge variant={accessDisabled || unavailable ? 'default' : 'success'}>
                    {unavailable
                      ? `server ${managementState}`
                      : accessDisabled
                        ? 'paused'
                        : 'enabled'}
                  </Badge>
                )}
              </div>

              {allocation ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    <Detail label="Isolated namespace">
                      <span
                        className="block truncate font-mono text-[13px]"
                        title={allocation.namespace}
                      >
                        {allocation.namespace}
                      </span>
                    </Detail>
                    <Detail label="Environment usage">
                      <span className="font-medium tabular-nums">
                        {allocation.inUse} of {allocation.maxEnvironments}
                      </span>
                    </Detail>
                    <Detail label="Allowed runtimes">
                      <span className="flex flex-wrap gap-1">
                        {allocation.capabilities.map((capability) => (
                          <Badge key={capability} variant="brand" className="px-2 py-0">
                            {capability}
                          </Badge>
                        ))}
                      </span>
                    </Detail>
                    <Detail label="Limits per environment">
                      <span className="text-[13px]">
                        {allocation.cpuLimitMillicores / 1000} CPU · {allocation.memoryLimitMb} MB ·{' '}
                        {allocation.pidsLimit} processes
                      </span>
                    </Detail>
                    {allocation.publicUrl && (
                      <div className="col-span-2 min-w-0">
                        <dt className="eyebrow">Public address</dt>
                        <dd
                          className="mt-0.5 truncate font-mono text-[13px]"
                          title={allocation.publicUrl}
                        >
                          {allocation.publicUrl}
                        </dd>
                      </div>
                    )}
                    {(allocation.devTtlHours || allocation.testTtlHours) && (
                      <div className="col-span-2 min-w-0">
                        <dt className="eyebrow">Automatic cleanup</dt>
                        <dd className="mt-0.5 text-[13px]">
                          {allocation.devTtlHours ? `dev after ${allocation.devTtlHours}h` : ''}
                          {allocation.devTtlHours && allocation.testTtlHours ? ', ' : ''}
                          {allocation.testTtlHours ? `test after ${allocation.testTtlHours}h` : ''}
                        </dd>
                      </div>
                    )}
                  </dl>

                  {unavailable && (
                    <Notice tone="warning" className="mt-3">
                      Access settings are preserved, but management remains unavailable until the
                      server is reconnected.
                    </Notice>
                  )}

                  {usage.length > 0 && (
                    <div className="mt-3">
                      <TargetUsageList usage={usage} />
                    </div>
                  )}

                  {canManageAccess && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" disabled={busy} onClick={onEditAccess}>
                        <Pencil className="h-3.5 w-3.5" /> Edit access
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || (accessDisabled && unavailable)}
                        title={
                          accessDisabled && unavailable
                            ? 'Reconnect the server before resuming access'
                            : undefined
                        }
                        onClick={onToggleAccess}
                      >
                        {accessDisabled ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <PowerOff className="h-3.5 w-3.5" />
                        )}
                        {accessDisabled ? 'Resume access' : 'Pause access'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || usage.length > 0}
                        title={
                          usage.length > 0
                            ? `Used by ${usage.length} environment${usage.length === 1 ? '' : 's'}`
                            : 'Remove workspace access'
                        }
                        onClick={onRemoveAccess}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove access
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-3">
                  <p className="text-sm font-medium">Not enabled for this workspace</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Enable access before assigning environments to this server.
                  </p>
                  {canManageAccess && (
                    <Button
                      size="sm"
                      className="mt-3 max-w-full"
                      disabled={busy || unavailable}
                      title={
                        unavailable
                          ? 'Reconnect the server before enabling workspace access'
                          : undefined
                      }
                      onClick={onEnableAccess}
                    >
                      <span className="truncate">Enable for {workspaceName}</span>
                    </Button>
                  )}
                </div>
              )}
            </section>

            <section className={PANEL} aria-label="Server connection and settings">
              <h3 className="flex min-h-7 items-center text-sm font-semibold">
                Server connection and settings
              </h3>
              <dl className="mt-3 grid grid-cols-1 gap-3">
                <Detail label="Connection">
                  <span className="break-all font-mono text-[13px]">
                    {target.host
                      ? `${target.username ? `${target.username}@` : ''}${target.host}${target.port ? `:${target.port}` : ''}`
                      : isAgentTarget
                        ? 'Outbound InitPad Agent'
                        : 'Platform configuration'}
                  </span>
                </Detail>
                <Detail label="Application address">
                  <span className="break-all font-mono text-[13px]">
                    {target.publicUrl ?? 'Assigned during deployment'}
                  </span>
                </Detail>
                <Detail label="Server supports">{target.capabilities.join(', ')}</Detail>
              </dl>

              {!readOnly && (
                <div className="mt-4 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isAgentTarget && managementState !== 'retired' ? (
                      canManageAgent && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={onManageAgent}
                        >
                          {busy ? (
                            <Spinner className="h-3.5 w-3.5" />
                          ) : (
                            <Bot className="h-3.5 w-3.5" />
                          )}
                          {managementState === 'disconnected' ? 'Reconnect Agent' : 'Manage Agent'}
                        </Button>
                      )
                    ) : !isAgentTarget && managementState === 'active' ? (
                      <Button variant="secondary" size="sm" disabled={busy} onClick={onVerify}>
                        {busy ? (
                          <Spinner className="h-3.5 w-3.5" />
                        ) : (
                          <Wifi className="h-3.5 w-3.5" />
                        )}
                        Test connection
                      </Button>
                    ) : !isAgentTarget && managementState === 'disconnected' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={target.credentialConfigured ? onVerify : onEdit}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {target.credentialConfigured ? 'Verify & reconnect' : 'Reconnect'}
                      </Button>
                    ) : null}

                    {isUserTarget && canManageLifecycle && managementState === 'retired' && (
                      <Button variant="secondary" size="sm" disabled={busy} onClick={onRestore}>
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </Button>
                    )}
                    {isUserTarget && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || unavailable}
                        title={
                          unavailable
                            ? 'Restore or reconnect this server before editing it'
                            : undefined
                        }
                        onClick={onEdit}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit server
                      </Button>
                    )}
                  </div>

                  {/* Rare, consequential lifecycle actions stay out of the way. */}
                  {hasLifecycleActions && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-10 w-10 shrink-0 rounded-full sm:h-8 sm:w-8"
                          disabled={busy}
                          aria-label={`More actions for ${target.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {canManageLifecycle && managementState === 'active' && (
                          <DropdownMenuItem onSelect={onDisconnect}>
                            <Link2Off className="h-4 w-4 text-muted-foreground" /> Disconnect
                          </DropdownMenuItem>
                        )}
                        {canManageLifecycle && managementState !== 'retired' && (
                          <DropdownMenuItem onSelect={onRetire}>
                            <Archive className="h-4 w-4 text-muted-foreground" /> Retire
                          </DropdownMenuItem>
                        )}
                        {canManageLifecycle && managementState !== 'retired' && (
                          <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem
                          destructive
                          disabled={usage.length > 0}
                          title={
                            usage.length > 0
                              ? `Used by ${usage.length} environment${usage.length === 1 ? '' : 's'}`
                              : undefined
                          }
                          onSelect={onDelete}
                        >
                          <Trash2 className="h-4 w-4" /> Delete server
                          {usage.length > 0 && (
                            <span className="ml-auto pl-3 text-xs text-muted-foreground">
                              in use
                            </span>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </li>
  );
}
