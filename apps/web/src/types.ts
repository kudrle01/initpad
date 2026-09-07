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

export interface AuditEvent {
  id: string;
  actor: {
    userId: string | null;
    username: string;
    displayName: string | null;
  };
  action: string;
  outcome: 'accepted' | 'succeeded' | 'failed' | 'cancelled';
  resource: {
    type: string;
    id: string | null;
    name: string | null;
  };
  operation: {
    type: 'deployment' | 'provisioning';
    id: string;
    kind: string;
    status: string;
    phase: string | null;
    projectId: string | null;
  } | null;
  details: Record<string, string | number | boolean> | null;
  createdAt: string;
}

export interface AuditEventPage {
  items: AuditEvent[];
  nextCursor: string | null;
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
  status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'retrying' | 'retried' | 'cleaning';
  step: string;
  message: string | null;
  projectId: string | null;
  projectName: string;
  attempt: number;
  retryOfId: string | null;
  canRetry: boolean;
  needsCleanup: boolean;
  createdAt: string;
  finishedAt: string | null;
  effects: Array<{
    key: string;
    kind: 'repository' | 'collaborator' | 'secrets' | 'project';
    status: 'planned' | 'applying' | 'applied' | 'failed' | 'compensated' | 'compensation_failed' | 'reconciliation_required';
    metadata: unknown;
    error: string | null;
    createdAt: string;
    appliedAt: string | null;
    compensatedAt: string | null;
  }>;
}

export interface ImportPreflight {
  repo: string;
  branch: string;
  runtime: string;
  hasDockerfile: boolean;
  hasCompatibleWorkflow: boolean;
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
export type TargetRoutingMode = 'direct-port' | 'managed-gateway';
export type TargetManagementState = 'active' | 'disconnected' | 'retired';
export type GatewayPreflightStatus = 'not-run' | 'queued' | 'running' | 'passed' | 'failed';
export type EnvName = 'dev' | 'test' | 'prod';
export type DeployStatus = 'empty' | 'deploying' | 'running' | 'failed' | 'stopped';

export interface AgentDockerCapabilities {
  engineVersion: string;
  apiVersion: string;
  os: string;
  arch: string;
  rootless: boolean;
  cpus: number;
  memoryBytes: number;
}

export interface AgentStatus {
  id: string;
  targetId: string;
  state: 'not-enrolled' | 'offline' | 'online' | 'disabled';
  enrollmentPending: boolean;
  enrollmentExpiresAt: string | null;
  credentialGeneration: number;
  protocolVersion: number;
  version: string | null;
  capabilities: AgentDockerCapabilities | null;
  enrolledAt: string | null;
  lastSeenAt: string | null;
  disabledAt: string | null;
}

export interface AgentEnrollment extends AgentStatus {
  enrollmentToken: string;
}

export interface AgentJobSummary {
  id: string;
  kind: string;
  status: 'queued' | 'leased' | 'succeeded' | 'failed' | 'cancelled';
  attempt: number;
  progressSequence: number;
  progressPercent: number;
  progressStage: string;
  message: string | null;
  resultCode: string | null;
  createdAt: string;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
  finishedAt: string | null;
}

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
  managementState: TargetManagementState;
  managementStateChangedAt: string | null;
  credentialConfigured?: boolean;
  routingMode: TargetRoutingMode;
  gatewayPreflight?: {
    adapter: 'caddy';
    status: GatewayPreflightStatus;
    checkedAt: string | null;
    error: string | null;
  } | null;
  verifiedAt: string | null;
  agentReady?: boolean;
  agentVersion?: string | null;
  inUse?: boolean;
  usage?: TargetUsage[];
  // Loaded alongside workspace-owned Docker targets by Infrastructure.
  agent?: AgentStatus | null;
}

export interface TargetUsage {
  projectId: string;
  projectName: string;
  environment: EnvName;
  status: DeployStatus;
  url: string | null;
}

// Compact reference to the target an environment is bound to.
export interface EnvTarget {
  id: string;
  name: string;
  kind: ProviderKind;
  scope: TargetScope;
  host: string | null;
  managementState: TargetManagementState;
}

export interface Environment {
  name: EnvName;
  provider: ProviderKind;
  status: DeployStatus;
  version: string | null;
  url: string | null;
  statusReason: string | null;
  deploymentRequired: boolean;
  artifact: { id: string; provider: string; digest: string; runId: string } | null;
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
  source?: 'scm' | 'platform';
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

export interface DeploymentOperation {
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

export interface RollbackPreview {
  candidateOperationId: string;
  environment: EnvName;
  target: string;
  currentVersion: string | null;
  rollbackVersion: string;
  currentArtifact: {
    id: string;
    provider: string;
    digest: string;
    runId: string;
  } | null;
  rollbackArtifact: {
    id: string;
    provider: string;
    digest: string;
    runId: string;
  } | null;
  sourceDeployedAt: string;
  stateToken: string;
}

export type WorkloadDiagnosticStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';
export type WorkloadHealth = 'healthy' | 'unhealthy' | 'not-running' | 'missing';

// One explicitly requested, bounded snapshot of an Agent-managed workload.
// It is deliberately separate from deployment history: refreshing diagnostics
// never deploys, restarts or mutates the application.
export interface WorkloadDiagnostic {
  environment: EnvName;
  target: string;
  status: WorkloadDiagnosticStatus;
  agentOnline: boolean;
  progressPercent: number;
  message: string | null;
  runtimeState: 'running' | 'stopped' | 'missing' | null;
  revision: string | null;
  exitCode: number | null;
  health: WorkloadHealth | null;
  logs: string;
  requestedAt: string | null;
  observedAt: string | null;
  finishedAt: string | null;
}
