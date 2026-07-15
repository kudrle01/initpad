import { useEffect, useState } from 'react';
import { GitBranch, KeyRound, ExternalLink, ShieldAlert, Users, Plus, Trash2, Mail, Github } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CopyField } from '@/components/molecules/CopyField';
import { Spinner } from '@/components/atoms/Spinner';
import { useAuth } from '@/auth';
import { useToast } from '@/toast';
import type { LinkedIdentity, WorkspaceMember, WorkspaceRole } from '@/types';

type AssignableRole = Exclude<WorkspaceRole, 'owner'>;

interface GitAccess {
  username: string;
  token: string | null;
  giteaUrl: string;
}

// Builds the one-time setup command: git rewrites every Gitea http URL to
// embed user + token, so subsequent clone/pull/push work without password
// prompts.
function setupCommand(a: GitAccess): string {
  const base = a.giteaUrl.replace(/\/+$/, '');
  const creds = base.replace('://', `://${encodeURIComponent(a.username)}:${a.token}@`);
  return `git config --global url."${creds}/".insteadOf "${base}/"`;
}

export default function Settings() {
  const [access, setAccess] = useState<GitAccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [identity, setIdentity] = useState('');
  const [memberRole, setMemberRole] = useState<AssignableRole>('member');
  const [renameWorkspace, setRenameWorkspace] = useState('');
  const [verifyLink, setVerifyLink] = useState<string | null>(null);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [ghStatus, setGhStatus] = useState<{
    installUrl: string | null;
    installation: { present: boolean; suspended: boolean };
  } | null>(null);
  const { user, activeWorkspace, refreshWorkspaces } = useAuth();
  const toast = useToast();
  const canAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const canManageMembers = canAdmin && activeWorkspace?.type !== 'personal';

  useEffect(() => {
    if (!activeWorkspace) return;
    setRenameWorkspace(activeWorkspace.name);
    setMembersLoading(true);
    api.listWorkspaceMembers(activeWorkspace.id)
      .then(setMembers)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setMembersLoading(false));
  }, [activeWorkspace?.id]);

  useEffect(() => {
    api.authConfig()
      .then((c) => {
        setGithubEnabled(c.githubEnabled);
        if (c.githubEnabled) {
          api.listIdentities().then(setIdentities).catch(() => undefined);
          api.githubStatus().then(setGhStatus).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    // Surface the result of a GitHub link redirect, then clean the URL.
    const q = new URLSearchParams(window.location.search);
    const gh = q.get('github');
    if (gh === 'linked') {
      toast.success('GitHub account linked');
      api.listIdentities().then(setIdentities).catch(() => undefined);
    } else if (gh === 'error') {
      toast.error(q.get('reason') || 'Could not link GitHub account');
    }
    if (gh) window.history.replaceState({}, '', '/settings');
  }, []);

  async function unlinkGithub(provider: string) {
    if (!window.confirm('Unlink this GitHub account from InitPad?')) return;
    try {
      await api.unlinkIdentity(provider);
      setIdentities((rows) => rows.filter((i) => i.provider !== provider));
      toast.success('GitHub account unlinked');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addMember() {
    if (!activeWorkspace) return;
    try {
      setMembers(await api.addWorkspaceMember(activeWorkspace.id, identity.trim(), memberRole));
      setIdentity('');
      toast.success('Workspace member added');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function changeRole(member: WorkspaceMember, role: Exclude<WorkspaceRole, 'owner'>) {
    if (!activeWorkspace) return;
    try {
      setMembers(await api.updateWorkspaceMember(activeWorkspace.id, member.userId, role));
      toast.success(`Updated @${member.username}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (!activeWorkspace || !window.confirm(`Remove @${member.username} from ${activeWorkspace.name}?`)) return;
    try {
      await api.removeWorkspaceMember(activeWorkspace.id, member.userId);
      setMembers((rows) => rows.filter((row) => row.userId !== member.userId));
      toast.success(`Removed @${member.username}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveWorkspaceName() {
    if (!activeWorkspace) return;
    try {
      await api.updateWorkspace(activeWorkspace.id, renameWorkspace.trim());
      await refreshWorkspaces();
      toast.success('Workspace renamed');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteWorkspace() {
    if (!activeWorkspace || !window.confirm(`Delete empty workspace ${activeWorkspace.name}?`)) return;
    try {
      await api.deleteWorkspace(activeWorkspace.id);
      localStorage.removeItem('initpad.workspace');
      await refreshWorkspaces();
      toast.success('Workspace deleted');
      window.location.assign('/');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function sendVerification() {
    try {
      const { verifyUrl } = await api.requestEmailVerification();
      setVerifyLink(verifyUrl);
      toast.success('Verification link created');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      setAccess(await api.getGitAccess());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="flex max-w-2xl flex-col gap-6">
      {user && user.email && !user.emailVerified && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
              <Mail className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">Verify your e-mail</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirm <strong className="font-medium text-foreground">{user.email}</strong> to secure account
                recovery. On an instance without e-mail delivery, open the link shown below.
              </p>
            </div>
          </div>
          <div className="mt-4">
            {!verifyLink ? (
              <Button variant="secondary" onClick={sendVerification}>Send verification link</Button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">Open this link to verify (shown once):</p>
                <CopyField command={verifyLink} />
              </div>
            )}
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <GitBranch className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Connect Git</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Link your machine to the platform’s Git server <strong className="font-medium text-foreground">once</strong>.
              After that, cloning, pulling and pushing private repositories just works — no
              password prompts.
            </p>
          </div>
        </div>

        <div className="mt-5">
          {!access && (
            <Button onClick={reveal} disabled={loading}>
              {loading ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {loading ? 'Loading…' : 'Show setup command'}
            </Button>
          )}

          {error && (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          )}

          {access && access.token && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Run this once in your terminal:
              </p>
              <CopyField command={setupCommand(access)} />
              <p className="text-sm text-muted-foreground">
                Then clone any project with the plain URL shown on its page — it authenticates
                automatically:
              </p>
              <CopyField command={`git clone ${access.giteaUrl}/${access.username}/<project>.git`} />

              <div className="mt-1 flex items-start gap-2 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <span>
                  The command embeds your personal Gitea token in <code className="font-mono">~/.gitconfig</code>.
                  Keep it private; you can revoke it anytime in{' '}
                  <a
                    href={`${access.giteaUrl}/user/settings/applications`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    Gitea → Settings → Applications <ExternalLink className="h-3 w-3" />
                  </a>
                  .
                </span>
              </div>
            </div>
          )}

          {access && !access.token && (
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>
                No personal access token is available for your account. Generate one in Gitea
                (scope <code className="font-mono">repository</code>) and use it as the password
                when cloning:
              </p>
              <a
                href={`${access.giteaUrl}/user/settings/applications`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open Gitea token settings <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      </div>

      {githubEnabled && (
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <Github className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold">GitHub account</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Link GitHub to sign in with it and (once a GitHub App is installed) create or import
                GitHub repositories.
              </p>
            </div>
          </div>
          <div className="mt-4">
            {identities.filter((i) => i.provider === 'github').length === 0 ? (
              <a
                href="/api/auth/github?mode=link"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-secondary"
              >
                <Github className="h-4 w-4" /> Link GitHub account
              </a>
            ) : (
              <div className="divide-y divide-border rounded-md border border-border">
                {identities.filter((i) => i.provider === 'github').map((identity) => (
                  <div key={identity.provider} className="flex flex-wrap items-center gap-3 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {identity.username ? `@${identity.username}` : 'GitHub'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        linked {new Date(identity.linkedAt).toLocaleDateString()}
                        {ghStatus && (
                          ghStatus.installation.suspended
                            ? ' · App installation suspended'
                            : ghStatus.installation.present
                              ? ' · App installed'
                              : ' · App not installed'
                        )}
                      </span>
                    </span>
                    {ghStatus && !ghStatus.installation.present && ghStatus.installUrl && (
                      <a
                        href={ghStatus.installUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs font-medium hover:bg-secondary"
                      >
                        Install GitHub App
                      </a>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => unlinkGithub(identity.provider)}>Unlink</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Workspace members</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeWorkspace?.name ?? 'Current workspace'} · your role: {activeWorkspace?.role ?? '—'}
            </p>
          </div>
        </div>

        {canManageMembers && (
          <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <input
              className="h-9 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              placeholder="Username or e-mail"
              aria-label="New member username or e-mail"
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
            />
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              aria-label="New member role"
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as Exclude<WorkspaceRole, 'owner'>)}
            >
              <option value="member">Member</option>
              <option value="maintainer">Maintainer</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <Button onClick={addMember} disabled={!identity.trim()}><Plus className="h-4 w-4" /> Add</Button>
          </div>
        )}

        {activeWorkspace?.type === 'personal' && (
          <p className="mt-4 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
            Personal workspaces stay private. Use “Add new workspace” in the workspace switcher
            to create a shared team space.
          </p>
        )}

        <div className="mt-4 divide-y divide-border rounded-md border border-border">
          {membersLoading && <p className="p-3 text-sm text-muted-foreground">Loading members…</p>}
          {!membersLoading && members.map((member) => (
            <div key={member.userId} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{member.name || `@${member.username}`}</span>
                <span className="block truncate text-xs text-muted-foreground">@{member.username}</span>
              </span>
              {canManageMembers && member.role !== 'owner' ? (
                <>
                  <select
                    className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                    aria-label={`Role for ${member.username}`}
                    value={member.role}
                    onChange={(e) => changeRole(member, e.target.value as Exclude<WorkspaceRole, 'owner'>)}
                  >
                    <option value="member">Member</option>
                    <option value="maintainer">Maintainer</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${member.username}`} onClick={() => removeMember(member)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              ) : <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">{member.role}</span>}
            </div>
          ))}
        </div>
      </div>


      {activeWorkspace?.type !== 'personal' && canAdmin && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-[15px] font-semibold">Current team workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rename this workspace or delete it after all of its projects and targets are removed.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-sm"
              aria-label="Current workspace name"
              value={renameWorkspace}
              onChange={(e) => setRenameWorkspace(e.target.value)}
            />
            <Button variant="secondary" onClick={saveWorkspaceName} disabled={renameWorkspace.trim().length < 2 || renameWorkspace.trim() === activeWorkspace.name}>Rename</Button>
            {activeWorkspace.role === 'owner' && <Button variant="destructive" onClick={deleteWorkspace}>Delete empty workspace</Button>}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
