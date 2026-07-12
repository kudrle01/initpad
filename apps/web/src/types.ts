export interface User {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
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
  name: string;
  templateId: string;
  repoPath: string;
  repoUrl: string | null;
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
