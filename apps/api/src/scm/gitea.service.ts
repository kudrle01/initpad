import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import * as tar from 'tar-fs';
import { config } from '../config';
import { RepoArchive, ScmActor, ScmProvider } from './scm-provider';

const exec = promisify(execFile);

export type { RepoArchive } from './scm-provider';
// Backwards-compatible alias: the Gitea actor is just an ScmActor.
export type GiteaActor = ScmActor;

/**
 * The Gitea adapter of {@link ScmProvider} for the self-contained edition. It
 * creates repositories and pushes scaffolds on behalf of the owning user, and
 * reads commits / CI commit statuses. It additionally provisions managed
 * accounts via the admin API — that identity concern is edition-specific and
 * intentionally outside the ScmProvider interface.
 */
@Injectable()
export class GiteaService implements OnModuleInit, ScmProvider {
  private readonly logger = new Logger('GiteaService');

  // Registers the platform's system webhook in Gitea (idempotent, best
  // effort). The hook notifies the platform about repository events, so
  // changes made directly in Gitea — e.g. deleting a repository — are
  // reflected back and no orphaned projects remain. Running this on startup
  // covers both the npm-run-dev and the containerized setup without any
  // installer step.
  onModuleInit(): void {
    void this.ensureSystemWebhook();
  }

