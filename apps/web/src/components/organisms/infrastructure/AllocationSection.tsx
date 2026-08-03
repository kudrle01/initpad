import { Layers, Plus } from 'lucide-react';
import type { TargetAllocation } from '@/api';
import { EmptyState } from '@/components/molecules/EmptyState';
import { Button } from '@/components/ui/button';
import { AllocationCard } from './AllocationCard';

interface Props {
  allocations: TargetAllocation[];
  canManage: boolean;
  canAdd: boolean;
  busyAllocationId: string | null;
  onAdd: () => void;
  onEdit: (allocation: TargetAllocation) => void;
  onToggle: (allocation: TargetAllocation) => void;
  onDelete: (allocation: TargetAllocation) => void;
}

export function AllocationSection({
  allocations,
  canManage,
  canAdd,
  busyAllocationId,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: Props) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Allocations (this workspace)
        </h2>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!canAdd}
            title={canAdd
              ? 'Allocate a target'
              : 'Every available target is already allocated to this workspace'}
            onClick={onAdd}
          >
            <Plus className="h-4 w-4" /> Allocate target
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        How this workspace uses each target: its own namespace, capabilities and quota. Two
        workspaces on the same shared target never collide.
      </p>
      {allocations.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No target allocated"
          description="Allocate shared capacity to this workspace before deploying its environments."
          action={canManage && canAdd ? (
            <Button onClick={onAdd}>
              <Plus className="h-4 w-4" /> Allocate target
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {allocations.map((allocation) => (
            <AllocationCard
              key={allocation.id}
              allocation={allocation}
              busy={busyAllocationId === allocation.id}
              canManage={canManage}
              onEdit={() => onEdit(allocation)}
              onToggle={() => onToggle(allocation)}
              onDelete={() => onDelete(allocation)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
