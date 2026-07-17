import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { KeyRound, Plus, ShieldCheck, UserPlus } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CopyField } from '@/components/molecules/CopyField';
import { Spinner } from '@/components/atoms/Spinner';
import type { AdminUser } from '@/types';

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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [creating, setCreating] = useState(false);
  const [oneTime, setOneTime] = useState<OneTime | null>(null);

  useEffect(() => {
    if (!user || user.edition !== 'self-hosted' || user.platformRole !== 'admin') {
      setLoading(false);
      return;
    }
    api.adminListUsers()
      .then(setUsers)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [user?.id, user?.edition, user?.platformRole]);

  // Only platform administrators reach this page; ordinary users are redirected.
  if (user && (user.edition !== 'self-hosted' || user.platformRole !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  async function refresh() {
    setUsers(await api.adminListUsers());
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const { user: created, temporaryPassword, activationUrl } = await api.adminCreateUser({
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
    try {
      const updated = active
        ? await api.adminActivateUser(target.id)
        : await api.adminDeactivateUser(target.id);
      setUsers((rows) => rows.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(`${active ? 'Activated' : 'Deactivated'} @${target.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function resetPassword(target: AdminUser) {
    if (!window.confirm(`Reset the password for @${target.username}? This signs them out everywhere.`)) return;
    try {
      const { temporaryPassword } = await api.adminResetPassword(target.id);
      setOneTime({ username: target.username, password: temporaryPassword });
      await refresh();
      toast.success(`Reset password for @${target.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function activationLink(target: AdminUser) {
    try {
      const { activationUrl } = await api.adminCreateActivationLink(target.id);
      setOneTime({ username: target.username, activationUrl });
      toast.success(`Activation link created for @${target.username}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="Instance administration" />

      <div className="flex max-w-2xl flex-col gap-6">
        {oneTime && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <KeyRound className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold">Onboarding for @{oneTime.username}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Share securely. Shown <strong className="font-medium text-foreground">once</strong> and cannot be
                  retrieved again. Send the activation link, or give the temporary password.
                </p>
              </div>
            </div>
            {oneTime.activationUrl && (
              <div className="mt-4">
                <p className="mb-1 text-xs text-muted-foreground">Activation link — the user sets their own password:</p>
                <CopyField command={oneTime.activationUrl} />
              </div>
            )}
            {oneTime.password && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-muted-foreground">Temporary password (must be changed at first sign-in):</p>
                <CopyField command={oneTime.password} />
              </div>
            )}
            <Button variant="secondary" className="mt-3" onClick={() => setOneTime(null)}>Done</Button>
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
            <Input placeholder="Username" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <Input type="email" placeholder="E-mail" aria-label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input placeholder="Full name (optional)" aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              aria-label="Platform role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
            >
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </select>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating || !username.trim() || !email.trim()}>
                {creating ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Create user
              </Button>
            </div>
          </form>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-[15px] font-semibold">Users</h2>
          <div className="mt-4 divide-y divide-border rounded-md border border-border">
            {loading && <p className="p-3 text-sm text-muted-foreground">Loading users…</p>}
            {!loading && users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {u.name || `@${u.username}`}
                    {u.platformRole === 'admin' && (
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-label="Administrator" />
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{u.username}{u.email ? ` · ${u.email}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {!u.active && <Badge tone="destructive">Deactivated</Badge>}
                  {u.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
                  {!u.emailVerified && <Badge tone="muted">E-mail unverified</Badge>}
                </span>
                <span className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => activationLink(u)}>Activation link</Button>
                  <Button variant="ghost" size="sm" onClick={() => resetPassword(u)}>Reset password</Button>
                  {u.id !== user?.id && (
                    u.active
                      ? <Button variant="ghost" size="sm" onClick={() => setActive(u, false)}>Deactivate</Button>
                      : <Button variant="ghost" size="sm" onClick={() => setActive(u, true)}>Activate</Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'destructive' | 'warning' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'destructive'
      ? 'bg-destructive/10 text-destructive'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-secondary text-muted-foreground';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}
