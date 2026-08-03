import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';

export function WorkspaceAdministrationSettings() {
  const { activeWorkspace, refreshWorkspaces } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

  useEffect(() => {
    setName(activeWorkspace?.name ?? '');
  }, [activeWorkspace?.id, activeWorkspace?.name]);

  const workspace = activeWorkspace;
  if (!workspace || workspace.type === 'personal' || !canAdmin) return null;
  const workspaceId = workspace.id;
  const workspaceName = workspace.name;

  async function saveName() {
    try {
      await api.updateWorkspace(workspaceId, name.trim());
      await refreshWorkspaces();
      toast.success('Workspace renamed');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function deleteWorkspace() {
    if (!window.confirm(`Delete empty workspace ${workspaceName}?`)) return;
    try {
      await api.deleteWorkspace(workspaceId);
      localStorage.removeItem('initpad.workspace');
      await refreshWorkspaces();
      toast.success('Workspace deleted');
      window.location.assign('/');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <SettingsSection
      icon={Building2}
      title="Current team workspace"
      description="Rename this workspace or delete it after all of its projects and targets are removed."
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
          disabled={name.trim().length < 2 || name.trim() === workspaceName}
        >
          Rename
        </Button>
        {workspace.role === 'owner' && (
          <Button variant="destructive" onClick={deleteWorkspace}>
            Delete empty workspace
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
