import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/toast';
import { useConfirmation } from '@/confirmation';
import { t } from '@/i18n';

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
  const canChangeApprovalPolicy = activeWorkspace?.role === 'owner';

  useEffect(() => {
    setName(activeWorkspace?.name ?? '');
    setApprovalPolicy(activeWorkspace?.productionApprovalPolicy ?? 'separate-reviewer');
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.productionApprovalPolicy]);

  const workspace = activeWorkspace;
  if (!workspace || workspace.type === 'personal') return null;
  const workspaceId = workspace.id;
  const workspaceName = workspace.name;
  const workspaceApprovalPolicy = workspace.productionApprovalPolicy;

  async function saveName() {
    setBusy(true);
    try {
      await api.updateWorkspace(workspaceId, name.trim());
      await refreshWorkspaces();
      toast.success(t('Workspace renamed'));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkspace() {
    const confirmed = await confirmAction({
      title: t('Delete workspace {workspaceName}?', { workspaceName: workspaceName }),
      description: t(
        'A team workspace is the tenant boundary for its members, resources and audit timeline.',
      ),
      confirmLabel: t('Delete workspace'),
      tone: 'danger',
      requireText: workspaceName,
      consequences: [
        t('Membership and the workspace audit timeline are permanently removed.'),
        t('Deletion succeeds only after all projects, targets and allocations have been removed.'),
        t('The workspace name and slug can then be reused.'),
      ],
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.deleteWorkspace(workspaceId);
      localStorage.removeItem('initpad.workspace');
      await refreshWorkspaces();
      toast.success(t('Workspace deleted'));
      window.location.assign('/');
    } catch (error) {
      toast.error((error as Error).message);
      setBusy(false);
    }
  }

  async function saveApprovalPolicy() {
    if (!canChangeApprovalPolicy) return;
    if (approvalPolicy === 'self-review') {
      const confirmed = await confirmAction({
        title: t('Allow production self-approval?'),
        description: t(
          'A requester who is an owner, admin or maintainer will be able to approve their own production request.',
        ),
        confirmLabel: t('Allow self-approval'),
        tone: 'warning',
        consequences: [
          t('Every production deployment still requires a separate request and approval action.'),
          t('The two-person review requirement will no longer be enforced for this workspace.'),
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
      toast.success(t('Production approval policy updated'));
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
      title={t('Current team workspace')}
      description={workspaceName}
      help={
        canAdmin
          ? [
              {
                title: t('Rename'),
                description: t('Changes the workspace display name.'),
              },
              {
                title: t('Delete'),
                description: t('Available only after its projects and servers have been removed.'),
              },
            ]
          : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {canAdmin && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="workspace-name">{t('Workspace name')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="workspace-name"
                className="sm:max-w-sm sm:flex-1"
                aria-label={t('Current workspace name')}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                variant="secondary"
                onClick={saveName}
                disabled={busy || name.trim().length < 2 || name.trim() === workspaceName}
              >
                {t('Rename')}
              </Button>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="production-approval-policy">{t('Production approval')}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              id="production-approval-policy"
              className="sm:max-w-sm sm:flex-1"
              value={approvalPolicy}
              disabled={busy || !canChangeApprovalPolicy}
              onChange={(event) => setApprovalPolicy(event.target.value as typeof approvalPolicy)}
            >
              <option value="separate-reviewer">{t('Require a different reviewer')}</option>
              <option value="self-review">{t('Allow self-approval')}</option>
            </Select>
            {canChangeApprovalPolicy && (
              <Button
                variant="secondary"
                disabled={busy || approvalPolicy === workspaceApprovalPolicy}
                onClick={() => void saveApprovalPolicy()}
              >
                {t('Update policy')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {canChangeApprovalPolicy
              ? t('Who may approve a production deployment request in this workspace.')
              : t('Only the workspace owner can change this policy.')}
          </p>
        </div>

        {canAdmin && workspace.role === 'owner' && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/25 bg-destructive/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('Delete this workspace')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('Possible only after its projects and servers have been removed.')}
              </p>
            </div>
            <Button
              variant="destructive"
              className="shrink-0"
              disabled={busy}
              onClick={() => void deleteWorkspace()}
            >
              {t('Delete empty workspace')}
            </Button>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
