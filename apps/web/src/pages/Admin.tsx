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
import { SessionExposureNotice } from '@/components/organisms/admin/SessionExposureNotice';
import { cn } from '@/lib/utils';
import { t, rich } from '@/i18n';

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
  const [builtInAppsShareSession, setBuiltInAppsShareSession] = useState(false);
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
    if (!user || user.edition !== 'self-hosted' || user.platformRole !== 'admin') return;
    let cancelled = false;
    api
      .adminSecurityStatus()
      .then((status) => {
        if (!cancelled) setBuiltInAppsShareSession(status.builtInAppsShareSession);
      })
      // The notice is advisory; the rest of the page does not depend on it.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

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
        title: t('Create @{username} as platform administrator?', { username: username.trim() }),
        description: t(
          'Platform administrators manage every account in this self-hosted InitPad instance.',
        ),
        confirmLabel: t('Create administrator'),
        tone: 'warning',
        consequences: [
          t('The new account receives instance-wide user administration permissions.'),
          t('A temporary password is shown once; activation uses e-mail when configured.'),
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
      toast.success(t('Created @{username}', { username: created.username }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function setActive(target: AdminUser, active: boolean) {
    if (!active) {
      const confirmed = await confirmAction({
        title: t('Deactivate @{username}?', { username: target.username }),
        description: t('The account will be blocked at both InitPad and its private Gitea SCM.'),
        confirmLabel: t('Deactivate account'),
        tone: 'danger',
        consequences: [
          t('All current InitPad sessions are revoked immediately.'),
          t('The user cannot sign in or access private repositories until reactivated.'),
          t('Projects, memberships and audit history are preserved.'),
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
      toast.success(
        active
          ? t('Activated @{username}', { username: target.username })
          : t('Deactivated @{username}', { username: target.username }),
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function resetPassword(target: AdminUser) {
    const confirmed = await confirmAction({
      title: t("Reset @{username}'s password?", { username: target.username }),
      description: t('A random temporary password will replace the current password.'),
      confirmLabel: t('Reset password'),
      tone: 'danger',
      consequences: [
        t('Every current session for this account is revoked.'),
        t('The user must change the one-time password at their next sign-in.'),
        t('The temporary password is shown only once.'),
      ],
    });
    if (!confirmed) return;
    setBusyUserId(target.id);
    try {
      const { temporaryPassword } = await api.adminResetPassword(target.id);
      setOneTime({ username: target.username, password: temporaryPassword });
      await refresh();
      toast.success(t('Reset password for @{username}', { username: target.username }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyUserId(null);
    }
  }

  async function activationLink(target: AdminUser) {
    const confirmed = await confirmAction({
      title: t('Create a new activation link for @{username}?', { username: target.username }),
      description: t(
        'Activation links are single-use credentials that let the user choose a password.',
      ),
      confirmLabel: t('Create new link'),
      tone: 'warning',
      consequences: [
        t('Any earlier unused activation link for this account becomes invalid.'),
        t('The new link is e-mailed when delivery is configured; otherwise it is shown once.'),
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
          ? t('Activation e-mail queued for @{username}', { username: target.username })
          : t('Activation link created for @{username}', { username: target.username }),
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
      title: t('Install InitPad {latestVersion}?', { latestVersion: updates.latestVersion }),
      description:
        updates.channel === 'candidate'
          ? t(
              'This signed prerelease is available only because this instance uses the candidate channel. Install it only for acceptance testing.',
            )
          : t(
              'The signed release will be installed by the local Supervisor after a verified database backup.',
            ),
      confirmLabel: t('Install update'),
      tone: 'warning',
      consequences: [
        ...(updates.channel === 'candidate'
          ? [t('This version has not completed the live stable-release acceptance gate.')]
          : []),
        t('The API and web UI will restart briefly; this page may be unavailable for a moment.'),
        t('Running project workloads are not restarted.'),
        t('If readiness fails, the previous platform images are restored automatically.'),
        t('Only expand-contract, image-compatible database releases are accepted automatically.'),
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
      toast.success(
        t('InitPad {latestVersion} update started', { latestVersion: updates.latestVersion }),
      );
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
        title={t('Platform administration')}
        description={t('Instance-wide settings. Only platform administrators can open this page.')}
      />

      <div className="flex flex-col gap-4 lg:gap-6">
        {selfHosted && <SessionExposureNotice builtInAppsShareSession={builtInAppsShareSession} />}
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
                  {t('Onboarding for @{username}', { username: oneTime.username })}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {oneTime.activationEmailed
                    ? t(
                        'The activation e-mail is queued. Any temporary password below is shown once.',
                      )
                    : t('Share securely. Credentials shown here cannot be retrieved again.')}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-4">
              {oneTime.activationUrl && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">
                    {rich('Activation link <span>— the user sets their own password</span>', {
                      span: (chunk) => (
                        <span className="font-normal text-muted-foreground">{chunk}</span>
                      ),
                    })}
                  </p>
                  <CopyField command={oneTime.activationUrl} />
                </div>
              )}
              {oneTime.activationEmailed && (
                <p className="text-sm text-primary">
                  {t('Activation link queued for delivery to the account e-mail address.')}
                </p>
              )}
              {oneTime.password && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">
                    {rich('Temporary password <span>— must be changed at first sign-in</span>', {
                      span: (chunk) => (
                        <span className="font-normal text-muted-foreground">{chunk}</span>
                      ),
                    })}
                  </p>
                  <CopyField command={oneTime.password} />
                </div>
              )}
            </div>
            <Button className="mt-5" onClick={() => setOneTime(null)}>
              {t('Done')}
            </Button>
          </Card>
        )}

        {selfHosted && (
          <SettingsSection
            icon={Users}
            title={t('Users')}
            description={t(
              'Accounts on this instance. New users receive a one-time password and must set their own before using the platform.',
            )}
            flush
            actions={
              !adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> {t('Add user')}
                </Button>
              )
            }
          >
            {adding && (
              <form
                className="border-b border-border/70 bg-muted/50 px-4 py-4 sm:px-6 sm:py-5"
                onSubmit={createUser}
                aria-label={t('Provision a user')}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label={t('Username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    required
                  />
                  <FormField
                    label={t('E-mail')}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <FormField
                    label={t('Full name')}
                    placeholder={t('Optional')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="new-user-role">{t('Platform role')}</Label>
                    <Select
                      id="new-user-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
                    >
                      <option value="user">{t('User')}</option>
                      <option value="admin">{t('Administrator')}</option>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                    {t('Cancel')}
                  </Button>
                  <Button type="submit" disabled={creating || !username.trim() || !email.trim()}>
                    {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{' '}
                    {t('Create user')}
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
                <ContentLoading label={t('Loading users')} count={2} />
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
                            aria-label={t('Administrator')}
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
                          aria-label={t('Actions for @{username}', { username: u.username })}
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
                          <Link2 className="h-4 w-4 text-muted-foreground" />{' '}
                          {t('New activation link')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void resetPassword(u)}>
                          <KeyRound className="h-4 w-4 text-muted-foreground" />{' '}
                          {t('Reset password')}
                        </DropdownMenuItem>
                        {u.id !== user?.id && (
                          <>
                            <DropdownMenuSeparator />
                            {u.active ? (
                              <DropdownMenuItem
                                destructive
                                onSelect={() => void setActive(u, false)}
                              >
                                <UserX className="h-4 w-4" /> {t('Deactivate')}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => void setActive(u, true)}>
                                <UserCheck className="h-4 w-4 text-muted-foreground" />{' '}
                                {t('Activate')}
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
      {!user.active && <Badge variant="danger">{t('Deactivated')}</Badge>}
      {user.mustChangePassword && <Badge variant="warning">{t('Must change password')}</Badge>}
      {!user.emailVerified && <Badge>{t('E-mail unverified')}</Badge>}
    </span>
  );
}
