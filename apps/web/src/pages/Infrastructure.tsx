import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TargetAllocation, TargetAllocationInput, TargetInput } from '@/api';
import { useAuth } from '@/auth';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AllocationDialog } from '@/components/organisms/AllocationDialog';
import { AgentSetupDialog } from '@/components/organisms/AgentSetupDialog';
import { InfrastructureTargetList } from '@/components/organisms/infrastructure/InfrastructureTargetList';
import { TargetFormDialog } from '@/components/organisms/TargetDialog';
import { Button } from '@/components/ui/button';
import { useInfrastructure } from '@/hooks/useInfrastructure';
import { useAgentProtocol } from '@/hooks/useAgentProtocol';
import { useConfirmation } from '@/confirmation';
import type { AgentEnrollment, Target } from '@/types';

function sameCapabilities(left: string[], right: string[]): boolean {
  return [...left].sort().join(',') === [...right].sort().join(',');
}

function changedTargetSettings(target: Target, values: TargetInput): string[] {
  const fields: string[] = [];
  if (!sameCapabilities(target.capabilities, values.capabilities)) fields.push('runtime capabilities');
  if (target.publicUrl !== values.publicUrl) fields.push('public URL');
  if ((target.routingMode ?? 'direct-port') !== (values.routingMode ?? 'direct-port')) fields.push('routing mode');
  if (target.kind !== 'docker') {
    if ((target.host ?? '') !== (values.host ?? '')) fields.push('host');
    if ((target.port ?? 22) !== (values.port ?? 22)) fields.push('port');
    if ((target.username ?? '') !== (values.username ?? '')) fields.push('username');
    if ((target.auth ?? 'password') !== (values.auth ?? 'password')) fields.push('authentication method');
    if (values.secret) fields.push('authentication credentials');
    if ((target.hostKeyFingerprint ?? '') !== (values.hostKeyFingerprint ?? '')) fields.push('host key fingerprint');
    if ((target.remotePath ?? '') !== (values.remotePath ?? '')) fields.push('remote path');
  }
  return fields;
}

function changedAllocationSettings(
  allocation: TargetAllocation,
  values: TargetAllocationInput,
): string[] {
  const fields: string[] = [];
  if (!sameCapabilities(allocation.capabilities, values.capabilities)) fields.push('runtime capabilities');
  if (values.publicUrl !== undefined && allocation.publicUrl !== values.publicUrl) fields.push('public URL');
  if (allocation.maxEnvironments !== values.maxEnvironments) fields.push('environment quota');
  if (allocation.cpuLimitMillicores !== values.cpuLimitMillicores) fields.push('CPU limit');
  if (allocation.memoryLimitMb !== values.memoryLimitMb) fields.push('memory limit');
  if (allocation.pidsLimit !== values.pidsLimit) fields.push('process limit');
  if (allocation.devTtlHours !== (values.devTtlHours ?? null)) fields.push('dev lifetime');
  if (allocation.testTtlHours !== (values.testTtlHours ?? null)) fields.push('test lifetime');
  return fields;
}

