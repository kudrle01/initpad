import { useEffect, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { List, ListRow } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Notice } from '@/components/molecules/Notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/toast';
import { useConfirmation } from '@/confirmation';
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
  const confirmAction = useConfirmation();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [identity, setIdentity] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [adding, setAdding] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const canManage = canAdmin && activeWorkspace?.type !== 'personal';
  const activeWorkspaceId = activeWorkspace?.id;

  useEffect(() => {
    if (!activeWorkspaceId) return;
    let disposed = false;
    setMembers([]);
    setLoading(true);
    setLoadError(null);
    api
      .listWorkspaceMembers(activeWorkspaceId)
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
  }, [activeWorkspaceId, reloadKey]);

  async function addMember() {
    if (!activeWorkspace) return;
    if (role === 'admin') {
      const confirmed = await confirmAction({
        title: `Add ${identity.trim()} as workspace admin?`,
        description: `Administrators can manage members and infrastructure in ${activeWorkspace.name}.`,
        confirmLabel: 'Add workspace admin',
        tone: 'warning',
        consequences: [
          'This account receives elevated workspace permissions immediately.',
          'The workspace owner can later change or remove the role.',
        ],
      });
      if (!confirmed) return;
    }
    setAdding(true);
    try {
      setMembers(await api.addWorkspaceMember(activeWorkspace.id, identity.trim(), role));
      setIdentity('');
      toast.success('Workspace member added');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(member: WorkspaceMember, nextRole: AssignableRole) {
    if (!activeWorkspace || nextRole === member.role) return;
    const confirmed = await confirmAction({
      title: `Change @${member.username}'s role?`,
      description:
        'Workspace role changes take effect immediately across projects and infrastructure.',
      confirmLabel: `Change role to ${nextRole}`,
      tone: 'warning',
      details: [
        { label: 'Current role', value: member.role },
        { label: 'New role', value: nextRole },
      ],
      consequences: [
        nextRole === 'admin'
          ? 'The member gains permission to manage workspace membership and infrastructure.'
          : nextRole === 'maintainer'
            ? 'The member can maintain deployments and review production requests without workspace administration rights.'
            : 'The member may immediately lose access to actions allowed by the current role.',
        'Private repository access is reconciled to the new role.',
      ],
    });
    if (!confirmed) return;
    setBusyMemberId(member.userId);
    try {
      setMembers(await api.updateWorkspaceMember(activeWorkspace.id, member.userId, nextRole));
      toast.success(`Updated @${member.username}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!activeWorkspace) return;
    const confirmed = await confirmAction({
      title: `Remove @${member.username} from ${activeWorkspace.name}?`,
      description:
        'The user account remains active, but its access to this team workspace is revoked.',
      confirmLabel: 'Remove member',
      tone: 'danger',
      consequences: [
        'Workspace projects, infrastructure and audit events are no longer visible to this member.',
        'Private repository access is removed during reconciliation.',
      ],
    });
    if (!confirmed) return;
    setBusyMemberId(member.userId);
    try {
      await api.removeWorkspaceMember(activeWorkspace.id, member.userId);
      setMembers((rows) => rows.filter((row) => row.userId !== member.userId));
      toast.success(`Removed @${member.username}`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyMemberId(null);
    }
  }

  return (
    <SettingsSection
      icon={Users}
      title="Workspace members"
      description="People who can see and work on this workspace's projects."
      flush
    >
      {canManage && (
        <div className="border-b border-border/70 bg-muted/50 px-4 py-4 sm:px-6">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
            <Input
              placeholder="Username or e-mail"
              aria-label="New member username or e-mail"
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && identity.trim() && !adding) void addMember();
              }}
            />
            <Select
              aria-label="New member role"
              value={role}
              onChange={(event) => setRole(event.target.value as AssignableRole)}
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button onClick={() => void addMember()} disabled={adding || !identity.trim()}>
              <Plus className="h-4 w-4" /> Add member
            </Button>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            Maintainers can manage deployments, rollbacks and production reviews without managing
            workspace membership or policy.
          </p>
        </div>
      )}

      {activeWorkspace?.type === 'personal' && (
        <div className="border-b border-border/70 px-4 py-4 sm:px-6">
          <Notice>
            Personal workspaces stay private. Use “Add new workspace” in the workspace switcher to
            create a shared team space.
          </Notice>
        </div>
      )}

      {loadError ? (
        <div className="p-4 sm:p-6">
          <LoadErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
        </div>
      ) : loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">Loading members…</p>
      ) : members.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          No workspace members found.
        </p>
      ) : (
        <List>
          {members.map((member) => (
            <ListRow key={member.userId}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {(member.name || member.username).slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium"
                  title={member.name || `@${member.username}`}
                >
                  {member.name || `@${member.username}`}
                </span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={`@${member.username}`}
                >
                  @{member.username}
                </span>
              </span>
              {canManage && member.role !== 'owner' ? (
                <>
                  <Select
                    className="w-32 shrink-0"
                    aria-label={`Role for ${member.username}`}
                    value={member.role}
                    disabled={busyMemberId === member.userId}
                    onChange={(event) =>
                      void changeRole(member, event.target.value as AssignableRole)
                    }
                  >
                    {ASSIGNABLE_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${member.username}`}
                    title={`Remove ${member.username}`}
                    disabled={busyMemberId === member.userId}
                    onClick={() => void removeMember(member)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Badge variant={member.role === 'owner' ? 'brand' : 'default'}>{member.role}</Badge>
              )}
            </ListRow>
          ))}
        </List>
      )}
    </SettingsSection>
  );
}
