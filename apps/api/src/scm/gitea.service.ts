import { Injectable, Logger } from '@nestjs/common';
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

const exec = promisify(execFile);

// A commit's source tree downloaded into a temporary directory. The caller
// must invoke cleanup() once the contents are no longer needed.
export interface RepoArchive {
  dir: string;
  cleanup: () => void;
}

// Identity used for repository operations (the project owner).
export interface GiteaActor {
  username: string;
  token: string;
}

/**
 * Integration with the Gitea SCM. Creates repositories and pushes scaffolds
 * on behalf of the owning user, provisions accounts via the admin API
 * (managed registration) and reads commits / CI commit statuses.
 */
@Injectable()
export class GiteaService {
  private readonly logger = new Logger('GiteaService');

  async provision(
    name: string,
    dir: string,
    actor: GiteaActor,
  ): Promise<{ repoUrl: string }> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) {
      throw new Error('Gitea admin is not configured (INITPAD_GITEA_URL/TOKEN)');
    }
    await this.createRepo(name, actor);
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

  // Deletes the repository in Gitea (best-effort; admin can access any repo).
  async deleteRepo(name: string, actor: GiteaActor): Promise<void> {
    const url = config.gitea.internalUrl;
    const { adminToken } = config.gitea;
    if (!url || !adminToken) return;
    await fetch(`${url}/api/v1/repos/${actor.username}/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `token ${adminToken}` },
    }).catch(() => undefined);
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

  private async createRepo(name: string, actor: GiteaActor): Promise<void> {
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

    // Actions secrets: the deploy-webhook token + registry credentials
    // (build once, deploy many — CI pushes the image, the platform pulls it)
    // + addresses of the registry and the platform as seen from CI jobs, so
    // the generated workflow contains no hard-coded hosts.
    await this.setRepoSecret(actor.username, name, 'INITPAD_DEPLOY_TOKEN', config.ci.deployToken);
    await this.setRepoSecret(actor.username, name, 'INITPAD_REGISTRY', config.registry.host);
    await this.setRepoSecret(actor.username, name, 'INITPAD_PLATFORM_URL', config.ci.platformUrl);
    await this.setRepoSecret(actor.username, name, 'INITPAD_REGISTRY_USER', config.registry.user);
    await this.setRepoSecret(
      actor.username,
      name,
      'INITPAD_REGISTRY_PASSWORD',
      config.registry.password,
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
    await fetch(`${url}/api/v1/repos/${owner}/${repo}/actions/secrets/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${adminToken}` },
      body: JSON.stringify({ data: value }),
    }).catch(() => undefined);
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
