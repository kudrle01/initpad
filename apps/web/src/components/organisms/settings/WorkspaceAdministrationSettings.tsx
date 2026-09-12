import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/toast';
import { useConfirmation } from '@/confirmation';

export function WorkspaceAdministrationSettings() {
  const { activeWorkspace, refreshWorkspaces } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<'self-review' | 'separate-reviewer'>(
    'separate-reviewer',
  );
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

  useEffect(() => {
    setName(activeWorkspace?.name ?? '');
    setApprovalPolicy(activeWorkspace?.productionApprovalPolicy ?? 'separate-reviewer');
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.productionApprovalPolicy]);

  const workspace = activeWorkspace;
  if (!workspace || workspace.type === 'personal' || !canAdmin) return null;
  const workspaceId = workspace.id;
  const workspaceName = workspace.name;
  const workspaceApprovalPolicy = workspace.productionApprovalPolicy;

  async function saveName() {
    setBusy(true);
    try {
      await api.updateWorkspace(workspaceId, name.trim());
      await refreshWorkspaces();
      toast.success('Workspace renamed');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkspace() {
    const confirmed = await confirmAction({
      title: `Delete workspace ${workspaceName}?`,
      description:
        'A team workspace is the tenant boundary for its members, resources and audit timeline.',
      confirmLabel: 'Delete workspace',
      tone: 'danger',
      requireText: workspaceName,
      consequences: [
        'Membership and the workspace audit timeline are permanently removed.',
        'Deletion succeeds only after all projects, targets and allocations have been removed.',
        'The workspace name and slug can then be reused.',
      ],
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.deleteWorkspace(workspaceId);
      localStorage.removeItem('initpad.workspace');
      await refreshWorkspaces();
      toast.success('Workspace deleted');
      window.location.assign('/');
    } catch (error) {
      toast.error((error as Error).message);
      setBusy(false);
    }
  }

  async function saveApprovalPolicy() {
    if (approvalPolicy === 'self-review') {
      const confirmed = await confirmAction({
        title: 'Allow production self-approval?',
        description:
          'A requester with workspace admin rights will be able to approve their own production request.',
        confirmLabel: 'Allow self-approval',
        tone: 'warning',
        consequences: [
          'Every production deployment still requires a separate request and approval action.',
          'The two-person review requirement will no longer be enforced for this workspace.',
        ],
      });
      if (!confirmed) {
        setApprovalPolicy(workspaceApprovalPolicy);
        return;
      }
    }
    setBusy(true);
    try {
      await api.updateProductionApprovalPolicy(workspaceId, approvalPolicy);
      await refreshWorkspaces();
      toast.success('Production approval policy updated');
    } catch (error) {
      setApprovalPolicy(workspaceApprovalPolicy);
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      icon={Building2}
      title="Current team workspace"
      help={[
        {
          title: 'Rename',
          description: 'Changes the workspace display name.',
        },
        {
          title: 'Delete',
          description: 'Available only after its projects and servers have been removed.',
        },
      ]}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm sm:h-9"
          aria-label="Current workspace name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          variant="secondary"
          onClick={saveName}
          disabled={busy || name.trim().length < 2 || name.trim() === workspaceName}
        >
          Rename
        </Button>
        {workspace.role === 'owner' && (
          <Button variant="destructive" disabled={busy} onClick={() => void deleteWorkspace()}>
            Delete empty workspace
          </Button>
        )}
      </div>
      <div className="mt-4 max-w-xl border-t border-border pt-4">
        <label htmlFor="production-approval-policy" className="text-sm font-medium">
          Production approval
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Select
            id="production-approval-policy"
            value={approvalPolicy}
            disabled={busy}
            onChange={(event) => setApprovalPolicy(event.target.value as typeof approvalPolicy)}
          >
            <option value="separate-reviewer">Require a different reviewer</option>
            <option value="self-review">Allow self-approval</option>
          </Select>
          <Button
            variant="secondary"
            disabled={busy || approvalPolicy === workspaceApprovalPolicy}
            onClick={() => void saveApprovalPolicy()}
          >
            Update policy
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
