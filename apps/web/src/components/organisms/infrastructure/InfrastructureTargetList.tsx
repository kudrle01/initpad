import { Plus, Server } from 'lucide-react';
import type { TargetAllocation } from '@/api';
import { EmptyState } from '@/components/molecules/EmptyState';
import { InfoTip } from '@/components/molecules/InfoTip';
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
  const orderedTargets = [...targets].sort((left, right) => {
    const rank = (target: Target) => {
      if (target.kind === 'ssh') return 3;
      if (target.kind === 'sftp') return 2;
      return target.scope === 'user' ? 0 : 1;
    };
    return rank(left) - rank(right) || left.name.localeCompare(right.name);
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold text-foreground">Deployment servers</h2>
        <InfoTip
          label="How infrastructure is organized"
          items={[
            {
              title: 'Server',
              description: 'The machine or hosting endpoint that receives deployments.',
            },
            {
              title: 'Workspace access',
              description: `The isolated namespace, allowed runtimes and quota for ${workspaceName}.`,
            },
            {
              title: 'Environment',
              description:
                'A project’s dev, test or prod application deployed through that access.',
            },
          ]}
        />
      </div>

      {targets.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No deployment servers"
          description="Connect a Docker server through InitPad Agent, or add compatible SFTP hosting for PHP and static sites."
          action={
            !readOnly ? (
              <Button onClick={onAdd}>
                <Plus className="h-4 w-4" /> Add server
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {orderedTargets.map((target) => {
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
