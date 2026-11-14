import { useEffect, useState } from 'react';
import { Crown, LogOut, Plus, Trash2, Users } from 'lucide-react';
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
import { t, msg, type MessageKey } from '@/i18n';
import { roleLabel } from '@/i18n/labels';

type AssignableRole = Exclude<WorkspaceRole, 'owner'>;
const ASSIGNABLE_ROLES: Array<{ value: AssignableRole; label: MessageKey }> = [
  { value: 'member', label: msg('Member') },
  { value: 'maintainer', label: msg('Maintainer') },
  { value: 'viewer', label: msg('Viewer') },
  { value: 'admin', label: msg('Admin') },
];

export function WorkspaceMembersSettings() {
  const { activeWorkspace, refreshWorkspaces } = useAuth();
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
  const isTeam = activeWorkspace?.type === 'team';
  const canManage = canAdmin && isTeam;
  const isOwner = activeWorkspace?.role === 'owner';
  const [leaving, setLeaving] = useState(false);
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
        title: t('Add {identity} as workspace admin?', { identity: identity.trim() }),
        description: t('Administrators can manage members and infrastructure in {name}.', {
          name: activeWorkspace.name,
        }),
        confirmLabel: t('Add workspace admin'),
        tone: 'warning',
        consequences: [
          t('This account receives elevated workspace permissions immediately.'),
          t('The workspace owner can later change or remove the role.'),
        ],
      });
      if (!confirmed) return;
    }
    setAdding(true);
    try {
      // The API answers the same whether or not the account exists, so the
      // message cannot confirm that someone was added.
      setMembers(await api.addWorkspaceMember(activeWorkspace.id, identity.trim(), role));
      toast.success(
        t('If an account matches {identity}, it is now a member of this workspace.', {
          identity: identity.trim(),
        }),
      );
      setIdentity('');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function changeRole(member: WorkspaceMember, nextRole: AssignableRole) {
    if (!activeWorkspace || nextRole === member.role) return;
    const confirmed = await confirmAction({
      title: t("Change @{username}'s role?", { username: member.username }),
      description: t(
        'Workspace role changes take effect immediately across projects and infrastructure.',
      ),
      confirmLabel: t('Change role to {role}', { role: roleLabel(nextRole) }),
      tone: 'warning',
      details: [
        { label: t('Current role'), value: roleLabel(member.role) },
        { label: t('New role'), value: roleLabel(nextRole) },
      ],
      consequences: [
        nextRole === 'admin'
          ? t('The member gains permission to manage workspace membership and infrastructure.')
          : nextRole === 'maintainer'
            ? t(
                'The member can maintain deployments and review production requests without workspace administration rights.',
              )
            : t('The member may immediately lose access to actions allowed by the current role.'),
        t('Private repository access is reconciled to the new role.'),
      ],
    });
    if (!confirmed) return;
    setBusyMemberId(member.userId);
    try {
      setMembers(await api.updateWorkspaceMember(activeWorkspace.id, member.userId, nextRole));
      toast.success(t('Updated @{username}', { username: member.username }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!activeWorkspace) return;
    const confirmed = await confirmAction({
      title: t('Remove @{username} from {name}?', {
        username: member.username,
        name: activeWorkspace.name,
      }),
      description: t(
        'The user account remains active, but its access to this team workspace is revoked.',
      ),
      confirmLabel: t('Remove member'),
      tone: 'danger',
      consequences: [
        t(
          'Workspace projects, infrastructure and audit events are no longer visible to this member.',
        ),
        t('Private repository access is removed during reconciliation.'),
      ],
    });
    if (!confirmed) return;
    setBusyMemberId(member.userId);
    try {
      await api.removeWorkspaceMember(activeWorkspace.id, member.userId);
      setMembers((rows) => rows.filter((row) => row.userId !== member.userId));
      toast.success(t('Removed @{username}', { username: member.username }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyMemberId(null);
    }
  }

  async function transferOwnership(member: WorkspaceMember) {
    if (!activeWorkspace) return;
    const confirmed = await confirmAction({
      title: t('Make @{username} the owner of {name}?', {
        username: member.username,
        name: activeWorkspace.name,
      }),
      description: t('A workspace has one owner. You stay in the workspace as an admin.'),
      confirmLabel: t('Transfer ownership'),
      tone: 'warning',
      consequences: [
        t('The new owner can delete the workspace and change the production approval policy.'),
        t('Only the new owner can transfer ownership again.'),
      ],
    });
    if (!confirmed) return;
    setBusyMemberId(member.userId);
    try {
      setMembers(await api.transferWorkspaceOwnership(activeWorkspace.id, member.userId));
      await refreshWorkspaces();
      toast.success(t('@{username} now owns the workspace', { username: member.username }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyMemberId(null);
    }
  }

  async function leaveWorkspace() {
    if (!activeWorkspace) return;
    const confirmed = await confirmAction({
      title: t('Leave {name}?', { name: activeWorkspace.name }),
      description: t(
        'You lose access to its projects and servers. A workspace admin can add you again.',
      ),
      confirmLabel: t('Leave workspace'),
      tone: 'danger',
    });
    if (!confirmed) return;
    setLeaving(true);
    try {
      await api.leaveWorkspace(activeWorkspace.id);
      toast.success(t('You left {name}', { name: activeWorkspace.name }));
      await refreshWorkspaces();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <SettingsSection
      icon={Users}
      title={t('Workspace members')}
      description={t("People who can see and work on this workspace's projects.")}
      flush
      actions={
        isTeam && !isOwner ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={leaving}
            onClick={() => void leaveWorkspace()}
          >
            <LogOut className="h-3.5 w-3.5" /> {t('Leave workspace')}
          </Button>
        ) : undefined
      }
    >
      {canManage && (
        <div className="border-b border-border/70 bg-muted/50 px-4 py-4 sm:px-6">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
            <Input
              placeholder={t('Username or e-mail')}
              aria-label={t('New member username or e-mail')}
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && identity.trim() && !adding) void addMember();
              }}
            />
            <Select
              aria-label={t('New member role')}
              value={role}
              onChange={(event) => setRole(event.target.value as AssignableRole)}
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.label)}
                </option>
              ))}
            </Select>
            <Button onClick={() => void addMember()} disabled={adding || !identity.trim()}>
              <Plus className="h-4 w-4" /> {t('Add member')}
            </Button>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            {t(
              'Maintainers can manage deployments, rollbacks and production reviews without managing workspace membership or policy.',
            )}
          </p>
        </div>
      )}

      {activeWorkspace?.type === 'personal' && (
        <div className="border-b border-border/70 px-4 py-4 sm:px-6">
          <Notice>
            {t(
              'Personal workspaces stay private. Use “Add new workspace” in the workspace switcher to create a shared team space.',
            )}
          </Notice>
        </div>
      )}

      {loadError ? (
        <div className="p-4 sm:p-6">
          <LoadErrorState message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
        </div>
      ) : loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">{t('Loading members…')}</p>
      ) : members.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          {t('No workspace members found.')}
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
                  {isOwner && member.role === 'admin' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-full"
                      aria-label={t('Make {username} the owner', { username: member.username })}
                      title={t('Make {username} the owner', { username: member.username })}
                      disabled={busyMemberId === member.userId}
                      onClick={() => void transferOwnership(member)}
                    >
                      <Crown className="h-4 w-4" />
                    </Button>
                  )}
                  <Select
                    className="w-32 shrink-0"
                    aria-label={t('Role for {username}', { username: member.username })}
                    value={member.role}
                    disabled={busyMemberId === member.userId}
                    onChange={(event) =>
                      void changeRole(member, event.target.value as AssignableRole)
                    }
                  >
                    {ASSIGNABLE_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.label)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('Remove {username}', { username: member.username })}
                    title={t('Remove {username}', { username: member.username })}
                    disabled={busyMemberId === member.userId}
                    onClick={() => void removeMember(member)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <Badge variant={member.role === 'owner' ? 'brand' : 'default'}>
                  {roleLabel(member.role)}
                </Badge>
              )}
            </ListRow>
          ))}
        </List>
      )}
    </SettingsSection>
  );
}
