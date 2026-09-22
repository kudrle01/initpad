import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CopyField } from '@/components/molecules/CopyField';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Spinner } from '@/components/atoms/Spinner';
import type { AdminUser, PlatformUpdateOperation, PlatformUpdateStatus } from '@/types';
import { useConfirmation } from '@/confirmation';
import { createRequestId } from '@/lib/request-id';

// One-time credentials surfaced after create/reset. Shown once; there is no way
// to retrieve them again. Either a temporary password (admin reads it out) or an
// activation link (user sets their own password) — create returns both.
interface OneTime {
  username: string;
  password?: string;
  activationUrl?: string;
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
  if (user && (user.edition !== 'self-hosted' || user.platformRole !== 'admin')) {
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
          'A one-time activation link and temporary password will be displayed after creation.',
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
      } = await api.adminCreateUser({
        username: username.trim(),
        email: email.trim(),
        name: name.trim() || undefined,
        platformRole: role,
      });
      setOneTime({ username: created.username, password: temporaryPassword, activationUrl });
      setUsername('');
      setEmail('');
      setName('');
      setRole('user');
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
        'The new link is shown only once and must be shared securely.',
      ],
    });
    if (!confirmed) return;
    setBusyUserId(target.id);
    try {
      const { activationUrl } = await api.adminCreateActivationLink(target.id);
      setOneTime({ username: target.username, activationUrl });
      toast.success(`Activation link created for @${target.username}`);
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
        'The signed release will be installed by the local Supervisor after a verified database backup.',
      confirmLabel: 'Install update',
      tone: 'warning',
      consequences: [
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

  return (
    <div>
      <PageHeader title="Instance administration" />

      <div className="flex max-w-3xl flex-col gap-6">
        <PlatformUpdateCard
          status={updates}
          loading={updatesLoading}
          error={updatesError}
          installing={installingUpdate}
          onRefresh={() => void loadUpdates()}
          onInstall={() => void installPlatformUpdate()}
        />
        {oneTime && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold">Onboarding for @{oneTime.username}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Share securely. Shown{' '}
                  <strong className="font-medium text-foreground">once</strong> and cannot be
                  retrieved again. Send the activation link, or give the temporary password.
                </p>
              </div>
            </div>
            {oneTime.activationUrl && (
              <div className="mt-4">
                <p className="mb-1 text-xs text-muted-foreground">
                  Activation link — the user sets their own password:
                </p>
                <CopyField command={oneTime.activationUrl} />
              </div>
            )}
            {oneTime.password && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-muted-foreground">
                  Temporary password (must be changed at first sign-in):
                </p>
                <CopyField command={oneTime.password} />
              </div>
            )}
            <Button variant="secondary" className="mt-3" onClick={() => setOneTime(null)}>
              Done
            </Button>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold">Provision a user</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Creates the account and a one-time password. The user must set a new password before
                using the platform.
              </p>
            </div>
          </div>
          <form className="mt-5 grid gap-2 sm:grid-cols-2" onSubmit={createUser}>
            <Input
              placeholder="Username"
              aria-label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <Input
              type="email"
              placeholder="E-mail"
              aria-label="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              placeholder="Full name (optional)"
              aria-label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              className="h-11 rounded-md border border-input bg-card px-2 text-sm sm:h-9"
              aria-label="Platform role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
            >
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </select>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating || !username.trim() || !email.trim()}>
                {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Create
                user
              </Button>
            </div>
          </form>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-[15px] font-semibold">Users</h2>
          {loadError ? (
            <LoadErrorState className="mt-4" message={loadError} onRetry={loadUsers} />
          ) : loading ? (
            <ContentLoading className="mt-4" label="Loading users" count={2} />
          ) : (
            <div className="mt-4 divide-y divide-border rounded-md border border-border">
              {users.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {u.name || `@${u.username}`}
                      {u.platformRole === 'admin' && (
                        <ShieldCheck
                          className="h-3.5 w-3.5 text-primary"
                          aria-label="Administrator"
                        />
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{u.username}
                      {u.email ? ` · ${u.email}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {!u.active && <Badge tone="destructive">Deactivated</Badge>}
                    {u.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
                    {!u.emailVerified && <Badge tone="muted">E-mail unverified</Badge>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyUserId === u.id}
                      onClick={() => void activationLink(u)}
                    >
                      Activation link
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyUserId === u.id}
                      onClick={() => void resetPassword(u)}
                    >
                      Reset password
                    </Button>
                    {u.id !== user?.id &&
                      (u.active ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={busyUserId === u.id}
                          onClick={() => void setActive(u, false)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyUserId === u.id}
                          onClick={() => void setActive(u, true)}
                        >
                          Activate
                        </Button>
                      ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const UPDATE_STAGE_PROGRESS: Record<string, number> = {
  requesting: 5,
  accepted: 10,
  verifying: 20,
  backup: 35,
  pulling: 50,
  switching: 58,
  api: 65,
  web: 82,
  supervisor: 94,
  completed: 100,
  failed: 100,
  'request-failed': 100,
  'rolled-back': 100,
};

function updateTone(status: PlatformUpdateOperation['status']) {
  if (status === 'succeeded') return 'text-success';
  if (status === 'failed' || status === 'rolled-back') return 'text-destructive';
  return 'text-warning';
}

export function PlatformUpdateCard({
  status,
  loading,
  error,
  installing,
  onRefresh,
  onInstall,
}: {
  status: PlatformUpdateStatus | null;
  loading: boolean;
  error: string | null;
  installing: boolean;
  onRefresh: () => void;
  onInstall: () => void;
}) {
  const operation = status?.operation;
  const active = operation && ['requesting', 'accepted', 'running'].includes(operation.status);
  const reconnecting = Boolean(error && active);
  const progress = operation ? (UPDATE_STAGE_PROGRESS[operation.stage] ?? (active ? 15 : 100)) : 0;

  return (
    <section className="rounded-lg border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <PackageCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Platform updates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Signed releases with automatic backup, readiness checks and image rollback.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && !status ? (
        <ContentLoading className="mt-5" label="Checking platform updates" count={1} />
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Installed
              </p>
              <p className="mt-1 font-mono text-sm">{status?.currentVersion ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest verified
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-sm">{status?.latestVersion ?? '—'}</span>
                {status?.releaseUrl && (
                  <a
                    href={status.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Release <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {reconnecting ? (
            <div
              className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
              role="status"
              aria-live="polite"
            >
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <span>Connection interrupted while InitPad restarts. Reconnecting…</span>
            </div>
          ) : (
            (error || status?.catalogError || status?.supervisorError) && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error || status?.supervisorError || status?.catalogError}</span>
              </div>
            )
          )}

          {status?.supervisorOnline &&
            !status.updateAvailable &&
            !status.catalogError &&
            !status.catalogStale &&
            !active && (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium">InitPad {status.currentVersion} is current</p>
                  <p className="mt-0.5 text-xs">Supervisor online · no newer verified release.</p>
                </div>
              </div>
            )}

          {operation && operation.status !== 'succeeded' && (
            <div className="rounded-md border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {operation.fromVersion} → {operation.toVersion}
                </p>
                <span className={`text-xs font-semibold ${updateTone(operation.status)}`}>
                  {operation.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {operation.message || operation.stage}
              </p>
              {active && (
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label="Platform update progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <div
                    className="h-full rounded-full bg-warning transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {(status?.updateAvailable || active) && (
              <Button disabled={!status?.canInstall || installing} onClick={onInstall}>
                {installing || active ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <PackageCheck className="h-4 w-4" />
                )}
                {active ? 'Installing…' : 'Install update'}
              </Button>
            )}
            {status?.catalogStale && (
              <span className="text-xs text-warning">
                Release information is stale; refresh before installing.
              </span>
            )}
          </div>

          {status && status.history.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent update history
              </p>
              <div className="mt-2 divide-y divide-border rounded-md border border-border">
                {status.history.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs"
                  >
                    <span className="font-mono">
                      {item.fromVersion} → {item.toVersion}
                    </span>
                    <span className={`font-semibold ${updateTone(item.status)}`}>
                      {item.status}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {item.requestedByUsername ? `@${item.requestedByUsername} · ` : ''}
                      {new Date(item.startedAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'destructive' | 'warning' | 'muted';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'destructive'
      ? 'bg-destructive/10 text-destructive'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-secondary text-muted-foreground';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
  );
}
