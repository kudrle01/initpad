import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TargetAllocation, TargetAllocationInput, TargetInput } from '@/api';
import { useAuth } from '@/auth';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AllocationDialog } from '@/components/organisms/AllocationDialog';
import { AllocationSection } from '@/components/organisms/infrastructure/AllocationSection';
import { TargetSections } from '@/components/organisms/infrastructure/TargetSections';
import { TargetFormDialog } from '@/components/organisms/TargetDialog';
import { Button } from '@/components/ui/button';
import { useInfrastructure } from '@/hooks/useInfrastructure';
import type { Target } from '@/types';

export default function Infrastructure() {
  const { activeWorkspace, user } = useAuth();
  const infrastructure = useInfrastructure(activeWorkspace?.id);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [allocationDialogOpen, setAllocationDialogOpen] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<TargetAllocation | null>(null);

  const readOnly = !activeWorkspace
    || !['owner', 'admin', 'maintainer'].includes(activeWorkspace.role);
  const canManageAllocations = !!activeWorkspace
    && ['owner', 'admin'].includes(activeWorkspace.role);
  const allocatedTargetIds = new Set(
    infrastructure.allocations.map((allocation) => allocation.targetId),
  );
  const availableAllocationTargets = infrastructure.targets.filter(
    (target) => !allocatedTargetIds.has(target.id),
  );

  function openNewTarget() {
    setEditingTarget(null);
    setTargetDialogOpen(true);
  }

  function openNewAllocation() {
    setEditingAllocation(null);
    setAllocationDialogOpen(true);
  }

  async function submitTarget(values: TargetInput) {
    if (await infrastructure.saveTarget(editingTarget, values)) {
      setTargetDialogOpen(false);
      setEditingTarget(null);
    }
  }

  async function submitAllocation(values: TargetAllocationInput) {
    if (await infrastructure.saveAllocation(editingAllocation, values)) {
      setAllocationDialogOpen(false);
      setEditingAllocation(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Infrastructure"
        subtitle={user?.edition === 'saas'
          ? 'Workspace servers for dev, test and production. Local/private Docker servers will connect through InitPad Agent.'
          : 'Where projects deploy. Built-in targets are the simulated company infra; add your own servers for any environment.'}
        actions={!readOnly ? (
          <Button onClick={openNewTarget}>
            <Plus className="h-4 w-4" /> Add target
          </Button>
        ) : undefined}
      />

      {infrastructure.error ? (
        <LoadErrorState message={infrastructure.error} onRetry={infrastructure.reload} />
      ) : infrastructure.loading ? (
        <ContentLoading label="Loading infrastructure" variant="cards" />
      ) : (
        <div className="flex flex-col gap-8">
          <TargetSections
            targets={infrastructure.targets}
            readOnly={readOnly}
            busyTargetId={infrastructure.busyTargetId}
            onAdd={openNewTarget}
            onEdit={(target) => {
              setEditingTarget(target);
              setTargetDialogOpen(true);
            }}
            onVerify={infrastructure.verifyTarget}
            onDelete={infrastructure.deleteTarget}
          />
          <AllocationSection
            allocations={infrastructure.allocations}
            canManage={canManageAllocations}
            canAdd={availableAllocationTargets.length > 0}
            busyAllocationId={infrastructure.busyAllocationId}
            onAdd={openNewAllocation}
            onEdit={(allocation) => {
              setEditingAllocation(allocation);
              setAllocationDialogOpen(true);
            }}
            onToggle={infrastructure.toggleAllocation}
            onDelete={infrastructure.deleteAllocation}
          />
        </div>
      )}

      <TargetFormDialog
        open={targetDialogOpen}
        target={editingTarget}
        busy={infrastructure.savingTarget}
        onOpenChange={(open) => {
          setTargetDialogOpen(open);
          if (!open) setEditingTarget(null);
        }}
        onSubmit={submitTarget}
      />
      <AllocationDialog
        open={allocationDialogOpen}
        allocation={editingAllocation}
        targets={editingAllocation
          ? infrastructure.targets.filter((target) => target.id === editingAllocation.targetId)
          : availableAllocationTargets}
        busy={infrastructure.savingAllocation}
        onOpenChange={(open) => {
          setAllocationDialogOpen(open);
          if (!open) setEditingAllocation(null);
        }}
        onSubmit={submitAllocation}
      />
    </div>
  );
}
