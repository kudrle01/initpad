import { Injectable } from '@nestjs/common';
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

  private async token(owner: string): Promise<string> {
    return (await this.installations.tokenForOwner(owner)).token;
  }

  private async gh(path: string, token: string): Promise<Response> {
    return fetch(`${config.github.apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
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
    if (res.status === 404 || !res.ok) return null;
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
      const token = await this.token(actor.username);
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

  // --- Not wired yet (write / deploy / credentials) --------------------------
  provision(): Promise<{ repoUrl: string }> {
    return notImplemented('provision');
  }
  deleteRepo(): Promise<void> {
    return notImplemented('deleteRepo');
  }
  detachRepo(): Promise<void> {
    return notImplemented('detachRepo');
  }
  setCollaborator(): Promise<void> {
    return notImplemented('setCollaborator');
  }
  removeCollaborator(): Promise<void> {
    return notImplemented('removeCollaborator');
  }
  createRetryTag(): Promise<string> {
    return notImplemented('createRetryTag');
  }
  deleteTag(): Promise<void> {
    return notImplemented('deleteTag');
  }
  configureRepoSecrets(): Promise<void> {
    return notImplemented('configureRepoSecrets');
  }
  configureRepoRuntimeSecrets(): Promise<void> {
    return notImplemented('configureRepoRuntimeSecrets');
  }
  downloadArchive(): Promise<RepoArchive | null> {
    return notImplemented('downloadArchive');
  }
  initLocal(): Promise<void> {
    return notImplemented('initLocal');
  }
  deletePackages(): Promise<void> {
    return notImplemented('deletePackages');
  }
  issueCloneToken(): Promise<string> {
    return notImplemented('issueCloneToken');
  }
}
