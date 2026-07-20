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
  // Internal installation binding used when a user/workspace can access more
  // than one GitHub account. Gitea ignores it.
  installationId?: string;
}

export type ScmKind = 'gitea' | 'github';

// Canonical repository identity passed to every repository operation. URL and
// fullName are mutable display/coordinate data; provider + repositoryId is the
// stable identity. repositoryId may be null only for a migrated legacy row
// until the provider can resolve it during reconciliation.
export interface ScmRepositoryRef {
  provider: ScmKind;
  repositoryId: string | null;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  repoUrl: string | null;
  installationId: string | null;
}

export interface ScmRepositoryIdentity {
  provider: ScmKind;
  repositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  repoUrl: string;
  installationId: string | null;
}

// Explicit destination for repository creation. Gitea derives the owner from
// its managed actor and ignores this value; hosted providers use it to bind
// creation to a workspace-authorized installation and the initiating user.
export interface ScmProvisionTarget {
  userId: string;
  installationId: string;
}

// A commit's source tree materialised into a temporary directory. The caller
// must invoke cleanup() once the contents are no longer needed.
export interface RepoArchive {
  dir: string;
  cleanup: () => void;
}

// Immutable build output reported by a provider CI workflow. The callback only
// supplies a locator; the provider resolves authoritative repository/run/SHA
// metadata before InitPad accepts it (ADR-049).
export interface ScmBuildArtifactLocator {
  providerArtifactId: string;
  digest: string;
  commitSha: string;
  expectedName: string;
}

export interface ScmBuildArtifact {
  provider: string;
  providerArtifactId: string;
  providerRunId: string;
  name: string;
  digest: string;
  commitSha: string;
  sizeBytes: number;
  expiresAt: Date;
}

export interface ScmBuildArtifactDownload extends ScmBuildArtifact {
  filePath: string;
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

// A repository the user can import (owns or collaborates on).
export interface ScmRepo extends ScmRepositoryIdentity {
  private: boolean;
  updatedAt: string;
  empty: boolean;
}

// The operations the project domain needs from an SCM. Kept intentionally close
// to the existing Gitea surface so the first adapter is a pure conformance step;
// a GitHub adapter implements the same contract with installation tokens and
// minimal permissions.
export interface ScmProvider {
  // Create the repository and push the rendered scaffold, returning its URL.
  provision(
    name: string,
    dir: string,
    actor: ScmActor,
    ciDeployToken: string,
    target?: ScmProvisionTarget,
  ): Promise<ScmRepositoryIdentity>;
  deleteRepo(repository: ScmRepositoryRef, actor: ScmActor): Promise<void>;
  // Sever a repository's trust with a deleted project without deleting its code.
  detachRepo(repository: ScmRepositoryRef, actor: ScmActor): Promise<void>;
  repoMissing(repository: ScmRepositoryRef, actor: ScmActor): Promise<boolean>;
  setCollaborator(repository: ScmRepositoryRef, username: string, role: string): Promise<void>;
  removeCollaborator(repository: ScmRepositoryRef, username: string): Promise<void>;
  // Direct (not inherited/team) access, in provider-native notation. Import
  // rollback uses this opaque value to restore rather than blindly revoke.
  getCollaboratorAccess(repository: ScmRepositoryRef, username: string): Promise<string | null>;
  restoreCollaboratorAccess(repository: ScmRepositoryRef, username: string, access: string | null): Promise<void>;
  listCommits(repository: ScmRepositoryRef, actor: ScmActor, limit?: number): Promise<ScmCommit[] | null>;
  createRetryTag(repository: ScmRepositoryRef, sha: string, actor: ScmActor): Promise<string>;
  deleteTag(repository: ScmRepositoryRef, tag: string, actor: ScmActor): Promise<void>;
  // Hosted providers may support retrying the failed jobs of the exact run
  // without creating a fake commit/tag or conflating it with a redeploy.
  rerunFailedJobs?(repository: ScmRepositoryRef, runId: string): Promise<void>;
  listCommitStatuses(
    repository: ScmRepositoryRef,
    sha: string,
    actor: ScmActor,
    // Hosted artifact deployments bind the UI to the exact workflow run that
    // produced the deployed bytes. Omitted for providers without run identity.
    preferredRunId?: string | null,
  ): Promise<ScmCommitStatus[] | null>;
  configureRepoSecrets(repository: ScmRepositoryRef, ownerToken: string, ciDeployToken: string): Promise<void>;
  // Remove only the secret names owned by InitPad, without disabling CI.
  removeRepoSecrets(repository: ScmRepositoryRef): Promise<void>;
  configureRepoRuntimeSecrets(repository: ScmRepositoryRef): Promise<void>;
  downloadArchive(repository: ScmRepositoryRef, ref: string, actor: ScmActor): Promise<RepoArchive | null>;
  // Initialise a local git repository in `dir` (first-commit scaffold).
  initLocal(dir: string, author?: { name: string; email: string }): Promise<void>;
  // Remove the project's OCI packages/images from the provider's registry.
  deletePackages(repository: ScmRepositoryRef): Promise<void>;
  // Issue a short-lived credential for git-over-HTTP cloning of the user's repos.
  issueCloneToken(username: string): Promise<string>;
  // List repositories the user can import (for existing-repo import).
  listRepositories(actor: ScmActor): Promise<ScmRepo[]>;
  // Read a file's text content at a ref, or null if it does not exist (preflight).
  readFile(repository: ScmRepositoryRef, path: string, ref: string, actor: ScmActor): Promise<string | null>;
  // Optional because the bundled Gitea edition keeps using its private OCI
  // registry; hosted providers can expose a verified artifact handoff.
  resolveBuildArtifact?(
    repository: ScmRepositoryRef,
    locator: ScmBuildArtifactLocator,
  ): Promise<ScmBuildArtifact>;
  // Recover the newest still-valid tested artifact for a commit when its CI
  // callback could not reach the platform. Used by explicit manual Deploy.
  findBuildArtifact?(
    repository: ScmRepositoryRef,
    commitSha: string,
    expectedName: string,
  ): Promise<ScmBuildArtifact | null>;
  downloadBuildArtifact?(
    repository: ScmRepositoryRef,
    artifact: ScmBuildArtifact,
  ): Promise<ScmBuildArtifactDownload>;
}

// Database-shaped input accepted by repositoryRef(). Kept independent from
// Prisma so domain and unit tests can construct it without generated types.
export interface ProjectScmFields {
  scmProvider: string;
  scmRepositoryId: string | null;
  scmOwner: string;
  scmRepositoryName: string;
  scmFullName: string;
  scmDefaultBranch: string;
  scmInstallationId: string | null;
  repoUrl: string | null;
}

export function repositoryRef(project: ProjectScmFields): ScmRepositoryRef {
  if (project.scmProvider !== 'gitea' && project.scmProvider !== 'github') {
    throw new Error(`Unsupported SCM provider '${project.scmProvider}'`);
  }
  return {
    provider: project.scmProvider,
    repositoryId: project.scmRepositoryId,
    owner: project.scmOwner,
    name: project.scmRepositoryName,
    fullName: project.scmFullName,
    defaultBranch: project.scmDefaultBranch,
    repoUrl: project.repoUrl,
    installationId: project.scmInstallationId,
  };
}

// DI token so consumers inject the interface, not the concrete class.
export const SCM_PROVIDER = Symbol('SCM_PROVIDER');
