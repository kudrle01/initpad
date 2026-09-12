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
import {
  RepoArchive,
  ScmActor,
  ScmProvider,
  ScmRepo,
  ScmRepositoryIdentity,
  ScmRepositoryRef,
} from './scm-provider';
import {
  collectScmPages,
  findInScmPages,
  SCM_DOWNLOAD_TIMEOUT_MS,
  scmFetch,
  scmStatusError,
} from './scm-http';

const exec = promisify(execFile);
const PLATFORM_SECRETS = [
  'INITPAD_DEPLOY_TOKEN',
  'INITPAD_REGISTRY',
  'INITPAD_PLATFORM_URL',
  'INITPAD_REGISTRY_USER',
  'INITPAD_REGISTRY_PASSWORD',
];

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

  private request(
    input: string | URL | Request,
    init: RequestInit = {},
    timeoutMs?: number,
  ): Promise<Response> {
    return scmFetch('Gitea', 'API request', input, init, timeoutMs);
  }

  private assertProvider(repository: ScmRepositoryRef): void {
    if (repository.provider !== 'gitea') {
      throw new Error(
        `Gitea adapter cannot operate on ${repository.provider}:${repository.fullName}`,
      );
    }
  }

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
      const listed = await this.request(`${url}/api/v1/admin/hooks?limit=50`, {
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
            await this.request(`${url}/api/v1/admin/hooks/${h.id}`, {
              method: 'DELETE',
              headers: { Authorization: `token ${adminToken}` },
            }).catch(() => undefined);
          }
        }
      }
      const created = await this.request(`${url}/api/v1/admin/hooks`, {
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
  ): Promise<ScmRepositoryIdentity> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    const repository = await this.createRepo(name, actor, ciDeployToken);
    await this.pushScaffold(repository.name, dir, actor);
    this.logger.log(`Repository created and pushed: ${repository.repoUrl}`);
    return repository;
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
    const res = await this.request(`${url}/api/v1/admin/users`, {
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
      throw scmStatusError('Gitea', 'create user', res, 'Gitea user creation failed');
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
    const res = await this.request(`${url}/api/v1/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ login_name: username, source_id: 0, active }),
    });
    if (!res.ok) {
      throw scmStatusError(
        'Gitea',
        active ? 'activate account' : 'deactivate account',
        res,
        `Could not ${active ? 'activate' : 'deactivate'} the Gitea account`,
      );
    }
  }

  async deleteUser(username: string): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) return;
    await this.request(`${url}/api/v1/admin/users/${encodeURIComponent(username)}?purge=true`, {
      method: 'DELETE',
      headers: { Authorization: `token ${adminToken}` },
    }).catch(() => undefined);
  }

  // Creates the user's personal access token (Basic auth with their
  // password). The platform stores it and can act on the user's behalf.
  async createUserToken(username: string, password: string): Promise<string> {
    const url = config.gitea.internalUrl;
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const res = await this.request(`${url}/api/v1/users/${username}/tokens`, {
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
      throw scmStatusError('Gitea', 'create user token', res, 'Gitea token creation failed');
    }
    const data = (await res.json()) as { sha1: string };
    return data.sha1;
  }

  /**
   * Replaces a managed account's local Gitea password with an unrecoverable
   * random value. Users authenticate through InitPad OIDC and use PATs for
   * Git, so retaining their platform password in Gitea would create a bypass
   * after a password reset or forced account lifecycle change.
   */
  async randomizeUserPassword(username: string): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea admin is not configured');
    const password = `Ip1!${randomBytes(32).toString('base64url')}`;
    const res = await this.request(`${url}/api/v1/admin/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({
        login_name: username,
        source_id: 0,
        password,
        must_change_password: false,
      }),
    });
    if (!res.ok) {
      throw scmStatusError(
        'Gitea',
        'randomize local password',
        res,
        'Could not randomize the local Gitea password',
      );
    }
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
    const edit = await this.request(`${url}/api/v1/admin/users/${encodeURIComponent(username)}`, {
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
      throw scmStatusError(
        'Gitea',
        'prepare clone token',
        edit,
        'Could not provision a git token while setting the temporary password',
      );
    }
    const token = await this.createUserToken(username, tempPassword);
    await this.randomizeUserPassword(username);
    return token;
  }

  // Deletes all versions of the project's container package (images in the
  // Gitea registry), so no orphaned artifacts remain after project removal.
  async deletePackages(repository: ScmRepositoryRef): Promise<void> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) return;
    const owner = repository.owner;
    const pkgName = repository.name.toLowerCase();
    try {
      const res = await this.request(
        `${url}/api/v1/packages/${owner}?type=container&q=${encodeURIComponent(pkgName)}&limit=100`,
        { headers: { Authorization: `token ${adminToken}` } },
      );
      if (!res.ok) return;
      const pkgs = (await res.json()) as Array<{ type: string; name: string; version: string }>;
      for (const p of pkgs) {
        if (p.type !== 'container' || p.name.toLowerCase() !== pkgName) continue;
        await this.request(
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
  async deleteRepo(repository: ScmRepositoryRef, _actor: GiteaActor): Promise<void> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea is not configured');
    const response = await this.request(
      `${url}/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `token ${adminToken}` },
      },
    );
    if (!response.ok && response.status !== 404) {
      throw scmStatusError(
        'Gitea',
        'delete repository',
        response,
        'Could not delete the Gitea repository',
      );
    }
  }

  // Preserves source code while severing the repository's trust relationship
  // with a deleted InitPad project. In particular, the owner package token
  // must not remain available to future Actions runs after the project-scoped
  // deploy-token hash and authorization record are gone.
  async detachRepo(repository: ScmRepositoryRef, _actor: GiteaActor): Promise<void> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea is not configured');
    await this.removeRepoSecrets(repository);
    const repo = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const headers = { Authorization: `token ${adminToken}` };
    const disabled = await this.request(`${url}/api/v1/repos/${repo}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ has_actions: false }),
    });
    if (!disabled.ok) {
      throw scmStatusError(
        'Gitea',
        'disable repository Actions',
        disabled,
        'Could not disable Actions on the detached repository',
      );
    }
  }

  async removeRepoSecrets(repository: ScmRepositoryRef): Promise<void> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) throw new Error('Gitea is not configured');
    const repo = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const headers = { Authorization: `token ${adminToken}` };
    for (const secret of PLATFORM_SECRETS) {
      const removed = await this.request(
        `${url}/api/v1/repos/${repo}/actions/secrets/${encodeURIComponent(secret)}`,
        { method: 'DELETE', headers },
      );
      if (!removed.ok && removed.status !== 404) {
        throw scmStatusError(
          'Gitea',
          'remove Actions secret',
          removed,
          `Could not remove Actions secret '${secret}'`,
        );
      }
    }
  }

  // Lists repositories the user owns/collaborates on (for existing-repo import).
  // Uses the admin token against the user's namespace so it works even when the
  // stored per-user token is an OAuth JWT rather than a PAT.
  async listRepositories(actor: ScmActor): Promise<ScmRepo[]> {
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) return [];
    type RepositoryPayload = {
      id: number | string;
      name: string;
      full_name: string;
      html_url?: string;
      private: boolean;
      default_branch?: string;
      updated_at?: string;
      empty?: boolean;
    };
    const data = await collectScmPages<RepositoryPayload>({
      provider: 'Gitea',
      operation: 'list repositories',
      pageSize: 100,
      load: async (page) => {
        const res = await this.request(
          `${url}/api/v1/users/${encodeURIComponent(actor.username)}/repos?limit=100&page=${page}`,
          { headers: { Authorization: `token ${token}` } },
        );
        if (!res.ok) {
          throw scmStatusError(
            'Gitea',
            'list repositories',
            res,
            `Could not list repositories for '${actor.username}'`,
          );
        }
        const pageData = (await res.json()) as RepositoryPayload[];
        if (!Array.isArray(pageData)) {
          throw new Error('Gitea returned an invalid repository list');
        }
        return pageData;
      },
    });
    return data.map((r) => ({
      provider: 'gitea',
      repositoryId: String(r.id),
      owner: r.full_name.split('/')[0] || actor.username,
      name: r.name,
      fullName: r.full_name,
      repoUrl: `${config.gitea.url.replace(/\/$/, '')}/${r.full_name}`,
      installationId: null,
      private: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      updatedAt: r.updated_at || '',
      empty: Boolean(r.empty),
    }));
  }

  // Reads a file's text content at a ref (preflight), or null when it is absent.
  async readFile(
    repository: ScmRepositoryRef,
    path: string,
    ref: string,
    actor: ScmActor,
  ): Promise<string | null> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) return null;
    const res = await this.request(
      `${url}/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(ref)}`,
      { headers: { Authorization: `token ${token}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw scmStatusError(
        'Gitea',
        'read repository file',
        res,
        `Could not read '${path}' from ${repository.fullName}`,
      );
    }
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString(
      'utf8',
    );
  }

  async setCollaborator(
    repository: ScmRepositoryRef,
    username: string,
    role: string,
  ): Promise<void> {
    this.assertProvider(repository);
    if (repository.owner === username) return;
    const permission =
      role === 'viewer' ? 'read' : role === 'admin' || role === 'owner' ? 'admin' : 'write';
    await this.setCollaboratorPermission(repository, username, permission);
  }

  private async setCollaboratorPermission(
    repository: ScmRepositoryRef,
    username: string,
    permission: string,
  ): Promise<void> {
    const res = await this.request(
      `${config.gitea.internalUrl}/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/collaborators/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `token ${config.gitea.adminToken}`,
        },
        body: JSON.stringify({ permission }),
      },
    );
    if (!res.ok && res.status !== 204) {
      throw scmStatusError(
        'Gitea',
        'grant collaborator access',
        res,
        `Could not grant ${permission} repository access to '${username}'`,
      );
    }
  }

  async removeCollaborator(repository: ScmRepositoryRef, username: string): Promise<void> {
    this.assertProvider(repository);
    if (repository.owner === username) return;
    const res = await this.request(
      `${config.gitea.internalUrl}/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/collaborators/${encodeURIComponent(username)}`,
      { method: 'DELETE', headers: { Authorization: `token ${config.gitea.adminToken}` } },
    );
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      throw scmStatusError(
        'Gitea',
        'revoke collaborator access',
        res,
        `Could not revoke repository access from '${username}'`,
      );
    }
  }

  async getCollaboratorAccess(
    repository: ScmRepositoryRef,
    username: string,
  ): Promise<string | null> {
    this.assertProvider(repository);
    if (repository.owner === username) return 'owner';
    const base = `${config.gitea.internalUrl}/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const headers = { Authorization: `token ${config.gitea.adminToken}` };
    // The list endpoint contains direct collaborators only. The permission
    // endpoint alone would also return inherited organization/team access.
    const direct = await findInScmPages<{ login?: string; username?: string }, true>({
      provider: 'Gitea',
      operation: 'find direct collaborator',
      pageSize: 100,
      load: async (page) => {
        const listed = await this.request(`${base}/collaborators?limit=100&page=${page}`, {
          headers,
        });
        if (!listed.ok) {
          throw scmStatusError(
            'Gitea',
            'list direct collaborators',
            listed,
            'Could not inspect repository collaborators',
          );
        }
        const users = (await listed.json()) as Array<{ login?: string; username?: string }>;
        if (!Array.isArray(users)) {
          throw new Error('Gitea returned an invalid collaborator list');
        }
        return users;
      },
      find: (users) =>
        users.some((user) => (user.login || user.username) === username) ? true : undefined,
    });
    if (!direct) return null;
    const permission = await this.request(
      `${base}/collaborators/${encodeURIComponent(username)}/permission`,
      { headers },
    );
    if (!permission.ok) {
      throw scmStatusError(
        'Gitea',
        'inspect collaborator permission',
        permission,
        `Could not inspect repository access for '${username}'`,
      );
    }
    const data = (await permission.json()) as { permission?: string };
    if (!data.permission) throw new Error(`Gitea returned no permission for '${username}'`);
    return data.permission;
  }

  async restoreCollaboratorAccess(
    repository: ScmRepositoryRef,
    username: string,
    access: string | null,
  ): Promise<void> {
    this.assertProvider(repository);
    if (repository.owner === username) return;
    if (access == null) return this.removeCollaborator(repository, username);
    await this.setCollaboratorPermission(repository, username, access);
  }

  // True only when Gitea explicitly reports the repository as absent (404).
  // Network failures, auth errors etc. return false — the caller must never
  // treat an outage as a deletion.
  async repoMissing(repository: ScmRepositoryRef, actor: GiteaActor): Promise<boolean> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) return false;
    try {
      const res = await this.request(`${url}/api/v1/repos/${repository.owner}/${repository.name}`, {
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
    repository: ScmRepositoryRef,
    actor: GiteaActor,
    limit = 20,
  ): Promise<{ sha: string; message: string; author: string; date: string }[] | null> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    // Reads use the admin token — the admin sees all repositories, so the
    // state of the per-user token (e.g. overwritten by an OAuth login) does
    // not matter. The path is still namespaced by the repository owner.
    const readToken = adminToken || actor.token;
    if (!url || !readToken) return null;
    try {
      const endpoint = `${url}/api/v1/repos/${repository.owner}/${repository.name}/commits?limit=${limit}`;
      const res = await this.request(endpoint, {
        headers: { Authorization: `token ${readToken}` },
      });
      if (!res.ok) {
        // 409 = repo empty
        if (res.status !== 409) {
          this.logger.warn(`listCommits ${repository.fullName} → HTTP ${res.status}`);
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
    repository: ScmRepositoryRef,
    sha: string,
    actor: GiteaActor,
  ): Promise<string> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token) throw new Error('Gitea is not configured');

    const repo = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const headers = { Authorization: `token ${token}` };
    const listed = await this.request(`${url}/api/v1/repos/${repo}/tags?limit=50`, { headers });
    if (listed.ok) {
      const tags = (await listed.json()) as Array<{ name?: string }>;
      await Promise.all(
        tags
          .map((tag) => tag.name ?? '')
          .filter((tag) => tag.startsWith('initpad-retry-'))
          .map((tag) => this.deleteTag(repository, tag, actor)),
      );
    }

    const tag = `initpad-retry-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const created = await this.request(`${url}/api/v1/repos/${repo}/tags`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, target: sha }),
    });
    if (!created.ok) {
      throw scmStatusError(
        'Gitea',
        'create CI retry tag',
        created,
        'Could not queue the CI retry in Gitea',
      );
    }
    return tag;
  }

  async deleteTag(repository: ScmRepositoryRef, tag: string, actor: GiteaActor): Promise<void> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const token = config.gitea.adminToken || actor.token;
    if (!url || !token || !tag.startsWith('initpad-retry-')) return;
    await this.request(
      `${url}/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tags/${encodeURIComponent(tag)}`,
      { method: 'DELETE', headers: { Authorization: `token ${token}` } },
    ).catch(() => undefined);
  }

  // Returns commit statuses (one per CI job) for the given commit — the
  // platform assembles the pipeline view from them. Statuses arrive sorted
  // most-recently-updated first.
  async listCommitStatuses(
    repository: ScmRepositoryRef,
    sha: string,
    actor: GiteaActor,
    _preferredRunId?: string | null,
  ): Promise<{ context: string; status: string; targetUrl: string | null }[] | null> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    const readToken = adminToken || actor.token;
    if (!url || !readToken) return null;
    try {
      const res = await this.request(
        `${url}/api/v1/repos/${repository.owner}/${repository.name}/commits/${sha}/statuses?sort=recentupdate&limit=50`,
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
  ): Promise<ScmRepositoryIdentity> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    // The repository is created FOR the user via the admin endpoint: the user
    // owns the repo, but the activity feed attributes the action to the
    // service account — consistent with the scaffold push and honest about
    // who actually performed it (automation, not the user).
    const res = await this.request(
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
    // 409 = repo already exists, continue with push after resolving its real
    // immutable id. Never persist an invented id derived from mutable names.
    if (!res.ok && res.status !== 409) {
      throw scmStatusError('Gitea', 'create repository', res, 'Repository creation failed');
    }
    let data = res.ok
      ? ((await res.json().catch(() => null)) as {
          id?: number | string;
          name?: string;
          full_name?: string;
          default_branch?: string;
        } | null)
      : null;
    if (!data?.id) {
      const resolved = await this.request(
        `${url}/api/v1/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`,
        { headers: { Authorization: `token ${adminToken}` } },
      );
      if (!resolved.ok) {
        throw scmStatusError(
          'Gitea',
          'resolve repository identity',
          resolved,
          'Repository identity lookup failed',
        );
      }
      data = (await resolved.json()) as typeof data;
    }
    if (!data?.id) throw new Error('repository identity lookup returned no id');

    const fullName = data.full_name || `${actor.username}/${data.name || name}`;
    const repository: ScmRepositoryIdentity = {
      provider: 'gitea',
      repositoryId: String(data.id),
      owner: fullName.split('/')[0] || actor.username,
      name: data.name || name,
      fullName,
      defaultBranch: data.default_branch || 'main',
      repoUrl: `${config.gitea.url.replace(/\/$/, '')}/${fullName}`,
      installationId: null,
    };

    // Enables Actions (CI) for the repository (admin can edit any repo).
    await this.request(`${url}/api/v1/repos/${actor.username}/${name}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ has_actions: true }),
    }).catch(() => undefined);

    await this.configureRepoSecrets(repository, actor.token, ciDeployToken);
    return repository;
  }

  // Each repository receives its own deploy token and its owner's package
  // credentials. The Gitea administrator token never enters an untrusted CI
  // job. Existing projects are migrated through this same method on startup.
  async configureRepoSecrets(
    repository: ScmRepositoryRef,
    ownerToken: string,
    ciDeployToken: string,
  ): Promise<void> {
    this.assertProvider(repository);
    if (!ownerToken) {
      throw new Error(`No repository/package token available for '${repository.owner}'`);
    }
    await this.setRepoSecret(
      repository.owner,
      repository.name,
      'INITPAD_DEPLOY_TOKEN',
      ciDeployToken,
    );
    await this.configureRepoRuntimeSecrets(repository);
    await this.setRepoSecret(
      repository.owner,
      repository.name,
      'INITPAD_REGISTRY_USER',
      repository.owner,
    );
    await this.setRepoSecret(
      repository.owner,
      repository.name,
      'INITPAD_REGISTRY_PASSWORD',
      ownerToken,
    );
  }

  // Reconciled on every API start because these addresses are configuration,
  // not long-lived credentials. This also upgrades already-created repos when
  // the CI network address changes.
  async configureRepoRuntimeSecrets(repository: ScmRepositoryRef): Promise<void> {
    this.assertProvider(repository);
    await this.setRepoSecret(
      repository.owner,
      repository.name,
      'INITPAD_REGISTRY',
      config.registry.ciHost,
    );
    await this.setRepoSecret(
      repository.owner,
      repository.name,
      'INITPAD_PLATFORM_URL',
      config.ci.platformUrl,
    );
  }

  private async setRepoSecret(
    owner: string,
    repo: string,
    key: string,
    value: string,
  ): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    const res = await this.request(`${url}/api/v1/repos/${owner}/${repo}/actions/secrets/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ data: value }),
    });
    if (!res.ok) {
      throw scmStatusError(
        'Gitea',
        'configure Actions secret',
        res,
        `Could not configure Actions secret '${key}'`,
      );
    }
  }

  // Downloads the source tree of an exact commit into a temporary directory.
  // Gitea is the source of truth for code — deployments fetch from it on
  // demand, so the platform keeps no persistent working copies (stateless
  // with respect to repository content). Returns null on any failure; the
  // caller decides on a fallback.
  async downloadArchive(
    repository: ScmRepositoryRef,
    ref: string,
    actor: GiteaActor,
  ): Promise<RepoArchive | null> {
    this.assertProvider(repository);
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    const token = adminToken || actor.token;
    if (!url || !token || !ref) return null;

    let res: Response;
    try {
      res = await this.request(
        `${url}/api/v1/repos/${repository.owner}/${repository.name}/archive/${encodeURIComponent(ref)}.tar.gz`,
        { headers: { Authorization: `token ${token}` } },
        SCM_DOWNLOAD_TIMEOUT_MS,
      );
    } catch (e) {
      this.logger.warn(`downloadArchive ${repository.fullName}@${ref}: ${(e as Error).message}`);
      return null;
    }
    if (!res.ok || !res.body) {
      this.logger.warn(`downloadArchive ${repository.fullName}@${ref} → HTTP ${res.status}`);
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
        '-c',
        `user.name=${name}`,
        '-c',
        `user.email=${email}`,
        'commit',
        '-m',
        'init: scaffold from template',
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
