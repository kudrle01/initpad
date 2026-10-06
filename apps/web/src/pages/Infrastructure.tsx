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
import { t } from '@/i18n';

function sameCapabilities(left: string[], right: string[]): boolean {
  return [...left].sort().join(',') === [...right].sort().join(',');
}

function changedTargetSettings(target: Target, values: TargetInput): string[] {
  const fields: string[] = [];
  if (!sameCapabilities(target.capabilities, values.capabilities))
    fields.push(t('runtime capabilities'));
  if (target.publicUrl !== values.publicUrl) fields.push(t('public URL'));
  if ((target.routingMode ?? 'direct-port') !== (values.routingMode ?? 'direct-port'))
    fields.push(t('routing mode'));
  if (target.kind !== 'docker') {
    if ((target.host ?? '') !== (values.host ?? '')) fields.push(t('host'));
    if ((target.port ?? 22) !== (values.port ?? 22)) fields.push(t('port'));
    if ((target.username ?? '') !== (values.username ?? '')) fields.push(t('username'));
    if ((target.auth ?? 'password') !== (values.auth ?? 'password'))
      fields.push(t('authentication method'));
    if (values.secret) fields.push(t('authentication credentials'));
    if ((target.hostKeyFingerprint ?? '') !== (values.hostKeyFingerprint ?? ''))
      fields.push(t('host key fingerprint'));
    if ((target.remotePath ?? '') !== (values.remotePath ?? '')) fields.push(t('remote path'));
  }
  return fields;
}

function changedAllocationSettings(
  allocation: TargetAllocation,
  values: TargetAllocationInput,
): string[] {
  const fields: string[] = [];
  if (!sameCapabilities(allocation.capabilities, values.capabilities))
    fields.push(t('runtime capabilities'));
  if (values.publicUrl !== undefined && allocation.publicUrl !== values.publicUrl)
    fields.push(t('public URL'));
  if (allocation.maxEnvironments !== values.maxEnvironments) fields.push(t('environment quota'));
  if (allocation.cpuLimitMillicores !== values.cpuLimitMillicores) fields.push(t('CPU limit'));
  if (allocation.memoryLimitMb !== values.memoryLimitMb) fields.push(t('memory limit'));
  if (allocation.pidsLimit !== values.pidsLimit) fields.push(t('process limit'));
  if (allocation.devTtlHours !== (values.devTtlHours ?? null)) fields.push(t('dev lifetime'));
  if (allocation.testTtlHours !== (values.testTtlHours ?? null)) fields.push(t('test lifetime'));
  return fields;
}

