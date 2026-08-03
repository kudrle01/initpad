import { useEffect, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Button } from '@/components/ui/button';
import { useToast } from '@/toast';
import type { WorkspaceMember, WorkspaceRole } from '@/types';

type AssignableRole = Exclude<WorkspaceRole, 'owner'>;
const ASSIGNABLE_ROLES: Array<{ value: AssignableRole; label: string }> = [
  { value: 'member', label: 'Member' },
  { value: 'maintainer', label: 'Maintainer' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin', label: 'Admin' },
];

export function WorkspaceMembersSettings() {
  const { activeWorkspace } = useAuth();
  const toast = useToast();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [identity, setIdentity] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const canManage = canAdmin && activeWorkspace?.type !== 'personal';

  useEffect(() => {
    if (!activeWorkspace) return;
    let disposed = false;
    setMembers([]);
    setLoading(true);
    setLoadError(null);
    api.listWorkspaceMembers(activeWorkspace.id)
      .then((rows) => {
        if (!disposed) setMembers(rows);
      })
      .catch((error) => {
        if (!disposed) setLoadError((error as Error).message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeWorkspace?.id, reloadKey]);

  async function addMember() {
    if (!activeWorkspace) return;
    try {
      setMembers(await api.addWorkspaceMember(activeWorkspace.id, identity.trim(), role));
      setIdentity('');
      toast.success('Workspace member added');
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function changeRole(member: WorkspaceMember, nextRole: AssignableRole) {
    if (!activeWorkspace) return;
    try {
      setMembers(await api.updateWorkspaceMember(activeWorkspace.id, member.userId, nextRole));
      toast.success(`Updated @${member.username}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (
      !activeWorkspace ||
      !window.confirm(`Remove @${member.username} from ${activeWorkspace.name}?`)
    ) return;
    try {
      await api.removeWorkspaceMember(activeWorkspace.id, member.userId);
      setMembers((rows) => rows.filter((row) => row.userId !== member.userId));
      toast.success(`Removed @${member.username}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <SettingsSection
      icon={Users}
      title="Workspace members"
      description={`${activeWorkspace?.name ?? 'Current workspace'} · your role: ${activeWorkspace?.role ?? '—'}`}
    >
      {canManage && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
          <input
            className="h-9 min-w-0 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder="Username or e-mail"
            aria-label="New member username or e-mail"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
          />
          <select
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            aria-label="New member role"
            value={role}
            onChange={(event) => setRole(event.target.value as AssignableRole)}
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <Button onClick={addMember} disabled={!identity.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      )}

      {activeWorkspace?.type === 'personal' && (
        <p className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
          Personal workspaces stay private. Use “Add new workspace” in the workspace switcher
          to create a shared team space.
        </p>
      )}

      {loadError ? (
        <LoadErrorState
          className="mt-4"
          message={loadError}
          onRetry={() => setReloadKey((value) => value + 1)}
        />
      ) : <div className="mt-4 divide-y divide-border rounded-md border border-border">
        {loading && <p className="p-3 text-sm text-muted-foreground">Loading members…</p>}
        {!loading && members.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No workspace members found.</p>
        )}
        {!loading && members.map((member) => (
          <div key={member.userId} className="flex flex-wrap items-center gap-3 p-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {member.name || `@${member.username}`}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                @{member.username}
              </span>
            </span>
            {canManage && member.role !== 'owner' ? (
              <>
                <select
                  className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                  aria-label={`Role for ${member.username}`}
                  value={member.role}
                  onChange={(event) => changeRole(member, event.target.value as AssignableRole)}
                >
                  {ASSIGNABLE_ROLES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.username}`}
                  onClick={() => removeMember(member)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
                {member.role}
              </span>
            )}
          </div>
        ))}
      </div>}
    </SettingsSection>
  );
}
