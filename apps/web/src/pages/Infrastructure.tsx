import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TargetAllocation, TargetAllocationInput, TargetInput } from '@/api';
import { useAuth } from '@/auth';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AllocationDialog } from '@/components/organisms/AllocationDialog';
import { AgentSetupDialog } from '@/components/organisms/AgentSetupDialog';
import { AllocationSection } from '@/components/organisms/infrastructure/AllocationSection';
import { TargetSections } from '@/components/organisms/infrastructure/TargetSections';
import { TargetFormDialog } from '@/components/organisms/TargetDialog';
import { Button } from '@/components/ui/button';
import { useInfrastructure } from '@/hooks/useInfrastructure';
import { useAgentProtocol } from '@/hooks/useAgentProtocol';
import type { AgentEnrollment, Target } from '@/types';

export default function Infrastructure() {
  const { activeWorkspace, user } = useAuth();
  const infrastructure = useInfrastructure(activeWorkspace?.id);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [allocationDialogOpen, setAllocationDialogOpen] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<TargetAllocation | null>(null);
  const [agentTarget, setAgentTarget] = useState<Target | null>(null);
  const [agentEnrollment, setAgentEnrollment] = useState<AgentEnrollment | null>(null);
  const agentProtocol = useAgentProtocol(agentTarget);

  const readOnly = !activeWorkspace
    || !['owner', 'admin', 'maintainer'].includes(activeWorkspace.role);
  const canManageAllocations = !!activeWorkspace
    && ['owner', 'admin'].includes(activeWorkspace.role);
  const canManageAgent = canManageAllocations;
  const allocatedTargetIds = new Set(
    infrastructure.allocations.map((allocation) => allocation.targetId),
  );
  const availableAllocationTargets = infrastructure.targets.filter(
    (target) =>
      !allocatedTargetIds.has(target.id) &&
      !(target.scope === 'user' && target.kind === 'docker'),
  );

  useEffect(() => {
    if (!agentTarget) return;
    const refreshed = infrastructure.targets.find((target) => target.id === agentTarget.id);
    if (refreshed && refreshed !== agentTarget) setAgentTarget(refreshed);
  }, [agentTarget, infrastructure.targets]);

  function openNewTarget() {
    setEditingTarget(null);
    setTargetDialogOpen(true);
  }

  function openNewAllocation() {
    setEditingAllocation(null);
    setAllocationDialogOpen(true);
  }

  async function submitTarget(values: TargetInput) {
    const wasNew = !editingTarget;
    const saved = await infrastructure.saveTarget(editingTarget, values);
    if (saved) {
      setTargetDialogOpen(false);
      setEditingTarget(null);
      if (wasNew && saved.kind === 'docker' && canManageAgent) {
        setAgentEnrollment(null);
        setAgentTarget({ ...saved, agent: null });
      }
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
            canManageAgent={canManageAgent}
            busyTargetId={infrastructure.busyTargetId}
            onAdd={openNewTarget}
            onEdit={(target) => {
              setEditingTarget(target);
              setTargetDialogOpen(true);
            }}
            onVerify={infrastructure.verifyTarget}
            onManageAgent={(target) => {
              setAgentEnrollment(null);
              setAgentTarget(target);
            }}
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

      <AgentSetupDialog
        open={!!agentTarget}
        target={agentTarget}
        agent={agentProtocol.agent}
        jobs={agentProtocol.jobs}
        protocolError={agentProtocol.error}
        protocolBusy={agentProtocol.testing}
        busy={!!agentTarget && infrastructure.busyTargetId === agentTarget.id}
        enrollment={agentEnrollment}
        onOpenChange={(open) => {
          if (!open) {
            setAgentEnrollment(null);
            setAgentTarget(null);
          }
        }}
        onIssueEnrollment={() => {
          if (!agentTarget) return;
          void infrastructure.issueAgentEnrollment(agentTarget).then((result) => {
            if (result) setAgentEnrollment(result);
          });
        }}
        onDisable={() => {
          if (!agentTarget) return;
          void infrastructure.disableAgent(agentTarget).then((disabled) => {
            if (disabled) {
              setAgentEnrollment(null);
              setAgentTarget(null);
            }
          });
        }}
        onTestProtocol={() => void agentProtocol.testProtocol()}
      />
    </div>
  );
}