export default function Infrastructure() {
  const { activeWorkspace } = useAuth();
  const confirmAction = useConfirmation();
  const infrastructure = useInfrastructure(activeWorkspace?.id);
  const { reload: reloadInfrastructure } = infrastructure;
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [allocationDialogOpen, setAllocationDialogOpen] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<TargetAllocation | null>(null);
  const [allocationTarget, setAllocationTarget] = useState<Target | null>(null);
  const [agentTarget, setAgentTarget] = useState<Target | null>(null);
  const [agentEnrollment, setAgentEnrollment] = useState<AgentEnrollment | null>(null);
  const agentProtocol = useAgentProtocol(agentTarget);
  const lastGatewayRefreshJob = useRef<string | null>(null);

  const readOnly =
    !activeWorkspace || !['owner', 'admin', 'maintainer'].includes(activeWorkspace.role);
  const canManageAllocations =
    !!activeWorkspace && ['owner', 'admin'].includes(activeWorkspace.role);
  const canManageAgent = canManageAllocations;
  const allocatedTargetIds = new Set(
    infrastructure.allocations.map((allocation) => allocation.targetId),
  );
  const availableAllocationTargets = infrastructure.targets.filter(
    (target) =>
      !allocatedTargetIds.has(target.id) && (target.managementState ?? 'active') === 'active',
  );

  useEffect(() => {
    if (!agentTarget) return;
    const refreshed = infrastructure.targets.find((target) => target.id === agentTarget.id);
    if (refreshed && refreshed !== agentTarget) setAgentTarget(refreshed);
  }, [agentTarget, infrastructure.targets]);

  useEffect(() => {
    const terminal = agentProtocol.jobs.find(
      (job) => job.kind === 'gateway-preflight' && ['succeeded', 'failed'].includes(job.status),
    );
    if (!terminal || terminal.id === lastGatewayRefreshJob.current) return;
    lastGatewayRefreshJob.current = terminal.id;
    void reloadInfrastructure();
  }, [agentProtocol.jobs, reloadInfrastructure]);

  useEffect(() => {
    if (!agentEnrollment) return;

    // The plaintext is useful only while this exact one-time enrollment can
    // still be redeemed. A successful enrollment advances the credential
    // generation; expiry must remove the secret even if the dialog stays open.
    if (
      agentProtocol.agent?.targetId === agentEnrollment.targetId &&
      agentProtocol.agent.credentialGeneration > agentEnrollment.credentialGeneration
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
  }, [agentEnrollment, agentProtocol.agent?.credentialGeneration, agentProtocol.agent?.targetId]);

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
          title: t('Save changes to {name}?', { name: editingTarget.name }),
          description: t('Target settings control where and how future deployments are published.'),
          confirmLabel: t('Save server changes'),
          tone: 'warning',
          details: [{ label: t('Changed settings'), value: changedSettings.join(', ') }],
          consequences: [
            t('Existing running deployments are not moved automatically.'),
            editingTarget.kind === 'docker'
              ? t('Routing changes reset gateway readiness and require a new preflight.')
              : t(
                  'Connection or runtime changes clear the previous verification and must be tested again.',
                ),
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
          title: t('Save workspace access changes for {targetName}?', {
            targetName: editingAllocation.targetName,
          }),
          description: t(
            'Workspace access controls how this workspace may use the deployment server.',
          ),
          confirmLabel: t('Save access changes'),
          tone: 'warning',
          details: [
            { label: t('Namespace'), value: editingAllocation.namespace },
            { label: t('Changed settings'), value: changedSettings.join(', ') },
          ],
          consequences: [
            t('New deployments immediately use the updated capabilities, quota and URL.'),
            t('Existing running workloads are not restarted by this change.'),
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
      title: t('Delete server {name}?', { name: target.name }),
      description: t(
        'InitPad will forget this server connection. The physical server itself is never deleted.',
      ),
      confirmLabel: t('Delete server'),
      tone: 'danger',
      details: [
        { label: t('Server'), value: target.name },
        { label: t('Type'), value: target.kind.toUpperCase() },
      ],
      consequences: [
        t(
          'Stored connection settings, workspace access and any Agent identity are permanently removed from InitPad.',
        ),
        t('You must add and verify or enroll the server again before reusing it.'),
      ],
    });
    if (confirmed) await infrastructure.deleteTarget(target);
  }

  async function disconnectTarget(target: Target) {
    const usage = target.usage ?? [];
    const confirmed = await confirmAction({
      title: t('Disconnect {name} from InitPad?', { name: target.name }),
      description: t(
        'Management access is revoked without sending a teardown command to the server.',
      ),
      confirmLabel: t('Disconnect server'),
      tone: 'danger',
      details: [
        { label: t('Server'), value: target.name },
        { label: t('Bound environments'), value: usage.length },
      ],
      consequences: [
        t('Existing applications and their public URLs are left untouched.'),
        target.kind === 'docker'
          ? t('The Agent credential and unused enrollment token are revoked.')
          : t('The stored SFTP credential is permanently removed.'),
        t(
          'Deploy, start, stop, diagnostics and cleanup remain unavailable until this server is reconnected.',
        ),
      ],
    });
    if (confirmed) await infrastructure.disconnectTarget(target);
  }

  async function retireTarget(target: Target) {
    const usage = target.usage ?? [];
    const confirmed = await confirmAction({
      title: t('Retire {name} as unmanaged?', { name: target.name }),
      description: t(
        'Use this when the server and its applications should remain, but InitPad must stop managing them.',
      ),
      confirmLabel: t('Retire server'),
      tone: 'danger',
      requireText: target.name,
      details: [{ label: t('Environments retained'), value: usage.length }],
      consequences: [
        t('All management credentials are revoked and cannot be recovered.'),
        t('Existing workload records, URLs and deployment history remain visible as unmanaged.'),
        t(
          'Restore the server and provide a new credential or Agent enrollment to manage it again.',
        ),
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
        title: t('Pause workspace access to {targetName}?', { targetName: allocation.targetName }),
        description: t(
          'The {namespace} workspace namespace will stop accepting deployments on this server.',
          { namespace: allocation.namespace },
        ),
        confirmLabel: t('Pause access'),
        tone: 'warning',
        consequences: [
          t('Existing running workloads remain untouched.'),
          t('New deploys through this workspace access are blocked until it is resumed.'),
        ],
      });
      if (!confirmed) return;
    }
    await infrastructure.toggleAllocation(allocation);
  }

  async function deleteAllocation(allocation: TargetAllocation) {
    const confirmed = await confirmAction({
      title: t('Remove workspace access to {targetName}?', { targetName: allocation.targetName }),
      description: t('This removes the workspace namespace and quota, not the physical server.'),
      confirmLabel: t('Remove access'),
      tone: 'danger',
      details: [
        { label: t('Namespace'), value: allocation.namespace },
        { label: t('Server'), value: allocation.targetName },
      ],
      consequences: [
        t('The workspace loses this namespace, quota and its allowed runtimes on the server.'),
        t('Workspace access must be enabled again before deploying to this server.'),
      ],
    });
    if (confirmed) await infrastructure.deleteAllocation(allocation);
  }

  return (
    <div>
      <PageHeader
        title={t('Servers')}
        description={t(
          'Machines and hosting that receive deployments, and what this workspace may use on each.',
        )}
        actions={
          !readOnly ? (
            <Button onClick={openNewTarget}>
              <Plus className="h-4 w-4" /> {t('Add server')}
            </Button>
          ) : undefined
        }
      />

      {infrastructure.error ? (
        <LoadErrorState message={infrastructure.error} onRetry={infrastructure.reload} />
      ) : infrastructure.loading ? (
        <ContentLoading label={t('Loading servers')} />
      ) : (
        <InfrastructureTargetList
          targets={infrastructure.targets}
          allocations={infrastructure.allocations}
          workspaceName={activeWorkspace?.name ?? t('this workspace')}
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
        targets={
          editingAllocation
            ? infrastructure.targets.filter((target) => target.id === editingAllocation.targetId)
            : allocationTarget
              ? [allocationTarget]
              : availableAllocationTargets
        }
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
        onUpdateAgent={() => void agentProtocol.updateAgent()}
      />
    </div>
  );
}