export default function Infrastructure() {
  const { activeWorkspace } = useAuth();
  const confirmAction = useConfirmation();
  const infrastructure = useInfrastructure(activeWorkspace?.id);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [allocationDialogOpen, setAllocationDialogOpen] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<TargetAllocation | null>(null);
  const [allocationTarget, setAllocationTarget] = useState<Target | null>(null);
  const [agentTarget, setAgentTarget] = useState<Target | null>(null);
  const [agentEnrollment, setAgentEnrollment] = useState<AgentEnrollment | null>(null);
  const agentProtocol = useAgentProtocol(agentTarget);
  const lastGatewayRefreshJob = useRef<string | null>(null);

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
      (target.managementState ?? 'active') === 'active',
  );

  useEffect(() => {
    if (!agentTarget) return;
    const refreshed = infrastructure.targets.find((target) => target.id === agentTarget.id);
    if (refreshed && refreshed !== agentTarget) setAgentTarget(refreshed);
  }, [agentTarget, infrastructure.targets]);

  useEffect(() => {
    const terminal = agentProtocol.jobs.find((job) =>
      job.kind === 'gateway-preflight' && ['succeeded', 'failed'].includes(job.status));
    if (!terminal || terminal.id === lastGatewayRefreshJob.current) return;
    lastGatewayRefreshJob.current = terminal.id;
    void infrastructure.reload();
  }, [agentProtocol.jobs, infrastructure.reload]);

  useEffect(() => {
    if (!agentEnrollment) return;

    // The plaintext is useful only while this exact one-time enrollment can
    // still be redeemed. A successful enrollment advances the credential
    // generation; expiry must remove the secret even if the dialog stays open.
    if (
      agentProtocol.agent?.targetId === agentEnrollment.targetId
      && agentProtocol.agent.credentialGeneration > agentEnrollment.credentialGeneration
    ) {
      setAgentEnrollment(null);
      return;
    }

    const remainingMs = new Date(agentEnrollment.enrollmentExpiresAt!).getTime() - Date.now();
    if (remainingMs <= 0) {
      setAgentEnrollment(null);
      return;
    }

    const timeout = window.setTimeout(() => setAgentEnrollment(null), remainingMs);
    return () => window.clearTimeout(timeout);
  }, [
    agentEnrollment,
    agentProtocol.agent?.credentialGeneration,
    agentProtocol.agent?.targetId,
  ]);

  function openNewTarget() {
    setEditingTarget(null);
    setTargetDialogOpen(true);
  }

  function openNewAllocation(target: Target) {
    setEditingAllocation(null);
    setAllocationTarget(target);
    setAllocationDialogOpen(true);
  }

  async function submitTarget(values: TargetInput) {
    const wasNew = !editingTarget;
    if (editingTarget) {
      const changedSettings = changedTargetSettings(editingTarget, values);
      if (changedSettings.length > 0) {
        const confirmed = await confirmAction({
          title: `Save changes to ${editingTarget.name}?`,
          description: 'Target settings control where and how future deployments are published.',
          confirmLabel: 'Save server changes',
          tone: 'warning',
          details: [{ label: 'Changed settings', value: changedSettings.join(', ') }],
          consequences: [
            'Existing running deployments are not moved automatically.',
            editingTarget.kind === 'docker'
              ? 'Routing changes reset gateway readiness and require a new preflight.'
              : 'Connection or runtime changes clear the previous verification and must be tested again.',
          ],
        });
        if (!confirmed) return;
      }
    }
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
    if (editingAllocation) {
      const changedSettings = changedAllocationSettings(editingAllocation, values);
      if (changedSettings.length > 0) {
        const confirmed = await confirmAction({
          title: `Save workspace access changes for ${editingAllocation.targetName}?`,
          description: 'Workspace access controls how this workspace may use the deployment server.',
          confirmLabel: 'Save access changes',
          tone: 'warning',
          details: [
            { label: 'Namespace', value: editingAllocation.namespace },
            { label: 'Changed settings', value: changedSettings.join(', ') },
          ],
          consequences: [
            'New deployments immediately use the updated capabilities, quota and URL.',
            'Existing running workloads are not restarted by this change.',
          ],
        });
        if (!confirmed) return;
      }
    }
    if (await infrastructure.saveAllocation(editingAllocation, values)) {
      setAllocationDialogOpen(false);
      setEditingAllocation(null);
      setAllocationTarget(null);
    }
  }

  async function deleteTarget(target: Target) {
    const confirmed = await confirmAction({
      title: `Delete server ${target.name}?`,
      description: 'InitPad will forget this server connection. The physical server itself is never deleted.',
      confirmLabel: 'Delete server',
      tone: 'danger',
      details: [
        { label: 'Server', value: target.name },
        { label: 'Type', value: target.kind.toUpperCase() },
      ],
      consequences: [
        'Stored connection settings, workspace access and any Agent identity are permanently removed from InitPad.',
        'You must add and verify or enroll the server again before reusing it.',
      ],
    });
    if (confirmed) await infrastructure.deleteTarget(target);
  }

  async function disconnectTarget(target: Target) {
    const usage = target.usage ?? [];
    const confirmed = await confirmAction({
      title: `Disconnect ${target.name} from InitPad?`,
      description: 'Management access is revoked without sending a teardown command to the server.',
      confirmLabel: 'Disconnect server',
      tone: 'danger',
      details: [
        { label: 'Server', value: target.name },
        { label: 'Bound environments', value: usage.length },
      ],
      consequences: [
        'Existing applications and their public URLs are left untouched.',
        target.kind === 'docker'
          ? 'The Agent credential and unused enrollment token are revoked.'
          : 'The stored SSH/SFTP credential is permanently removed.',
        'Deploy, start, stop, diagnostics and cleanup remain unavailable until this server is reconnected.',
      ],
    });
    if (confirmed) await infrastructure.disconnectTarget(target);
  }

  async function retireTarget(target: Target) {
    const usage = target.usage ?? [];
    const confirmed = await confirmAction({
      title: `Retire ${target.name} as unmanaged?`,
      description: 'Use this when the server and its applications should remain, but InitPad must stop managing them.',
      confirmLabel: 'Retire server',
      tone: 'danger',
      requireText: target.name,
      details: [{ label: 'Environments retained', value: usage.length }],
      consequences: [
        'All management credentials are revoked and cannot be recovered.',
        'Existing workload records, URLs and deployment history remain visible as unmanaged.',
        'Restore the server and provide a new credential or Agent enrollment to manage it again.',
      ],
    });
    if (confirmed) await infrastructure.retireTarget(target);
  }

  async function restoreTarget(target: Target) {
    await infrastructure.restoreTarget(target);
  }

  async function toggleAllocation(allocation: TargetAllocation) {
    if (allocation.status === 'active') {
      const confirmed = await confirmAction({
        title: `Pause workspace access to ${allocation.targetName}?`,
        description: `The ${allocation.namespace} workspace namespace will stop accepting deployments on this server.`,
        confirmLabel: 'Pause access',
        tone: 'warning',
        consequences: [
          'Existing running workloads remain untouched.',
          'New deploys through this workspace access are blocked until it is resumed.',
        ],
      });
      if (!confirmed) return;
    }
    await infrastructure.toggleAllocation(allocation);
  }

  async function deleteAllocation(allocation: TargetAllocation) {
    const confirmed = await confirmAction({
      title: `Remove workspace access to ${allocation.targetName}?`,
      description: 'This removes the workspace namespace and quota, not the physical server.',
      confirmLabel: 'Remove access',
      tone: 'danger',
      details: [
        { label: 'Namespace', value: allocation.namespace },
        { label: 'Server', value: allocation.targetName },
      ],
      consequences: [
        'The workspace loses this namespace, quota and its allowed runtimes on the server.',
        'Workspace access must be enabled again before deploying to this server.',
      ],
    });
    if (confirmed) await infrastructure.deleteAllocation(allocation);
  }

  return (
    <div>
      <PageHeader
        title="Servers"
        actions={!readOnly ? (
          <Button onClick={openNewTarget}>
            <Plus className="h-4 w-4" /> Add server
          </Button>
        ) : undefined}
      />

      {infrastructure.error ? (
        <LoadErrorState message={infrastructure.error} onRetry={infrastructure.reload} />
      ) : infrastructure.loading ? (
        <ContentLoading label="Loading servers" variant="cards" />
      ) : (
        <InfrastructureTargetList
          targets={infrastructure.targets}
          allocations={infrastructure.allocations}
          workspaceName={activeWorkspace?.name ?? 'this workspace'}
          readOnly={readOnly}
          canManageAgent={canManageAgent}
          canManageLifecycle={canManageAllocations}
          canManageAccess={canManageAllocations}
          busyTargetId={infrastructure.busyTargetId}
          busyAllocationId={infrastructure.busyAllocationId}
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
          onDelete={(target) => void deleteTarget(target)}
          onDisconnect={(target) => void disconnectTarget(target)}
          onRetire={(target) => void retireTarget(target)}
          onRestore={(target) => void restoreTarget(target)}
          onEnableAccess={openNewAllocation}
          onEditAccess={(allocation) => {
            setEditingAllocation(allocation);
            setAllocationTarget(null);
            setAllocationDialogOpen(true);
          }}
          onToggleAccess={(allocation) => void toggleAllocation(allocation)}
          onRemoveAccess={(allocation) => void deleteAllocation(allocation)}
        />
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
          : allocationTarget ? [allocationTarget] : availableAllocationTargets}
        busy={infrastructure.savingAllocation}
        onOpenChange={(open) => {
          setAllocationDialogOpen(open);
          if (!open) {
            setEditingAllocation(null);
            setAllocationTarget(null);
          }
        }}
        onSubmit={submitAllocation}
      />

      <AgentSetupDialog
        open={!!agentTarget}
        target={agentTarget}
        agent={agentProtocol.agent}
        jobs={agentProtocol.jobs}
        protocolError={agentProtocol.error}
        testBusy={agentProtocol.testing}
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
        onTestLifecycle={() => {
          void agentProtocol.testLifecycle().then((queued) => {
            if (queued) void infrastructure.reload();
          });
        }}
        onTestGateway={() => {
          void agentProtocol.testGateway().then((queued) => {
            if (queued) void infrastructure.reload();
          });
        }}
      />
    </div>
  );
}
