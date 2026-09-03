import { ArrowDown, Boxes, Plus, Server, Users } from 'lucide-react';
import type { TargetAllocation } from '@/api';
import { EmptyState } from '@/components/molecules/EmptyState';
import { Button } from '@/components/ui/button';
import type { Target } from '@/types';
import { TargetCard } from './TargetCard';

interface Props {
  targets: Target[];
  allocations: TargetAllocation[];
  workspaceName: string;
  readOnly: boolean;
  canManageAgent: boolean;
  canManageLifecycle: boolean;
  canManageAccess: boolean;
  busyTargetId: string | null;
  busyAllocationId: string | null;
  onAdd: () => void;
  onEdit: (target: Target) => void;
  onVerify: (target: Target) => void;
  onManageAgent: (target: Target) => void;
  onDelete: (target: Target) => void;
  onDisconnect: (target: Target) => void;
  onRetire: (target: Target) => void;
  onRestore: (target: Target) => void;
  onEnableAccess: (target: Target) => void;
  onEditAccess: (allocation: TargetAllocation) => void;
  onToggleAccess: (allocation: TargetAllocation) => void;
  onRemoveAccess: (allocation: TargetAllocation) => void;
}

export function InfrastructureTargetList({
  targets,
  allocations,
  workspaceName,
  readOnly,
  canManageAgent,
  canManageLifecycle,
  canManageAccess,
  busyTargetId,
  busyAllocationId,
  onAdd,
  onEdit,
  onVerify,
  onManageAgent,
  onDelete,
  onDisconnect,
  onRetire,
  onRestore,
  onEnableAccess,
  onEditAccess,
  onToggleAccess,
  onRemoveAccess,
}: Props) {
  const allocationByTarget = new Map(
    allocations.map((allocation) => [allocation.targetId, allocation]),
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Deployment servers</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Each server appears once. Its workspace access defines how {workspaceName} may use it;
          environments are the applications currently assigned to that access.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 shrink-0 text-primary" />
          <span><b className="font-medium text-foreground">Server</b> — connection and capacity</span>
        </div>
        <ArrowDown className="ml-1 h-3.5 w-3.5 sm:rotate-[-90deg]" />
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-primary" />
          <span><b className="font-medium text-foreground">Workspace access</b> — namespace and quota</span>
        </div>
        <ArrowDown className="ml-1 h-3.5 w-3.5 sm:rotate-[-90deg]" />
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 shrink-0 text-primary" />
          <span><b className="font-medium text-foreground">Environments</b> — deployed applications</span>
        </div>
      </div>

      {targets.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No deployment servers"
          description="Add a Docker, SSH or SFTP server to make deployment capacity available to this workspace."
          action={!readOnly ? (
            <Button onClick={onAdd}>
              <Plus className="h-4 w-4" /> Add server
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {targets.map((target) => {
            const allocation = allocationByTarget.get(target.id) ?? null;
            return (
              <TargetCard
                key={target.id}
                target={target}
                allocation={allocation}
                workspaceName={workspaceName}
                busy={busyTargetId === target.id || busyAllocationId === allocation?.id}
                readOnly={readOnly}
                canManageAgent={canManageAgent}
                canManageLifecycle={canManageLifecycle}
                canManageAccess={canManageAccess}
                onVerify={() => onVerify(target)}
                onManageAgent={() => onManageAgent(target)}
                onEdit={() => onEdit(target)}
                onDelete={() => onDelete(target)}
                onDisconnect={() => onDisconnect(target)}
                onRetire={() => onRetire(target)}
                onRestore={() => onRestore(target)}
                onEnableAccess={() => onEnableAccess(target)}
                onEditAccess={() => allocation && onEditAccess(allocation)}
                onToggleAccess={() => allocation && onToggleAccess(allocation)}
                onRemoveAccess={() => allocation && onRemoveAccess(allocation)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
