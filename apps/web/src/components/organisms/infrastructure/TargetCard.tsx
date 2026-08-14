import { Bot, Cloud, Container, Pencil, Server, ShieldAlert, ShieldCheck, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from '@/components/atoms/Spinner';
import { StatusBadge } from '@/components/molecules/StatusBadge';
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
  busy: boolean;
  readOnly: boolean;
  canManageAgent: boolean;
  onVerify: () => void;
  onManageAgent: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function TargetCard({
  target,
  busy,
  readOnly,
  canManageAgent,
  onVerify,
  onManageAgent,
  onEdit,
  onDelete,
}: Props) {
  const Icon = KIND_ICON[target.kind] ?? Server;
  const isUserTarget = target.scope === 'user';
  const isAgentTarget = isUserTarget && target.kind === 'docker';
  const agentState = target.agent?.state ?? 'not-enrolled';

  return (
    <Card className={cn(
      'flex min-w-0 flex-col gap-3 p-5',
      isAgentTarget && agentState === 'offline' && 'border-warning/60 bg-warning/[0.04]',
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
        {isAgentTarget ? (
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

      {!readOnly && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {isAgentTarget ? (
            canManageAgent && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onManageAgent}>
                {busy ? <Spinner className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                {target.agent ? 'Manage Agent' : 'Set up Agent'}
              </Button>
            )
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onVerify}>
              {busy ? <Spinner className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              Test connection
            </Button>
          )}
          {isUserTarget && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Edit target" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete target"
                disabled={busy || target.inUse}
                title={target.inUse ? 'In use by an environment' : 'Delete target'}
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
