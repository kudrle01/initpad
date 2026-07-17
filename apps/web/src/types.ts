export interface User {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  platformRole: 'admin' | 'user';
  edition: 'self-hosted' | 'saas';
  // Set while the account must choose a new password before doing anything else
  // (admin-provisioned temporary credentials, post-reset).
  mustChangePassword: boolean;
  emailVerified: boolean;
}

// Instance-administration view of an account (self-hosted edition).
export interface AdminUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  platformRole: 'admin' | 'user';
  active: boolean;
  mustChangePassword: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'maintainer' | 'member' | 'viewer';
export type WorkspaceType = 'personal' | 'team';

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMember {
  userId: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

export type AssignableRole = Exclude<WorkspaceRole, 'owner'>;

// A repository the user can import (existing-repo import).
export interface ImportableRepo {
  provider: 'gitea' | 'github';
  repositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  repoUrl: string;
  installationId: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  empty: boolean;
  alreadyImported: boolean;
}

// A project's provisioning operation (create/import) audit record.
export interface ProvisioningStatus {
  id: string;
  kind: string;
  status: 'running' | 'succeeded' | 'failed';
  step: string;
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImportPreflight {
  repo: string;
  branch: string;
  runtime: string;
  hasDockerfile: boolean;
  alreadyImported: boolean;
  canImport: boolean;
  warnings: string[];
}

// A linked external SCM identity (GitHub today).
export interface LinkedIdentity {
  provider: string;
  providerUserId: string;
  username: string | null;
  linkedAt: string;
  canUnlink: boolean;
}

export type ProviderKind = 'docker' | 'sftp' | 'ssh';
export type RuntimeKind = 'static' | 'node' | 'php' | 'python';
export type TargetScope = 'builtin' | 'user';
export type EnvName = 'dev' | 'test' | 'prod';
export type DeployStatus = 'empty' | 'deploying' | 'running' | 'failed' | 'stopped';

export interface TemplateManifest {
  id: string;
  name: string;
  language: string;
  artifact: 'static' | 'runtime';
  // Runtime the app needs — matched against a target's capabilities.
  runtime?: RuntimeKind;
  compatibleProviders: ProviderKind[];
  // Template properties for source-based deployments (informational in the UI).
  startCommand?: string;
  artifactDir?: string;
  description: string;
}

// A deployment target: the built-in simulated infra or a user's own server.
export interface Target {
  id: string;
  name: string;
  kind: ProviderKind;
  scope: TargetScope;
  capabilities: RuntimeKind[];
  host: string | null;
  port: number | null;
  username: string | null;
  auth: string | null; // 'password' | 'key'
  remotePath: string | null;
  publicUrl: string | null;
  verifiedAt: string | null;
  inUse?: boolean;
}

// Compact reference to the target an environment is bound to.
export interface EnvTarget {
  id: string;
  name: string;
  kind: ProviderKind;
  scope: TargetScope;
  host: string | null;
}

export interface Environment {
  name: EnvName;
  provider: ProviderKind;
  status: DeployStatus;
  version: string | null;
  url: string | null;
  statusReason: string | null;
  target: EnvTarget | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  templateId: string;
  repoPath: string;
  repoUrl: string | null;
  scm: {
    provider: 'gitea' | 'github';
    repositoryId: string | null;
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    repoUrl: string | null;
    installationId: string | null;
  };
  createdAt: string;
  lastCommit: string;
  environments: Environment[];
}

export type StageStatus = 'pending' | 'running' | 'success' | 'failed';

export interface PipelineStage {
  name: string;
  status: StageStatus;
  url?: string | null;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  pipeline: PipelineStage[];
}

export interface ActivityEvent {
  projectId: string;
  projectName: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  pipeline: PipelineStage[];
}
