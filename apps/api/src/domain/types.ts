export type ArtifactKind = 'static' | 'runtime';

export type ProviderKind = 'docker' | 'sftp' | 'ssh';

// What a template needs in order to run — matched against a target's
// capabilities when binding an environment to a target.
export type RuntimeKind = 'static' | 'node' | 'php' | 'python';

// Origin of a deployment target: the seeded simulated infrastructure
// ('builtin') vs. a server the user registered themselves ('user').
export type TargetScope = 'builtin' | 'user';

export type EnvName = 'dev' | 'test' | 'prod';

export type DeployStatus = 'empty' | 'deploying' | 'running' | 'failed' | 'stopped';

export interface TemplateManifest {
  id: string;
  name: string;
  language: string;
  artifact: ArtifactKind;
  // The runtime the app needs (used for target-capability matching). Defaults
  // to 'static' for static artifacts and 'node' otherwise when omitted.
  runtime?: RuntimeKind;
  // Target kinds acceptable for this template (docker/ssh/sftp). A concrete
  // target must additionally be able to run `runtime` (see Target.capabilities).
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
  // For SFTP deploys of templates whose app is built inside the Docker image
  // (PHP frameworks scaffolded via Composer): the path in the image whose
  // built contents are extracted and uploaded (e.g. '/app'). When set and the
  // target is SFTP, the platform builds the image, extracts this path and
  // uploads it, instead of uploading git source.
  buildArtifactPath?: string;
  // Public docroot subfolder served over SFTP (e.g. 'www' for Nette, 'public'
  // for Laravel/Symfony). The app is served at <publicUrl>/<slug>/<webRoot>/.
  webRoot?: string;
  // Directories the web server must be able to write after an SFTP upload
  // (framework runtime dirs, e.g. Nette 'temp'/'log'); made world-writable.
  writableDirs?: string[];
  description: string;
}

// A deployment target (no secret) as returned by the API.
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
  // True when at least one environment currently references this target
  // (blocks deletion). Optional — only populated by the targets listing.
  inUse?: boolean;
}

// Compact reference to the target an environment is bound to (shown in the UI).
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
  // The target this environment deploys to (built-in infra or the user's own
  // server). Null only for legacy rows created before a target was assigned.
  target: EnvTarget | null;
}

export interface Project {
  id: string;
  workspaceId: string;
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

// A cross-project activity entry: a commit and its CI/deploy pipeline state.
export interface ActivityEvent {
  projectId: string;
  projectName: string;
  sha: string;
  message: string;
  author: string;
  date: string;
  pipeline: PipelineStage[];
}
