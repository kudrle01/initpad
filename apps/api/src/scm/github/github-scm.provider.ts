import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createGunzip } from 'zlib';
import sodium from 'libsodium-wrappers';
import * as tar from 'tar-fs';
import { config } from '../../config';
import {
  RepoArchive,
  ScmActor,
  ScmCommit,
  ScmCommitStatus,
  ScmProvider,
  ScmProvisionTarget,
  ScmRepo,
  ScmRepositoryIdentity,
  ScmRepositoryRef,
} from '../scm-provider';
import { GitHubInstallationService } from './github-installation.service';
import { GitHubUserCredentialService } from './github-user-credential.service';

const READ_CONTENTS = { metadata: 'read', contents: 'read' };
const READ_STATUSES = { metadata: 'read', contents: 'read', statuses: 'read' };
const READ_CHECKS = { metadata: 'read', contents: 'read', checks: 'read' };
const WRITE_CONTENTS = { metadata: 'read', contents: 'write' };
const WRITE_SCAFFOLD = { metadata: 'read', contents: 'write', workflows: 'write' };
const WRITE_ADMINISTRATION = { metadata: 'read', administration: 'write' };
const DETACH_REPOSITORY = {
  metadata: 'read',
  administration: 'write',
  secrets: 'write',
};
const WRITE_PACKAGES = { metadata: 'read', packages: 'write' };
const WRITE_SECRETS = { metadata: 'read', secrets: 'write' };
const exec = promisify(execFile);

/**
 * The GitHub adapter of {@link ScmProvider}. Repository reads run on short-lived
 * installation tokens resolved per explicit binding (ADR-030). Personal repo
 * creation uses the user's rotatable App token; organization creation and every
 * subsequent operation use short-lived installation tokens.
 */
@Injectable()
export class GitHubScmProvider implements ScmProvider {
  private readonly logger = new Logger('GitHubScmProvider');

  constructor(
    private readonly installations: GitHubInstallationService,
    private readonly userCredentials: GitHubUserCredentialService,
  ) {}

  private assertProvider(repository: ScmRepositoryRef): void {
    if (repository.provider !== 'github') {
      throw new Error(
        `GitHub adapter cannot operate on ${repository.provider}:${repository.fullName}`,
      );
    }
  }

  private async token(
    repository: Pick<ScmRepositoryRef, 'owner' | 'installationId'>,
    permissions: Record<string, string> = READ_CONTENTS,
  ): Promise<string> {
    const result = repository.installationId
      ? await this.installations.tokenForBinding(repository.installationId, { permissions })
      : await this.installations.tokenForOwner(repository.owner, { permissions });
    return result.token;
  }

