import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import { useConfirmation } from '@/confirmation';

export function WorkspaceAdministrationSettings() {
  const { activeWorkspace, refreshWorkspaces } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

  useEffect(() => {
    setName(activeWorkspace?.name ?? '');
  }, [activeWorkspace?.id, activeWorkspace?.name]);

  const workspace = activeWorkspace;
  if (!workspace || workspace.type === 'personal' || !canAdmin) return null;
  const workspaceId = workspace.id;
  const workspaceName = workspace.name;

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
      description: 'A team workspace is the tenant boundary for its members, resources and audit timeline.',
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
    </SettingsSection>
  );
}
