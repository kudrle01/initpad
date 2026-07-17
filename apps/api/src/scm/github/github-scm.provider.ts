import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { config } from '../../config';
import {
  RepoArchive,
  ScmActor,
  ScmCommit,
  ScmCommitStatus,
  ScmProvider,
  ScmRepo,
} from '../scm-provider';
import { GitHubInstallationService } from './github-installation.service';

const READ_CONTENTS = { metadata: 'read', contents: 'read' };
const READ_STATUSES = { metadata: 'read', contents: 'read', statuses: 'read' };
const WRITE_CONTENTS = { metadata: 'read', contents: 'write' };
const WRITE_ADMINISTRATION = { metadata: 'read', administration: 'write' };
const DETACH_REPOSITORY = {
  metadata: 'read',
  administration: 'write',
  secrets: 'write',
};
const WRITE_PACKAGES = { metadata: 'read', packages: 'write' };

// The write/deploy half of the GitHub adapter (repo creation, Actions secrets
// via libsodium, GHCR, git push) is a separate, live-App piece; until then it
// throws clearly rather than pretending. This keeps the read/import path usable
// without blocking the Gitea E2E (ADR-030).
function notImplemented(op: string): Promise<never> {
  return Promise.reject(new Error(`GitHub adapter: '${op}' is not implemented yet`));
}

/**
 * The GitHub adapter of {@link ScmProvider}. Repository reads run on short-lived
 * installation tokens resolved per owner (ADR-030). It implements the operations
 * the import/read paths need; write and deployment operations are not wired yet.
 */
@Injectable()
export class GitHubScmProvider implements ScmProvider {
  constructor(private readonly installations: GitHubInstallationService) {}