  private async gh(
    path: string,
    token: string,
    init?: { method?: string; body?: unknown },
  ): Promise<Response> {
    return fetch(`${config.github.apiBaseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  // Maps a workspace role to a GitHub collaborator permission.
  private permissionFor(role: string): string {
    if (role === 'viewer') return 'pull';
    if (role === 'admin' || role === 'owner') return 'admin';
    if (role === 'maintainer') return 'maintain';
    return 'push';
  }

  async listRepositories(actor: ScmActor): Promise<ScmRepo[]> {
    const installation = actor.installationId
      ? await this.installations.findById(actor.installationId)
      : await this.installations.findByOwner(actor.username);
    if (!installation) throw new Error(`No GitHub App installation found for '${actor.username}'`);
    const token = (
      actor.installationId
        ? await this.installations.tokenForBinding(actor.installationId, { permissions: READ_CONTENTS })
        : await this.installations.tokenForOwner(actor.username, { permissions: READ_CONTENTS })
    ).token;
    const repositories: Array<{
        id: number | string;
        name: string;
        full_name: string;
        html_url?: string;
        private: boolean;
        default_branch?: string;
        updated_at?: string;
        size?: number;
      }> = [];
    for (let page = 1; page <= 100; page += 1) {
      const res = await this.gh(`/installation/repositories?per_page=100&page=${page}`, token);
      if (!res.ok) throw new Error(`Could not list GitHub repositories (HTTP ${res.status})`);
      const data = (await res.json()) as { repositories?: typeof repositories };
      if (!Array.isArray(data.repositories)) {
        throw new Error('GitHub returned an invalid repository list');
      }
      repositories.push(...data.repositories);
      if (data.repositories.length < 100) break;
    }
    return repositories.map((r) => ({
      provider: 'github',
      repositoryId: String(r.id),
      owner: r.full_name.split('/')[0] || actor.username,
      name: r.name,
      fullName: r.full_name,
      repoUrl: r.html_url || `https://github.com/${r.full_name}`,
      installationId: installation.id,
      private: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      updatedAt: r.updated_at || '',
      empty: (r.size ?? 0) === 0,
    }));
  }

  async readFile(
    repository: ScmRepositoryRef,
    path: string,
    ref: string,
    _actor: ScmActor,
  ): Promise<string | null> {
    this.assertProvider(repository);
    const token = await this.token(repository);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(ref)}`,
      token,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Could not read '${path}' from ${repository.fullName} (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  }

  async repoMissing(repository: ScmRepositoryRef, _actor: ScmActor): Promise<boolean> {
    this.assertProvider(repository);
    try {
      const token = await this.token(repository);
      const res = await this.gh(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`, token);
      return res.status === 404;
    } catch {
      // An outage or missing installation must never be read as "deleted".
      return false;
    }
  }

  async listCommits(
    repository: ScmRepositoryRef,
    _actor: ScmActor,
    limit = 20,
  ): Promise<ScmCommit[] | null> {
    this.assertProvider(repository);
    try {
      const token = await this.token(repository);
      const res = await this.gh(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits?per_page=${limit}`,
        token,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{
        sha: string;
        commit: { message: string; author?: { name?: string; date?: string } };
      }>;
      return data.map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author?.name ?? '',
        date: c.commit.author?.date ?? '',
      }));
    } catch {
      return null;
    }
  }

  async listCommitStatuses(
    repository: ScmRepositoryRef,
    sha: string,
    _actor: ScmActor,
  ): Promise<ScmCommitStatus[] | null> {
    this.assertProvider(repository);
    try {
      // GitHub Actions reports jobs as Check Runs, not classic commit
      // statuses. Map that native model onto InitPad's provider-neutral shape.
      const checksToken = await this.token(repository, READ_CHECKS);
      const checksResponse = await this.gh(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
        checksToken,
      );
      if (checksResponse.ok) {
        const data = (await checksResponse.json()) as {
          check_runs?: Array<{
            name?: string;
            status?: string;
            conclusion?: string | null;
            details_url?: string | null;
          }>;
        };
        const checks = data.check_runs ?? [];
        if (checks.length > 0) {
          return checks.map((check) => ({
            context: check.name ?? '',
            status:
              check.status !== 'completed'
                ? 'pending'
                : check.conclusion === 'success'
                  ? 'success'
                  : check.conclusion === 'skipped' || check.conclusion === 'neutral'
                    ? 'pending'
                    : 'failure',
            targetUrl: check.details_url ?? null,
          }));
        }
      }
    } catch {
      // Older App registrations may not yet grant Checks:read. Preserve the
      // classic-status fallback while the administrator updates permissions.
    }
    try {
      const token = await this.token(repository, READ_STATUSES);
      const res = await this.gh(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(sha)}/status`,
        token,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        statuses?: Array<{ context: string; state: string; target_url?: string }>;
      };
      return (data.statuses ?? []).map((s) => ({
        context: s.context,
        status: s.state,
        targetUrl: s.target_url ?? null,
      }));
    } catch {
      return null;
    }
  }

  async deleteRepo(repository: ScmRepositoryRef, _actor: ScmActor): Promise<void> {
    this.assertProvider(repository);
    const token = await this.token(repository, WRITE_ADMINISTRATION);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      token,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Could not delete the GitHub repository (HTTP ${res.status})`);
    }
  }

  // Severs the repo's trust with a deleted project: remove platform secrets and
  // disable Actions, keeping the source code (mirrors the Gitea adapter).
  async detachRepo(repository: ScmRepositoryRef, _actor: ScmActor): Promise<void> {
    this.assertProvider(repository);
    const token = await this.token(repository, DETACH_REPOSITORY);
    const repo = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    for (const secret of PLATFORM_SECRETS) {
      const res = await this.gh(`/repos/${repo}/actions/secrets/${secret}`, token, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Could not remove Actions secret '${secret}' (HTTP ${res.status})`);
      }
    }
    const disabled = await this.gh(`/repos/${repo}/actions/permissions`, token, {
      method: 'PUT',
      body: { enabled: false },
    });
    if (!disabled.ok) {
      throw new Error(`Could not disable Actions on the detached repository (HTTP ${disabled.status})`);
    }
  }

  async setCollaborator(
    repository: ScmRepositoryRef,
    username: string,
    role: string,
  ): Promise<void> {
    this.assertProvider(repository);
    if (repository.owner === username) return;
    const token = await this.token(repository, WRITE_ADMINISTRATION);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/collaborators/${encodeURIComponent(username)}`,
      token,
      { method: 'PUT', body: { permission: this.permissionFor(role) } },
    );
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`Could not grant repository access to '${username}' (HTTP ${res.status})`);
    }
  }

  async removeCollaborator(repository: ScmRepositoryRef, username: string): Promise<void> {
    this.assertProvider(repository);
    if (repository.owner === username) return;
    const token = await this.token(repository, WRITE_ADMINISTRATION);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/collaborators/${encodeURIComponent(username)}`,
      token,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      throw new Error(`Could not revoke repository access from '${username}' (HTTP ${res.status})`);
    }
  }

  // Queues a CI re-run by tagging the exact commit, replacing any stale
  // InitPad retry tags first (the "run again without an empty commit" path).
  async createRetryTag(
    repository: ScmRepositoryRef,
    sha: string,
    actor: ScmActor,
  ): Promise<string> {
    this.assertProvider(repository);
    const token = await this.token(repository, WRITE_CONTENTS);
    const repo = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const listed = await this.gh(`/repos/${repo}/git/matching-refs/tags/initpad-retry-`, token);
    if (listed.ok) {
      const refs = (await listed.json()) as Array<{ ref?: string }>;
      await Promise.all(
        refs
          .map((r) => (r.ref ?? '').replace(/^refs\/tags\//, ''))
          .filter((t) => t.startsWith('initpad-retry-'))
          .map((t) => this.deleteTag(repository, t, actor)),
      );
    }
    const tag = `initpad-retry-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const created = await this.gh(`/repos/${repo}/git/refs`, token, {
      method: 'POST',
      body: { ref: `refs/tags/${tag}`, sha },
    });
    if (!created.ok) throw new Error(`Could not queue the CI retry on GitHub (HTTP ${created.status})`);
    return tag;
  }

  async deleteTag(repository: ScmRepositoryRef, tag: string, _actor: ScmActor): Promise<void> {
    this.assertProvider(repository);
    const token = await this.token(repository, WRITE_CONTENTS);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/refs/tags/${encodeURIComponent(tag)}`,
      token,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404 && res.status !== 422) {
      throw new Error(`Could not delete tag '${tag}' (HTTP ${res.status})`);
    }
  }

  // Best-effort GHCR container package removal after project deletion.
  async deletePackages(repository: ScmRepositoryRef): Promise<void> {
    this.assertProvider(repository);
    try {
      const token = await this.token(repository, WRITE_PACKAGES);
      const installation = repository.installationId
        ? await this.installations.findById(repository.installationId)
        : null;
      const ownerPath = installation?.accountType === 'Organization' ? 'orgs' : 'users';
      await this.gh(
        `/${ownerPath}/${encodeURIComponent(repository.owner)}/packages/container/${encodeURIComponent(repository.name.toLowerCase())}`,
        token,
        { method: 'DELETE' },
      );
    } catch {
      // Best-effort; a missing package or permission is not fatal to cleanup.
    }
  }

  // Git-over-HTTP clone credential = a short-lived installation token used with
  // the x-access-token user. Callers embed it as the password.
  async issueCloneToken(username: string): Promise<string> {
    return (await this.installations.tokenForOwner(username, { permissions: READ_CONTENTS })).token;
  }

  async provision(
    name: string,
    dir: string,
    actor: ScmActor,
    ciDeployToken: string,
    target?: ScmProvisionTarget,
  ): Promise<ScmRepositoryIdentity> {
    if (!target) {
      throw new Error('A workspace-authorized GitHub installation is required');
    }
    const installation = await this.installations.findById(target.installationId);
    if (!installation || installation.deletedAt) {
      throw new Error('The selected GitHub App installation is no longer available');
    }
    if (installation.suspendedAt) {
      throw new Error(`The GitHub App installation for '${installation.accountLogin}' is suspended`);
    }
    if (!installation.accountId) {
      throw new Error('The selected GitHub App installation has no verified account identity');
    }
    if (installation.accountType !== 'User' && installation.accountType !== 'Organization') {
      throw new Error('The selected GitHub App installation has an unsupported account type');
    }

    let createToken: string;
    if (installation.accountType === 'Organization') {
      createToken = (
          await this.installations.tokenForBinding(installation.id, {
            permissions: WRITE_ADMINISTRATION,
          })
        ).token;
    } else {
      await this.userCredentials.assertAccountForUser(target.userId, installation.accountId);
      createToken = await this.userCredentials.accessTokenForUser(target.userId);
    }
    const path = installation.accountType === 'Organization'
      ? `/orgs/${encodeURIComponent(installation.accountLogin)}/repos`
      : '/user/repos';
    const response = await this.gh(path, createToken, {
      method: 'POST',
      body: { name, private: true, auto_init: false },
    });
    if (!response.ok) {
      const reason = response.status === 422
        ? `A repository named '${name}' already exists or GitHub rejected the name`
        : `GitHub repository creation failed (HTTP ${response.status})`;
      throw new Error(reason);
    }
    let created: {
      id?: number | string;
      name?: string;
      full_name?: string;
      html_url?: string;
      owner?: { id?: number | string; login?: string };
    } = {};
    try {
      created = (await response.json()) as typeof created;
      if (
        created.id == null ||
        created.name !== name ||
        !created.full_name ||
        !created.html_url ||
        created.owner?.id == null ||
        String(created.owner.id) !== installation.accountId ||
        !created.owner.login
      ) {
        throw new Error('GitHub returned an invalid repository identity');
      }
    } catch (error) {
      // HTTP 201 proves this request created the repo. Even if the response is
      // malformed, delete it with the same credential that created it. This is
      // important for personal repos: an installation token for another
      // account must never be used as a best-effort cleanup credential.
      const cleanupOwner = created?.owner?.login || installation.accountLogin;
      await this.gh(
        `/repos/${encodeURIComponent(cleanupOwner)}/${encodeURIComponent(name)}`,
        createToken,
        { method: 'DELETE' },
      ).then((cleanupResponse) => {
        if (!cleanupResponse.ok && cleanupResponse.status !== 404) {
          throw new Error(`GitHub repository cleanup failed (HTTP ${cleanupResponse.status})`);
        }
      }).catch((cleanupError) => {
        this.logger.error(
          `GitHub repository rollback failed after an invalid response: ${(cleanupError as Error).message}`,
        );
      });
      throw error;
    }
    const repository: ScmRepositoryIdentity = {
      provider: 'github',
      repositoryId: String(created.id),
      owner: created.owner.login,
      name: created.name,
      fullName: created.full_name,
      defaultBranch: 'main',
      repoUrl: created.html_url,
      installationId: installation.id,
    };

    try {
      // Secrets must exist before the first push triggers GitHub Actions.
      await this.configureRepoSecrets(repository, '', ciDeployToken);
      const pushToken = (
        await this.installations.tokenForBinding(installation.id, {
          permissions: WRITE_SCAFFOLD,
        })
      ).token;
      await this.pushScaffold(repository, dir, pushToken);
      this.logger.log(`Repository created and pushed: ${repository.repoUrl}`);
      return repository;
    } catch (error) {
      await this.deleteRepo(repository, actor).catch((cleanupError) => {
        this.logger.error(
          `GitHub repository rollback failed for ${repository.fullName}: ${(cleanupError as Error).message}`,
        );
      });
      throw error;
    }
  }

  async configureRepoSecrets(
    repository: ScmRepositoryRef,
    _ownerToken: string,
    ciDeployToken: string,
  ): Promise<void> {
    this.assertProvider(repository);
    await this.setRepoSecrets(repository, {
      INITPAD_DEPLOY_TOKEN: ciDeployToken,
      INITPAD_REGISTRY: 'ghcr.io',
      INITPAD_PLATFORM_URL: config.auth.frontendUrl.replace(/\/+$/, ''),
    });
  }

  async configureRepoRuntimeSecrets(repository: ScmRepositoryRef): Promise<void> {
    this.assertProvider(repository);
    await this.setRepoSecrets(repository, {
      INITPAD_REGISTRY: 'ghcr.io',
      INITPAD_PLATFORM_URL: config.auth.frontendUrl.replace(/\/+$/, ''),
    });
  }

  async downloadArchive(
    repository: ScmRepositoryRef,
    ref: string,
    _actor: ScmActor,
  ): Promise<RepoArchive | null> {
    this.assertProvider(repository);
    if (!ref) return null;
    try {
      const token = await this.token(repository, READ_CONTENTS);
      const res = await this.gh(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/tarball/${encodeURIComponent(ref)}`,
        token,
      );
      if (!res.ok || !res.body) {
        this.logger.warn(`downloadArchive ${repository.fullName}@${ref} → HTTP ${res.status}`);
        return null;
      }
      const base = mkdtempSync(join(tmpdir(), 'initpad-github-archive-'));
      const cleanup = () => rmSync(base, { recursive: true, force: true });
      try {
        const extractDir = join(base, 'src');
        await pipeline(
          Readable.fromWeb(res.body as import('stream/web').ReadableStream),
          createGunzip(),
          tar.extract(extractDir),
        );
        const entries = readdirSync(extractDir);
        const dir =
          entries.length === 1 && statSync(join(extractDir, entries[0])).isDirectory()
            ? join(extractDir, entries[0])
            : extractDir;
        return { dir, cleanup };
      } catch (error) {
        cleanup();
        this.logger.warn(`downloadArchive extract failed: ${(error as Error).message}`);
        return null;
      }
    } catch (error) {
      this.logger.warn(`downloadArchive ${repository.fullName}@${ref}: ${(error as Error).message}`);
      return null;
    }
  }

  async initLocal(dir: string, author?: { name: string; email: string }): Promise<void> {
    this.prepareGitHubActions(dir);
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
    } catch (error) {
      this.logger.warn(`Local git init failed: ${(error as Error).message}`);
    }
  }

  /**
   * Templates are shared with Gitea Actions. GitHub uses the same workflow
   * syntax but a different discovery directory and its ephemeral GITHUB_TOKEN
   * for GHCR, so no long-lived registry password is needed in SaaS.
   */
  private prepareGitHubActions(dir: string): void {
    const giteaDir = join(dir, '.gitea');
    const githubDir = join(dir, '.github');
    if (!existsSync(giteaDir)) return;
    if (existsSync(githubDir)) {
      throw new Error('The scaffold contains both .gitea and .github workflow directories');
    }
    renameSync(giteaDir, githubDir);
    const workflowDir = join(githubDir, 'workflows');
    if (!existsSync(workflowDir)) return;
    for (const entry of readdirSync(workflowDir)) {
      if (!/\.ya?ml$/i.test(entry)) continue;
      const path = join(workflowDir, entry);
      let workflow = readFileSync(path, 'utf8');
      if (!/^permissions:/m.test(workflow)) {
        workflow = workflow.replace(
          /^on: \[push\]$/m,
          'on: [push]\n\npermissions:\n  contents: read\n  packages: write',
        );
      }
      workflow = workflow
        .replace(/\$\{\{ secrets\.INITPAD_REGISTRY_PASSWORD \}\}/g, '${{ secrets.GITHUB_TOKEN }}')
        .replace(/\$\{\{ secrets\.INITPAD_REGISTRY_USER \}\}/g, '${{ github.actor }}');
      if (workflow.includes('INITPAD_REGISTRY_PASSWORD') || workflow.includes('INITPAD_REGISTRY_USER')) {
        throw new Error(`Could not adapt GitHub Actions registry login in '${entry}'`);
      }
      if (!/^permissions:/m.test(workflow)) {
        throw new Error(`Could not add least-privilege GitHub Actions permissions in '${entry}'`);
      }
      writeFileSync(path, workflow);
    }
  }

  private async pushScaffold(
    repository: ScmRepositoryIdentity,
    dir: string,
    token: string,
  ): Promise<void> {
    const git = (args: string[], env?: NodeJS.ProcessEnv) =>
      exec('git', args, { cwd: dir, env: env ? { ...process.env, ...env } : process.env });
    const remote = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}.git`;
    await git(['remote', 'remove', 'origin']).catch(() => undefined);
    await git(['remote', 'add', 'origin', remote]);
    try {
      // Pass auth through Git's process environment. It never enters argv,
      // the remote URL, .git/config, logs or the generated repository.
      const authorization = Buffer.from(`x-access-token:${token}`).toString('base64');
      await git(['push', '-u', 'origin', 'main'], {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${authorization}`,
        GIT_TERMINAL_PROMPT: '0',
      });
    } finally {
      await git(['remote', 'remove', 'origin']).catch(() => undefined);
    }
  }

  private async setRepoSecrets(
    repository: ScmRepositoryRef,
    values: Record<string, string>,
  ): Promise<void> {
    const token = await this.token(repository, WRITE_SECRETS);
    const repo = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const keyResponse = await this.gh(`/repos/${repo}/actions/secrets/public-key`, token);
    if (!keyResponse.ok) {
      throw new Error(`Could not read the GitHub Actions public key (HTTP ${keyResponse.status})`);
    }
    const key = (await keyResponse.json()) as { key_id?: string; key?: string };
    if (!key.key_id || !key.key) throw new Error('GitHub returned an incomplete Actions public key');

    await sodium.ready;
    const publicKey = sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL);
    for (const [name, value] of Object.entries(values)) {
      const encrypted = sodium.crypto_box_seal(sodium.from_string(value), publicKey);
      const encryptedValue = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
      const response = await this.gh(`/repos/${repo}/actions/secrets/${name}`, token, {
        method: 'PUT',
        body: { encrypted_value: encryptedValue, key_id: key.key_id },
      });
      if (!response.ok && response.status !== 201 && response.status !== 204) {
        throw new Error(`Could not configure GitHub Actions secret '${name}' (HTTP ${response.status})`);
      }
    }
  }
}

const PLATFORM_SECRETS = [
  'INITPAD_DEPLOY_TOKEN',
  'INITPAD_REGISTRY',
  'INITPAD_PLATFORM_URL',
  'INITPAD_REGISTRY_USER',
  'INITPAD_REGISTRY_PASSWORD',
];
