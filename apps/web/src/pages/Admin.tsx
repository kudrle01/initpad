import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  KeyRound,
  Link2,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CopyField } from '@/components/molecules/CopyField';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { FormField } from '@/components/molecules/FormField';
import { List, ListRow } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Spinner } from '@/components/atoms/Spinner';
import { PlatformUpdateCard } from '@/components/organisms/admin/PlatformUpdateCard';
import type { AdminUser, PlatformUpdateStatus } from '@/types';
import { useConfirmation } from '@/confirmation';
import { createRequestId } from '@/lib/request-id';
import { WorkspaceCapacityCard } from '@/components/organisms/admin/WorkspaceCapacityCard';
import { cn } from '@/lib/utils';

// One-time credentials surfaced after create/reset. Shown once; there is no way
// to retrieve them again. Either a temporary password (admin reads it out) or an
// activation link (user sets their own password) — create returns both.
interface OneTime {
  username: string;
  password?: string;
  activationUrl?: string;
  activationEmailed?: boolean;
}

export default function Admin() {
  const { user } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);
  // The provisioning form is opened on demand; the user list is the default view.
  const [adding, setAdding] = useState(false);
  const [oneTime, setOneTime] = useState<OneTime | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<PlatformUpdateStatus | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(true);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!user || user.edition !== 'self-hosted' || user.platformRole !== 'admin') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setUsers(await api.adminListUsers());
    } catch (cause) {
      setLoadError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const loadUpdates = useCallback(async () => {
    if (!user || user.edition !== 'self-hosted' || user.platformRole !== 'admin') {
      setUpdatesLoading(false);
      return;
    }
    try {
      setUpdates(await api.adminPlatformUpdateStatus());
      setUpdatesError(null);
    } catch (cause) {
      setUpdatesError((cause as Error).message);
    } finally {
      setUpdatesLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadUpdates();
  }, [loadUpdates]);

  useEffect(() => {
    const status = updates?.operation?.status;
    if (!status || !['requesting', 'accepted', 'running'].includes(status)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await loadUpdates();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2_500);
    };
    timer = window.setTimeout(() => void poll(), 2_500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadUpdates, updates?.operation?.status]);

  // Only platform administrators reach this page; ordinary users are redirected.
  if (user && user.platformRole !== 'admin') {
    return <Navigate to="/" replace />;
  }

  async function refresh() {
    setUsers(await api.adminListUsers());
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (role === 'admin') {
      const confirmed = await confirmAction({
        title: `Create @${username.trim()} as platform administrator?`,
        description:
          'Platform administrators manage every account in this self-hosted InitPad instance.',
        confirmLabel: 'Create administrator',
        tone: 'warning',
        consequences: [
          'The new account receives instance-wide user administration permissions.',
          'A temporary password is shown once; activation uses e-mail when configured.',
        ],
      });
      if (!confirmed) return;
    }
    setCreating(true);
    try {
      const {
        user: created,
        temporaryPassword,
        activationUrl,
        activationDelivery,
      } = await api.adminCreateUser({
        username: username.trim(),
        email: email.trim(),
        name: name.trim() || undefined,
        platformRole: role,
      });
      setOneTime({
        username: created.username,
        password: temporaryPassword,
        activationUrl,
        activationEmailed: activationDelivery === 'email',
      });
      setUsername('');
      setEmail('');
      setName('');
      setRole('user');
      setAdding(false);
      await refresh();
      toast.success(`Created @${created.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function setActive(target: AdminUser, active: boolean) {
    if (!active) {
      const confirmed = await confirmAction({
        title: `Deactivate @${target.username}?`,
        description: 'The account will be blocked at both InitPad and its private Gitea SCM.',
        confirmLabel: 'Deactivate account',
        tone: 'danger',
        consequences: [
          'All current InitPad sessions are revoked immediately.',
          'The user cannot sign in or access private repositories until reactivated.',
          'Projects, memberships and audit history are preserved.',
        ],
      });
      if (!confirmed) return;
    }
    setBusyUserId(target.id);
    try {
      const updated = active
        ? await api.adminActivateUser(target.id)
        : await api.adminDeactivateUser(target.id);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(`${active ? 'Activated' : 'Deactivated'} @${target.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function resetPassword(target: AdminUser) {
    const confirmed = await confirmAction({
      title: `Reset @${target.username}'s password?`,
      description: 'A random temporary password will replace the current password.',
      confirmLabel: 'Reset password',
      tone: 'danger',
      consequences: [
        'Every current session for this account is revoked.',
        'The user must change the one-time password at their next sign-in.',
        'The temporary password is shown only once.',
      ],
    });
    if (!confirmed) return;
    setBusyUserId(target.id);
    try {
      const { temporaryPassword } = await api.adminResetPassword(target.id);
      setOneTime({ username: target.username, password: temporaryPassword });
      await refresh();
      toast.success(`Reset password for @${target.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function activationLink(target: AdminUser) {
    const confirmed = await confirmAction({
      title: `Create a new activation link for @${target.username}?`,
      description:
        'Activation links are single-use credentials that let the user choose a password.',
      confirmLabel: 'Create new link',
      tone: 'warning',
      consequences: [
        'Any earlier unused activation link for this account becomes invalid.',
        'The new link is e-mailed when delivery is configured; otherwise it is shown once.',
      ],
    });
    if (!confirmed) return;
    setBusyUserId(target.id);
    try {
      const { activationUrl, delivery } = await api.adminCreateActivationLink(target.id);
      setOneTime({
        username: target.username,
        activationUrl,
        activationEmailed: delivery === 'email',
      });
      toast.success(
        delivery === 'email'
          ? `Activation e-mail queued for @${target.username}`
          : `Activation link created for @${target.username}`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function installPlatformUpdate() {
    if (!updates?.latestVersion || !updates.canInstall) return;
    const confirmed = await confirmAction({
      title: `Install InitPad ${updates.latestVersion}?`,
      description:
        updates.channel === 'candidate'
          ? 'This signed prerelease is available only because this instance uses the candidate channel. Install it only for acceptance testing.'
          : 'The signed release will be installed by the local Supervisor after a verified database backup.',
      confirmLabel: 'Install update',
      tone: 'warning',
      consequences: [
        ...(updates.channel === 'candidate'
          ? ['This version has not completed the live stable-release acceptance gate.']
          : []),
        'The API and web UI will restart briefly; this page may be unavailable for a moment.',
        'Running project workloads are not restarted.',
        'If readiness fails, the previous platform images are restored automatically.',
        'Only expand-contract, image-compatible database releases are accepted automatically.',
      ],
    });
    if (!confirmed) return;
    setInstallingUpdate(true);
    try {
      const operation = await api.adminInstallPlatformUpdate(createRequestId());
      // Seed polling from the accepted response. The following status request
      // may race the intentional API restart, but the durable operation must
      // remain visible so automatic reconnect continues without a page reload.
      setUpdates((current) =>
        current
          ? {
              ...current,
              canInstall: false,
              operation,
              history: [
                operation,
                ...current.history.filter((item) => item.requestId !== operation.requestId),
              ],
            }
          : current,
      );
      toast.success(`InitPad ${updates.latestVersion} update started`);
      await loadUpdates();
    } catch (cause) {
      toast.error((cause as Error).message);
      await loadUpdates();
    } finally {
      setInstallingUpdate(false);
    }
  }

  const selfHosted = user?.edition === 'self-hosted';

  return (
    <div>
      <PageHeader
        title="Platform administration"
        description="Instance-wide settings. Only platform administrators can open this page."
      />

      <div className="flex flex-col gap-4 lg:gap-6">
        {selfHosted && (
          <PlatformUpdateCard
            status={updates}
            loading={updatesLoading}
            error={updatesError}
            installing={installingUpdate}
            onRefresh={() => void loadUpdates()}
            onInstall={() => void installPlatformUpdate()}
          />
        )}

        {selfHosted && oneTime && (
          <Card className="border-primary/30 bg-secondary/50 p-5 sm:p-6" role="status">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <KeyRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="break-words text-base font-semibold tracking-tight">
                  Onboarding for @{oneTime.username}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {oneTime.activationEmailed
                    ? 'The activation e-mail is queued. Any temporary password below is shown once.'
                    : 'Share securely. Credentials shown here cannot be retrieved again.'}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-4">
              {oneTime.activationUrl && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">
                    Activation link{' '}
                    <span className="font-normal text-muted-foreground">
                      — the user sets their own password
                    </span>
                  </p>
                  <CopyField command={oneTime.activationUrl} />
                </div>
              )}
              {oneTime.activationEmailed && (
                <p className="text-sm text-primary">
                  Activation link queued for delivery to the account e-mail address.
                </p>
              )}
              {oneTime.password && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">
                    Temporary password{' '}
                    <span className="font-normal text-muted-foreground">
                      — must be changed at first sign-in
                    </span>
                  </p>
                  <CopyField command={oneTime.password} />
                </div>
              )}
            </div>
            <Button className="mt-5" onClick={() => setOneTime(null)}>
              Done
            </Button>
          </Card>
        )}

        {selfHosted && (
          <SettingsSection
            icon={Users}
            title="Users"
            description="Accounts on this instance. New users receive a one-time password and must set their own before using the platform."
            flush
            actions={
              !adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> Add user
                </Button>
              )
            }
          >
            {adding && (
              <form
                className="border-b border-border/70 bg-muted/50 px-4 py-4 sm:px-6 sm:py-5"
                onSubmit={createUser}
                aria-label="Provision a user"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    required
                  />
                  <FormField
                    label="E-mail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <FormField
                    label="Full name"
                    placeholder="Optional"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="new-user-role">Platform role</Label>
                    <Select
                      id="new-user-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                    >
                      <option value="user">User</option>
                      <option value="admin">Administrator</option>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creating || !username.trim() || !email.trim()}>
                    {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{' '}
                    Create user
                  </Button>
                </div>
              </form>
            )}

            {loadError ? (
              <div className="p-4 sm:p-6">
                <LoadErrorState message={loadError} onRetry={loadUsers} />
              </div>
            ) : loading ? (
              <div className="p-4 sm:p-6">
                <ContentLoading label="Loading users" count={2} />
              </div>
            ) : (
              <List>
                {users.map((u) => (
                  <ListRow key={u.id}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {(u.name || u.username).slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{u.name || `@${u.username}`}</span>
                        {u.platformRole === 'admin' && (
                          <ShieldCheck
                            className="h-4 w-4 shrink-0 text-primary"
                            aria-label="Administrator"
                          />
                        )}
                      </span>
                      <span
                        className="block truncate text-xs text-muted-foreground"
                        title={u.email ?? undefined}
                      >
                        @{u.username}
                        {u.email ? ` · ${u.email}` : ''}
                      </span>
                      <UserFlags user={u} className="mt-1.5 lg:hidden" />
                    </span>
                    <UserFlags user={u} className="hidden shrink-0 justify-end lg:flex" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full"
                          disabled={busyUserId === u.id}
                          aria-label={`Actions for @${u.username}`}
                        >
                          {busyUserId === u.id ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => void activationLink(u)}>
                          <Link2 className="h-4 w-4 text-muted-foreground" /> New activation link
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void resetPassword(u)}>
                          <KeyRound className="h-4 w-4 text-muted-foreground" /> Reset password
                        </DropdownMenuItem>
                        {u.id !== user?.id && (
                          <>
                            <DropdownMenuSeparator />
                            {u.active ? (
                              <DropdownMenuItem
                                destructive
                                onSelect={() => void setActive(u, false)}
                              >
                                <UserX className="h-4 w-4" /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => void setActive(u, true)}>
                                <UserCheck className="h-4 w-4 text-muted-foreground" /> Activate
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ListRow>
                ))}
              </List>
            )}
          </SettingsSection>
        )}

        {user?.platformRole === 'admin' && <WorkspaceCapacityCard />}
      </div>
    </div>
  );
}

function UserFlags({ user, className }: { user: AdminUser; className?: string }) {
  if (user.active && !user.mustChangePassword && user.emailVerified) return null;
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {!user.active && <Badge variant="danger">Deactivated</Badge>}
      {user.mustChangePassword && <Badge variant="warning">Must change password</Badge>}
      {!user.emailVerified && <Badge>E-mail unverified</Badge>}
    </span>
  );
}