  private async ensureSystemWebhook(): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) return;
    const hookUrl = `${config.scm.webhookUrl.replace(/\/$/, '')}/api/scm/webhook`;
    try {
      const listed = await fetch(`${url}/api/v1/admin/hooks?limit=50`, {
        headers: { Authorization: `token ${adminToken}` },
      });
      if (listed.ok) {
        const hooks = (await listed.json()) as Array<{
          id: number;
          config?: { url?: string };
        }>;
        if (hooks.some((h) => h.config?.url === hookUrl)) return;
        // Replace stale registrations pointing at the webhook path (e.g. an
        // older URL format without the token).
        for (const h of hooks) {
          if (h.config?.url?.startsWith(hookUrl)) {
            await fetch(`${url}/api/v1/admin/hooks/${h.id}`, {
              method: 'DELETE',
              headers: { Authorization: `token ${adminToken}` },
            }).catch(() => undefined);
          }
        }
      }
      const created = await fetch(`${url}/api/v1/admin/hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
        body: JSON.stringify({
          type: 'gitea',
          active: true,
          events: ['repository'],
          config: {
            url: hookUrl,
            content_type: 'json',
            secret: config.scm.webhookToken,
          },
          authorization_header: `Bearer ${config.scm.webhookToken}`,
        }),
      });
      if (created.ok) {
        this.logger.log(`System webhook registered: ${hookUrl}`);
      } else {
        this.logger.warn(`System webhook registration failed (HTTP ${created.status})`);
      }
    } catch (e) {
      // Gitea may not be reachable yet — not fatal; the next start retries.
      this.logger.warn(`System webhook registration skipped: ${(e as Error).message}`);
    }
  }

  async provision(
    name: string,
    dir: string,
    actor: GiteaActor,
    ciDeployToken: string,
  ): Promise<{ repoUrl: string }> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    await this.createRepo(name, actor, ciDeployToken);
    await this.pushScaffold(name, dir, actor);
    // The stored repo URL is browser-facing (users click it in the UI).
    const repoUrl = `${config.gitea.url}/${actor.username}/${name}`;
    this.logger.log(`Repository created and pushed: ${repoUrl}`);
    return { repoUrl };
  }

  // Creates a Gitea user account via the admin API (managed registration).
  // Returns the Gitea ID and login of the newly created user.
  async createUser(input: {
    username: string;
    email: string;
    password: string;
  }): Promise<{ id: number; login: string }> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    const res = await fetch(`${url}/api/v1/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({
        username: input.username,
        email: input.email,
        password: input.password,
        must_change_password: false,
      }),
    });
    if (res.status === 422) {
      throw new Error('A user with this username or e-mail already exists in Gitea');
    }
    if (!res.ok) {
      throw new Error(`Gitea user creation failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { id: number; login: string };
    return { id: data.id, login: data.login };
  }

  // Enables or disables the Gitea account so instance-level deactivation stays
  // consistent with the SCM: a disabled Gitea user cannot authenticate or use
  // tokens. EditUserOption requires login_name + source_id for local accounts.
  async setUserActive(username: string, active: boolean): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea admin is not configured');
    const res = await fetch(`${url}/api/v1/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ login_name: username, source_id: 0, active }),
    });
    if (!res.ok) {
      throw new Error(`Could not ${active ? 'activate' : 'deactivate'} the Gitea account (HTTP ${res.status})`);
    }
  }

  async deleteUser(username: string): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) return;
    await fetch(`${url}/api/v1/admin/users/${encodeURIComponent(username)}?purge=true`, {
      method: 'DELETE',
      headers: { Authorization: `token ${adminToken}` },
    }).catch(() => undefined);
  }

  // Creates the user's personal access token (Basic auth with their
  // password). The platform stores it and can act on the user's behalf.
  async createUserToken(username: string, password: string): Promise<string> {
    const url = config.gitea.internalUrl;
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const res = await fetch(`${url}/api/v1/users/${username}/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({
        name: `initpad-platform-${Date.now()}`,
        scopes: [
          'write:repository',
          'read:repository',
          'write:package',
          'read:package',
          'write:user',
          'read:user',
          'write:organization',
          'read:organization',
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Gitea token creation failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { sha1: string };
    return data.sha1;
  }

  // Issues a personal access token (PAT) for git-over-HTTP cloning. Gitea
  // only creates tokens through Basic auth (username + password) — not via
  // the admin token or Sudo. SSO users don't know their Gitea password, so
  // the platform (as Gitea admin) sets a temporary random password and uses
  // it to create the token. In this model users sign in to Gitea through the
  // platform (SSO/OIDC), so the Gitea password is otherwise unused and
  // resetting it breaks nothing.
  async issueCloneToken(username: string): Promise<string> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    // Strong password (upper/lower/digit/special) to satisfy complexity checks.
    const tempPassword = `Ip1!${randomBytes(20).toString('hex')}`;
    // Gitea's EditUserOption requires login_name + source_id (422 otherwise).
    // source_id 0 = local account; login_name of a local account = username.
    const edit = await fetch(`${url}/api/v1/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({
        login_name: username,
        source_id: 0,
        password: tempPassword,
        must_change_password: false,
      }),
    });
    if (!edit.ok) {
      const body = await edit.text().catch(() => '');
      throw new Error(
        `Could not provision a git token (set-password HTTP ${edit.status}) ${body.slice(0, 120)}`,
      );
    }
    return this.createUserToken(username, tempPassword);
  }

  // Deletes all versions of the project's container package (images in the
  // Gitea registry), so no orphaned artifacts remain after project removal.
  async deletePackages(owner: string, name: string): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) return;
    const pkgName = name.toLowerCase();
    try {
      const res = await fetch(
        `${url}/api/v1/packages/${owner}?type=container&q=${encodeURIComponent(pkgName)}&limit=100`,
        { headers: { Authorization: `token ${adminToken}` } },
      );
      if (!res.ok) return;
      const pkgs = (await res.json()) as Array<{ type: string; name: string; version: string }>;
      for (const p of pkgs) {
        if (p.type !== 'container' || p.name.toLowerCase() !== pkgName) continue;
        await fetch(
          `${url}/api/v1/packages/${owner}/container/${p.name}/${encodeURIComponent(p.version)}`,
          { method: 'DELETE', headers: { Authorization: `token ${adminToken}` } },
        ).catch(() => undefined);
      }
    } catch {
      // Best-effort cleanup.
    }
  }

  // Deletes the repository in Gitea. A project deletion must not be reported
  // as complete while its source repository still exists.
  async deleteRepo(name: string, actor: GiteaActor): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea is not configured');
    const response = await fetch(
      `${url}/api/v1/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${adminToken}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not delete the Gitea repository (HTTP ${response.status})`);
    }
  }

  // Preserves source code while severing the repository's trust relationship
  // with a deleted InitPad project. In particular, the owner package token
  // must not remain available to future Actions runs after the project-scoped
  // deploy-token hash and authorization record are gone.
  async detachRepo(name: string, actor: GiteaActor): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea is not configured');
    const repo = `${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`;
    const headers = { Authorization: `token ${adminToken}` };
    const secrets = [
      'INITPAD_DEPLOY_TOKEN',
      'INITPAD_REGISTRY',
      'INITPAD_PLATFORM_URL',
      'INITPAD_REGISTRY_USER',
      'INITPAD_REGISTRY_PASSWORD',
    ];
    for (const secret of secrets) {
      const removed = await fetch(
        `${url}/api/v1/repos/${repo}/actions/secrets/${encodeURIComponent(secret)}`,
        { method: 'DELETE', headers },
      );
      if (!removed.ok && removed.status !== 404) {
        throw new Error(`Could not remove Actions secret '${secret}' (HTTP ${removed.status})`);
      }
    }
    const disabled = await fetch(`${url}/api/v1/repos/${repo}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ has_actions: false }),
    });
    if (!disabled.ok) {
      throw new Error(
        `Could not disable Actions on the detached repository (HTTP ${disabled.status})`,
      );
    }
  }

  // Lists repositories the user owns/collaborates on (for existing-repo import).
  // Uses the admin token against the user's namespace so it works even when the
  // stored per-user token is an OAuth JWT rather than a PAT.
  async listRepositories(actor: ScmActor): Promise<import('./scm-provider').ScmRepo[]> {
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) return [];
    const res = await fetch(
      `${url}/api/v1/users/${encodeURIComponent(actor.username)}/repos?limit=100`,
      { headers: { Authorization: `token ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`Could not list repositories for '${actor.username}' (HTTP ${res.status})`);
    }
    const data = (await res.json()) as Array<{
      name: string;
      full_name: string;
      private: boolean;
      default_branch?: string;
      updated_at?: string;
      empty?: boolean;
    }>;
    return data.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      updatedAt: r.updated_at || '',
      empty: Boolean(r.empty),
    }));
  }

  // Reads a file's text content at a ref (preflight), or null when it is absent.
  async readFile(name: string, path: string, ref: string, actor: ScmActor): Promise<string | null> {
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) return null;
    const res = await fetch(
      `${url}/api/v1/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(ref)}`,
      { headers: { Authorization: `token ${token}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  }

  async setCollaborator(
    repoUrl: string | null,
    username: string,
    role: string,
  ): Promise<void> {
    const repo = this.repoCoordinates(repoUrl);
    if (!repo || repo.owner === username) return;
    const permission = role === 'viewer' ? 'read' : role === 'admin' || role === 'owner' ? 'admin' : 'write';
    const res = await fetch(
      `${config.gitea.internalUrl}/api/v1/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/collaborators/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `token ${config.gitea.adminToken}` },
        body: JSON.stringify({ permission }),
      },
    );
    if (!res.ok && res.status !== 204) {
      throw new Error(`Could not grant ${permission} repository access to '${username}' (HTTP ${res.status})`);
    }
  }

  async removeCollaborator(repoUrl: string | null, username: string): Promise<void> {
    const repo = this.repoCoordinates(repoUrl);
    if (!repo || repo.owner === username) return;
    const res = await fetch(
      `${config.gitea.internalUrl}/api/v1/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/collaborators/${encodeURIComponent(username)}`,
      { method: 'DELETE', headers: { Authorization: `token ${config.gitea.adminToken}` } },
    );
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      throw new Error(`Could not revoke repository access from '${username}' (HTTP ${res.status})`);
    }
  }

  private repoCoordinates(repoUrl: string | null): { owner: string; name: string } | null {
    if (!repoUrl) return null;
    try {
      const parts = new URL(repoUrl).pathname.replace(/\.git$/, '').split('/').filter(Boolean);
      return parts.length >= 2 ? { owner: parts[parts.length - 2], name: parts[parts.length - 1] } : null;
    } catch {
      return null;
    }
  }

  // True only when Gitea explicitly reports the repository as absent (404).
  // Network failures, auth errors etc. return false — the caller must never
  // treat an outage as a deletion.
  async repoMissing(name: string, actor: GiteaActor): Promise<boolean> {
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) return false;
    try {
      const res = await fetch(`${url}/api/v1/repos/${actor.username}/${name}`, {
        headers: { Authorization: `token ${token}` },
        signal: AbortSignal.timeout(2500),
      });
      return res.status === 404;
    } catch {
      return false;
    }
  }

  // Returns commits of the owner's repository, or null when unavailable.
  async listCommits(
    name: string,
    actor: GiteaActor,
    limit = 20,
  ): Promise<{ sha: string; message: string; author: string; date: string }[] | null> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    // Reads use the admin token — the admin sees all repositories, so the
    // state of the per-user token (e.g. overwritten by an OAuth login) does
    // not matter. The path is still namespaced by the repository owner.
    const readToken = adminToken || actor.token;
    if (!url || !readToken) return null;
    try {
      const endpoint = `${url}/api/v1/repos/${actor.username}/${name}/commits?limit=${limit}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `token ${readToken}` },
      });
      if (!res.ok) {
        // 409 = repo empty
        if (res.status !== 409) {
          this.logger.warn(`listCommits ${actor.username}/${name} → HTTP ${res.status}`);
        }
        return null;
      }
      const data = (await res.json()) as Array<{
        sha: string;
        commit: { message: string; author: { name: string; date: string } };
      }>;
      return data.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
      }));
    } catch {
      return null;
    }
  }

  // Gitea 1.22 has no REST endpoint for re-running an Actions workflow. A
  // temporary tag produces a regular push event for the exact same commit,
  // so CI can retry without adding an empty commit or changing source history.
  // Stale InitPad retry tags are removed before creating the next one.
  async createRetryTag(
    name: string,
    sha: string,
    actor: GiteaActor,
  ): Promise<string> {
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) throw new Error('Gitea is not configured');

    const repo = `${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`;
    const headers = { Authorization: `token ${token}` };
    const listed = await fetch(`${url}/api/v1/repos/${repo}/tags?limit=50`, { headers });
    if (listed.ok) {
      const tags = (await listed.json()) as Array<{ name?: string }>;
      await Promise.all(
        tags
          .map((tag) => tag.name ?? '')
          .filter((tag) => tag.startsWith('initpad-retry-'))
          .map((tag) => this.deleteTag(name, tag, actor)),
      );
    }

    const tag = `initpad-retry-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const created = await fetch(`${url}/api/v1/repos/${repo}/tags`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, target: sha }),
    });
    if (!created.ok) {
      throw new Error(`Could not queue the CI retry in Gitea (HTTP ${created.status})`);
    }
    return tag;
  }

  async deleteTag(name: string, tag: string, actor: GiteaActor): Promise<void> {
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token || !tag.startsWith('initpad-retry-')) return;
    await fetch(
      `${url}/api/v1/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE', headers: { Authorization: `token ${token}` } },
    ).catch(() => undefined);
  }

  // Returns commit statuses (one per CI job) for the given commit — the
  // platform assembles the pipeline view from them. Statuses arrive sorted
  // most-recently-updated first.
  async listCommitStatuses(
    name: string,
    sha: string,
    actor: GiteaActor,
  ): Promise<{ context: string; status: string; targetUrl: string | null }[] | null> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    const readToken = adminToken || actor.token;
    if (!url || !readToken) return null;
    try {
      const res = await fetch(
        `${url}/api/v1/repos/${actor.username}/${name}/commits/${sha}/statuses?sort=recentupdate&limit=50`,
        { headers: { Authorization: `token ${readToken}` } },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{
        context: string;
        status: string;
        target_url?: string;
      }>;
      return data.map((s) => ({
        context: s.context,
        status: s.status,
        targetUrl: this.browserUrl(s.target_url),
      }));
    } catch {
      return null;
    }
  }

  private async createRepo(
    name: string,
    actor: GiteaActor,
    ciDeployToken: string,
  ): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    // The repository is created FOR the user via the admin endpoint: the user
    // owns the repo, but the activity feed attributes the action to the
    // service account — consistent with the scaffold push and honest about
    // who actually performed it (automation, not the user).
    const res = await fetch(
      `${url}/api/v1/admin/users/${encodeURIComponent(actor.username)}/repos`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `token ${adminToken}`,
        },
        body: JSON.stringify({ name, private: true, auto_init: false, default_branch: 'main' }),
      },
    );
    // 409 = repo already exists, continue with push
    if (!res.ok && res.status !== 409) {
      throw new Error(`repository creation failed (HTTP ${res.status})`);
    }
    // Enables Actions (CI) for the repository (admin can edit any repo).
    await fetch(`${url}/api/v1/repos/${actor.username}/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ has_actions: true }),
    }).catch(() => undefined);

    await this.configureRepoSecrets(actor.username, name, actor.token, ciDeployToken);
  }

  // Each repository receives its own deploy token and its owner's package
  // credentials. The Gitea administrator token never enters an untrusted CI
  // job. Existing projects are migrated through this same method on startup.
  async configureRepoSecrets(
    owner: string,
    repo: string,
    ownerToken: string,
    ciDeployToken: string,
  ): Promise<void> {
    if (!ownerToken) throw new Error(`No repository/package token available for '${owner}'`);
    await this.setRepoSecret(owner, repo, 'INITPAD_DEPLOY_TOKEN', ciDeployToken);
    await this.configureRepoRuntimeSecrets(owner, repo);
    await this.setRepoSecret(owner, repo, 'INITPAD_REGISTRY_USER', owner);
    await this.setRepoSecret(owner, repo, 'INITPAD_REGISTRY_PASSWORD', ownerToken);
  }

  // Reconciled on every API start because these addresses are configuration,
  // not long-lived credentials. This also upgrades already-created repos when
  // the CI network address changes.
  async configureRepoRuntimeSecrets(owner: string, repo: string): Promise<void> {
    await this.setRepoSecret(owner, repo, 'INITPAD_REGISTRY', config.registry.ciHost);
    await this.setRepoSecret(owner, repo, 'INITPAD_PLATFORM_URL', config.ci.platformUrl);
  }

  private async setRepoSecret(
    owner: string,
    repo: string,
    key: string,
    value: string,
  ): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    const res = await fetch(`${url}/api/v1/repos/${owner}/${repo}/actions/secrets/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ data: value }),
    });
    if (!res.ok) {
      throw new Error(`Could not configure Actions secret '${key}' (HTTP ${res.status})`);
    }
  }

  // Downloads the source tree of an exact commit into a temporary directory.
  // Gitea is the source of truth for code — deployments fetch from it on
  // demand, so the platform keeps no persistent working copies (stateless
  // with respect to repository content). Returns null on any failure; the
  // caller decides on a fallback.
  async downloadArchive(
    name: string,
    ref: string,
    actor: GiteaActor,
  ): Promise<RepoArchive | null> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    const token = adminToken || actor.token;
    if (!url || !token || !ref) return null;

    let res: Response;
    try {
      res = await fetch(
        `${url}/api/v1/repos/${actor.username}/${name}/archive/${encodeURIComponent(ref)}.tar.gz`,
        { headers: { Authorization: `token ${token}` } },
      );
    } catch (e) {
      this.logger.warn(`downloadArchive ${actor.username}/${name}@${ref}: ${(e as Error).message}`);
      return null;
    }
    if (!res.ok || !res.body) {
      this.logger.warn(`downloadArchive ${actor.username}/${name}@${ref} → HTTP ${res.status}`);
      return null;
    }

    const base = mkdtempSync(join(tmpdir(), 'initpad-archive-'));
    const cleanup = () => rmSync(base, { recursive: true, force: true });
    try {
      const extractDir = join(base, 'src');
      await pipeline(
        Readable.fromWeb(res.body as import('stream/web').ReadableStream),
        createGunzip(),
        tar.extract(extractDir),
      );
      // Gitea wraps the archive in a top-level "<repo>/" directory — unwrap it.
      const entries = readdirSync(extractDir);
      const dir =
        entries.length === 1 && statSync(join(extractDir, entries[0])).isDirectory()
          ? join(extractDir, entries[0])
          : extractDir;
      return { dir, cleanup };
    } catch (e) {
      cleanup();
      this.logger.warn(`downloadArchive extract failed: ${(e as Error).message}`);
      return null;
    }
  }

  // Gitea generates target_url with its internal host (http://gitea:3000),
  // which the browser cannot resolve. Rewrite the origin to the public
  // address (INITPAD_GITEA_URL).
  private browserUrl(target?: string): string | null {
    if (!target) return null;
    const base = config.gitea.url?.replace(/\/$/, '');
    if (!base) return target;
    try {
      const u = new URL(target);
      return `${base}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return `${base}${target.startsWith('/') ? '' : '/'}${target}`;
    }
  }

  // Turns the generated directory into a local git repository with an
  // initial commit.
  async initLocal(dir: string, author?: { name: string; email: string }): Promise<void> {
    const name = author?.name || config.git.authorName;
    const email = author?.email || config.git.authorEmail;
    const git = (args: string[]) => exec('git', args, { cwd: dir });
    try {
      await git(['init', '-b', 'main']);
      await git(['add', '-A']);
      await git([
        '-c', `user.name=${name}`,
        '-c', `user.email=${email}`,
        'commit', '-m', 'init: scaffold from template',
      ]);
    } catch (e) {
      this.logger.warn(`Local git init failed: ${(e as Error).message}`);
    }
  }

  private async pushScaffold(name: string, dir: string, actor: GiteaActor): Promise<void> {
    const git = (args: string[]) => exec('git', args, { cwd: dir });
    await git(['remote', 'remove', 'origin']).catch(() => undefined);
    await git(['remote', 'add', 'origin', this.authedRemote(name, actor)]);
    await git(['push', '-u', 'origin', 'main']);
  }

  private authedRemote(name: string, actor: GiteaActor): string {
    const url = config.gitea.internalUrl;
    const { user, adminToken } = config.gitea;
    const sep = url.indexOf('://');
    const scheme = url.slice(0, sep + 3);
    const host = url.slice(sep + 3);
    // Push with admin credentials (the admin has write access to all repos).
    // The repository owner is actor.username; the commit author identity is
    // set separately in initLocal.
    return `${scheme}${encodeURIComponent(user)}:${adminToken}@${host}/${actor.username}/${name}.git`;
  }
}
