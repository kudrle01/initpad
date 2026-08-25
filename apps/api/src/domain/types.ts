export type ArtifactKind = 'static' | 'runtime';

export type ProviderKind = 'docker' | 'sftp' | 'ssh';

// What a template needs in order to run — matched against a target's
// capabilities when binding an environment to a target.
export type RuntimeKind = 'static' | 'node' | 'php' | 'python';

// Origin of a deployment target: the seeded simulated infrastructure
// ('builtin') vs. a server the user registered themselves ('user').
export type TargetScope = 'builtin' | 'user';

export type TargetRoutingMode = 'direct-port' | 'managed-gateway';
export type GatewayPreflightStatus = 'not-run' | 'queued' | 'running' | 'passed' | 'failed';

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
  // For SFTP deploys, the path in the CI-tested image whose contents are
  // extracted and uploaded (e.g. '/app' for PHP or nginx's document root for
  // a static app). This enforces build-once/deploy-many and prevents project
  // build scripts from running inside the control-plane API container.
  buildArtifactPath?: string;
  // Public docroot inside the image (e.g. 'www' for Nette, 'public' for
  // Laravel/Symfony). SFTP flattens its contents to <publicUrl>/<slug>/ and
  // keeps the rest of the app in an HTTP-denied private directory.
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
  routingMode: TargetRoutingMode;
  gatewayPreflight?: {
    adapter: 'caddy';
    status: GatewayPreflightStatus;
    checkedAt: string | null;
    error: string | null;
  } | null;
  verifiedAt: string | null;
  // Agent targets are ready when enrolled, enabled, on a compatible version,
  // and this control plane has durable artifact storage configured.
  agentReady?: boolean;
  agentVersion?: string | null;
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
  deploymentRequired: boolean;
  artifact: {
    id: string;
    provider: string;
    digest: string;
    runId: string;
  } | null;
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
  // Link to the concrete SCM job/run, if the provider has created it already.
  url?: string | null;
  // SCM jobs and InitPad publications are separate audit records. Missing
  // source is kept compatible with older SCM-only clients.
  source?: 'scm' | 'platform';
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

export interface DeploymentOperationSummary {
  id: string;
  environment: EnvName;
  target: string;
  kind: string;
  status: string;
  phase: string;
  version: string | null;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
  artifactRunId: string | null;
}
