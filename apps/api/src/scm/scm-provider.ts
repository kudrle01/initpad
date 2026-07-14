// The repository-domain abstraction (ADR-030/ADR-039). The project domain talks
// to an `ScmProvider`, never to a concrete SCM API, so the self-contained
// edition (Gitea) and the hosted edition (GitHub) are interchangeable adapters
// behind the same interface. Identity/account provisioning is deliberately not
// part of this surface — it is edition-specific (managed Gitea accounts vs.
// GitHub OAuth identities) and lives elsewhere.

// Identity used for repository operations. For Gitea this is the owning user
// and their token; a GitHub adapter maps it to the repo owner login and a
// short-lived installation token.
export interface ScmActor {
  username: string;
  token: string;
}

// A commit's source tree materialised into a temporary directory. The caller
// must invoke cleanup() once the contents are no longer needed.
export interface RepoArchive {
  dir: string;
  cleanup: () => void;
}

export interface ScmCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface ScmCommitStatus {
  context: string;
  status: string;
  targetUrl: string | null;
}

// The operations the project domain needs from an SCM. Kept intentionally close
// to the existing Gitea surface so the first adapter is a pure conformance step;
// a GitHub adapter implements the same contract with installation tokens and
// minimal permissions.
export interface ScmProvider {
  // Create the repository and push the rendered scaffold, returning its URL.
  provision(name: string, dir: string, actor: ScmActor, ciDeployToken: string): Promise<{ repoUrl: string }>;
  deleteRepo(name: string, actor: ScmActor): Promise<void>;
  // Sever a repository's trust with a deleted project without deleting its code.
  detachRepo(name: string, actor: ScmActor): Promise<void>;
  repoMissing(name: string, actor: ScmActor): Promise<boolean>;
  setCollaborator(repoUrl: string | null, username: string, role: string): Promise<void>;
  removeCollaborator(repoUrl: string | null, username: string): Promise<void>;
  listCommits(name: string, actor: ScmActor, limit?: number): Promise<ScmCommit[] | null>;
  createRetryTag(name: string, sha: string, actor: ScmActor): Promise<string>;
  deleteTag(name: string, tag: string, actor: ScmActor): Promise<void>;
  listCommitStatuses(name: string, sha: string, actor: ScmActor): Promise<ScmCommitStatus[] | null>;
  configureRepoSecrets(owner: string, repo: string, ownerToken: string, ciDeployToken: string): Promise<void>;
  configureRepoRuntimeSecrets(owner: string, repo: string): Promise<void>;
  downloadArchive(name: string, ref: string, actor: ScmActor): Promise<RepoArchive | null>;
  // Initialise a local git repository in `dir` (first-commit scaffold).
  initLocal(dir: string, author?: { name: string; email: string }): Promise<void>;
  // Remove the project's OCI packages/images from the provider's registry.
  deletePackages(owner: string, name: string): Promise<void>;
  // Issue a short-lived credential for git-over-HTTP cloning of the user's repos.
  issueCloneToken(username: string): Promise<string>;
}

// DI token so consumers inject the interface, not the concrete class.
export const SCM_PROVIDER = Symbol('SCM_PROVIDER');
