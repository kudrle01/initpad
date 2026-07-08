export type ArtifactKind = 'static' | 'runtime';

export type ProviderKind = 'docker' | 'sftp' | 'ssh';

export type EnvName = 'dev' | 'test' | 'prod';

export type DeployStatus = 'empty' | 'deploying' | 'running' | 'failed' | 'stopped';

export interface TemplateManifest {
  id: string;
  name: string;
  language: string;
  artifact: ArtifactKind;
  compatibleProviders: ProviderKind[];
  port?: number;
  // Path used for the post-deploy health check (defaults to '/health').
  healthPath?: string;
  // Command that starts the app for source-based deployments (SSH). This is
  // a property of the template, not of the provider (e.g. 'node src/index.js',
  // 'node dist/main.js').
  startCommand?: string;
  // Subdirectory containing the build artifact for static deployments
  // (e.g. 'dist'). When omitted, the repository root is deployed.
  artifactDir?: string;
  // Command that produces the static artifact before an SFTP upload
  // (e.g. 'npm install && npm run build'). Runs in the deployed source.
  buildCommand?: string;
  description: string;
}

// Summary of a user-configured deployment target (no secret) for the UI.
export interface EnvTarget {
  kind: ProviderKind;
  host: string | null;
  port: number | null;
  username: string | null;
  auth: string | null; // 'password' | 'key'
  path: string | null;
  publicUrl: string | null;
}

export interface Environment {
  name: EnvName;
  provider: ProviderKind;
  status: DeployStatus;
  version: string | null;
  url: string | null;
  statusReason: string | null;
  // Present when this environment deploys to the user's own server (prod).
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
  // Link to the concrete job/run in Gitea (from the commit status), if any.
  url?: string | null;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  pipeline: PipelineStage[];
}
