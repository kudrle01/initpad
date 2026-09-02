import {
  Archive,
  Bot,
  Cloud,
  Container,
  Link2Off,
  Pencil,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from '@/components/atoms/Spinner';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TargetUsageList } from '@/components/molecules/TargetUsageList';
import { cn } from '@/lib/utils';
import type { ProviderKind, Target } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

interface Props {
  target: Target;
  busy: boolean;
  readOnly: boolean;
  canManageAgent: boolean;
  canManageLifecycle: boolean;
  onVerify: () => void;
  onManageAgent: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDisconnect: () => void;
  onRetire: () => void;
  onRestore: () => void;
}

export function TargetCard({
  target,
  busy,
  readOnly,
  canManageAgent,
  canManageLifecycle,
  onVerify,
  onManageAgent,
  onEdit,
  onDelete,
  onDisconnect,
  onRetire,
  onRestore,
}: Props) {
  const Icon = KIND_ICON[target.kind] ?? Server;
  const isUserTarget = target.scope === 'user';
  const isAgentTarget = isUserTarget && target.kind === 'docker';
  const agentState = target.agent?.state ?? 'not-enrolled';
  const managementState = target.managementState ?? 'active';
  const unavailable = managementState !== 'active';
  const usage = target.usage ?? [];

  return (
    <Card className={cn(
      'flex min-w-0 flex-col gap-3 p-5',
      ((isAgentTarget && agentState === 'offline') || managementState === 'disconnected')
        && 'border-warning/60 bg-warning/[0.04]',
      managementState === 'retired' && 'border-muted-foreground/30 bg-secondary/20',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{target.name}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {target.kind} · {target.scope === 'builtin' ? 'built-in' : 'your server'}
            </div>
          </div>
        </div>
        {managementState !== 'active' ? (
          <StatusBadge
            status={managementState === 'retired' ? 'disabled' : 'offline'}
            label={managementState}
            className={managementState === 'disconnected'
              ? 'border-warning/50 bg-warning/10 text-foreground'
              : undefined}
          />
        ) : isAgentTarget ? (
          <StatusBadge
            status={agentState}
            label={agentState.replace('-', ' ')}
            className={agentState === 'offline' ? 'border-warning/50 bg-warning/10 text-foreground' : undefined}
          />
        ) : target.verifiedAt ? (
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
        )}
      </div>

      {isAgentTarget && agentState === 'offline' && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-foreground">Connection lost</p>
            <p className="mt-0.5 text-muted-foreground">
              Jobs will wait safely and resume when the Agent reconnects.
            </p>
          </div>
        </div>
      )}

      {managementState === 'disconnected' && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
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
        <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-2.5 text-xs">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">Retained as unmanaged</p>
            <p className="mt-0.5 text-muted-foreground">
              History and URLs remain visible. InitPad no longer manages this infrastructure.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {target.capabilities.map((capability) => (
          <span
            key={capability}
            className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
          >
            {capability}
          </span>
        ))}
      </div>

      {isAgentTarget && (
        <div className="text-xs text-muted-foreground">
          {target.routingMode === 'managed-gateway'
            ? `managed gateway · preflight ${target.gatewayPreflight?.status ?? 'not-run'}`
            : 'direct ports · local/lab'}
        </div>
      )}

      {(target.host || target.publicUrl) && (
        <div className="flex min-w-0 flex-col gap-0.5 font-mono text-xs text-muted-foreground">
          {target.host && (
            <span className="truncate">
              {target.username ? `${target.username}@` : ''}{target.host}
              {target.port ? `:${target.port}` : ''}
            </span>
          )}
          {target.publicUrl && <span className="truncate">{target.publicUrl}</span>}
        </div>
      )}

      <TargetUsageList usage={usage} />

      {!readOnly && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {isAgentTarget && managementState !== 'retired' ? (
            canManageAgent && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onManageAgent}>
                {busy ? <Spinner className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                {managementState === 'disconnected'
                  ? 'Reconnect Agent'
                  : target.agent ? 'Manage Agent' : 'Set up Agent'}
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
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit target"
                disabled={busy || unavailable}
                title={unavailable ? 'Restore or reconnect this target before editing it' : 'Edit target'}
                onClick={onEdit}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete target"
                disabled={busy || usage.length > 0}
                title={usage.length > 0
                  ? `Used by ${usage.length} environment${usage.length === 1 ? '' : 's'}`
                  : 'Delete target'}
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