  private async token(
    owner: string,
    permissions: Record<string, string> = READ_CONTENTS,
  ): Promise<string> {
    return (await this.installations.tokenForOwner(owner, { permissions })).token;
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

  // Parses owner/name from a stored browser repo URL (…/owner/name[.git]).
  private coords(repoUrl: string | null): { owner: string; name: string } | null {
    if (!repoUrl) return null;
    const parts = repoUrl.replace(/\.git$/, '').replace(/\/+$/, '').split('/');
    const name = parts.pop();
    const owner = parts.pop();
    return owner && name ? { owner, name } : null;
  }

  // Maps a workspace role to a GitHub collaborator permission.
  private permissionFor(role: string): string {
    if (role === 'viewer') return 'pull';
    if (role === 'admin' || role === 'owner') return 'admin';
    if (role === 'maintainer') return 'maintain';
    return 'push';
  }

  async listRepositories(actor: ScmActor): Promise<ScmRepo[]> {
    const token = await this.token(actor.username);
    const res = await this.gh('/installation/repositories?per_page=100', token);
    if (!res.ok) throw new Error(`Could not list GitHub repositories (HTTP ${res.status})`);
    const data = (await res.json()) as {
      repositories?: Array<{
        name: string;
        full_name: string;
        private: boolean;
        default_branch?: string;
        updated_at?: string;
        size?: number;
      }>;
    };
    return (data.repositories ?? []).map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: Boolean(r.private),
      defaultBranch: r.default_branch || 'main',
      updatedAt: r.updated_at || '',
      empty: (r.size ?? 0) === 0,
    }));
  }

  async readFile(name: string, path: string, ref: string, actor: ScmActor): Promise<string | null> {
    const token = await this.token(actor.username);
    const res = await this.gh(
      `/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}/contents/${path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(ref)}`,
      token,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Could not read '${path}' from ${actor.username}/${name} (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (!data.content) return null;
    return Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  }

  async repoMissing(name: string, actor: ScmActor): Promise<boolean> {
    try {
      const token = await this.token(actor.username);
      const res = await this.gh(`/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`, token);
      return res.status === 404;
    } catch {
      // An outage or missing installation must never be read as "deleted".
      return false;
    }
  }

  async listCommits(name: string, actor: ScmActor, limit = 20): Promise<ScmCommit[] | null> {
    try {
      const token = await this.token(actor.username);
      const res = await this.gh(
        `/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}/commits?per_page=${limit}`,
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

  async listCommitStatuses(name: string, sha: string, actor: ScmActor): Promise<ScmCommitStatus[] | null> {
    try {
      const token = await this.token(actor.username, READ_STATUSES);
      const res = await this.gh(
        `/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}/status`,
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

  async deleteRepo(name: string, actor: ScmActor): Promise<void> {
    const token = await this.token(actor.username, WRITE_ADMINISTRATION);
    const res = await this.gh(
      `/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`,
      token,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Could not delete the GitHub repository (HTTP ${res.status})`);
    }
  }

  // Severs the repo's trust with a deleted project: remove platform secrets and
  // disable Actions, keeping the source code (mirrors the Gitea adapter).
  async detachRepo(name: string, actor: ScmActor): Promise<void> {
    const token = await this.token(actor.username, DETACH_REPOSITORY);
    const repo = `${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`;
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

  async setCollaborator(repoUrl: string | null, username: string, role: string): Promise<void> {
    const repo = this.coords(repoUrl);
    if (!repo || repo.owner === username) return;
    const token = await this.token(repo.owner, WRITE_ADMINISTRATION);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/collaborators/${encodeURIComponent(username)}`,
      token,
      { method: 'PUT', body: { permission: this.permissionFor(role) } },
    );
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`Could not grant repository access to '${username}' (HTTP ${res.status})`);
    }
  }

  async removeCollaborator(repoUrl: string | null, username: string): Promise<void> {
    const repo = this.coords(repoUrl);
    if (!repo || repo.owner === username) return;
    const token = await this.token(repo.owner, WRITE_ADMINISTRATION);
    const res = await this.gh(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/collaborators/${encodeURIComponent(username)}`,
      token,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      throw new Error(`Could not revoke repository access from '${username}' (HTTP ${res.status})`);
    }
  }

  // Queues a CI re-run by tagging the exact commit, replacing any stale
  // InitPad retry tags first (the "run again without an empty commit" path).
  async createRetryTag(name: string, sha: string, actor: ScmActor): Promise<string> {
    const token = await this.token(actor.username, WRITE_CONTENTS);
    const repo = `${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}`;
    const listed = await this.gh(`/repos/${repo}/git/matching-refs/tags/initpad-retry-`, token);
    if (listed.ok) {
      const refs = (await listed.json()) as Array<{ ref?: string }>;
      await Promise.all(
        refs
          .map((r) => (r.ref ?? '').replace(/^refs\/tags\//, ''))
          .filter((t) => t.startsWith('initpad-retry-'))
          .map((t) => this.deleteTag(name, t, actor)),
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

  async deleteTag(name: string, tag: string, actor: ScmActor): Promise<void> {
    const token = await this.token(actor.username, WRITE_CONTENTS);
    const res = await this.gh(
      `/repos/${encodeURIComponent(actor.username)}/${encodeURIComponent(name)}/git/refs/tags/${encodeURIComponent(tag)}`,
      token,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404 && res.status !== 422) {
      throw new Error(`Could not delete tag '${tag}' (HTTP ${res.status})`);
    }
  }

  // Best-effort GHCR container package removal after project deletion.
  async deletePackages(owner: string, name: string): Promise<void> {
    try {
      const token = await this.token(owner, WRITE_PACKAGES);
      await this.gh(
        `/users/${encodeURIComponent(owner)}/packages/container/${encodeURIComponent(name.toLowerCase())}`,
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

  // --- Still stubbed: need libsodium (secrets) or git subprocess (scaffold) ---
  provision(): Promise<{ repoUrl: string }> {
    return notImplemented('provision');
  }
  configureRepoSecrets(): Promise<void> {
    return notImplemented('configureRepoSecrets (needs libsodium-encrypted Actions secrets)');
  }
  configureRepoRuntimeSecrets(): Promise<void> {
    return notImplemented('configureRepoRuntimeSecrets (needs libsodium-encrypted Actions secrets)');
  }
  downloadArchive(): Promise<RepoArchive | null> {
    return notImplemented('downloadArchive');
  }
  initLocal(): Promise<void> {
    return notImplemented('initLocal');
  }
}

const PLATFORM_SECRETS = [
  'INITPAD_DEPLOY_TOKEN',
  'INITPAD_REGISTRY',
  'INITPAD_PLATFORM_URL',
  'INITPAD_REGISTRY_USER',
  'INITPAD_REGISTRY_PASSWORD',
];
