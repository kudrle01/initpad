import type {
  Project,
  TemplateManifest,
  EnvName,
  Commit,
  User,
  Target,
  RuntimeKind,
  ActivityEvent,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  AdminUser,
  LinkedIdentity,
  ImportableRepo,
  ImportPreflight,
  ProvisioningStatus,
  RollbackPreview,
  ProductionDeploymentRequest,
  DeploymentOperation,
  AgentStatus,
  AgentEnrollment,
  AgentDistribution,
  AgentJobSummary,
  WorkloadDiagnostic,
  AuditEventPage,
  TargetUsage,
  DeployStatus,
} from '@/types';

export interface EnvConfig {
  name: EnvName;
  // Target to deploy this environment to; omitted → server-side default.
  targetId?: string;
}

// Body for registering / editing a user deployment target.
export interface TargetInput {
  name: string;
  kind: 'docker' | 'ssh' | 'sftp';
  routingMode?: 'direct-port' | 'managed-gateway';
  capabilities: RuntimeKind[];
  host?: string;
  port?: number;
  username?: string;
  auth?: 'password' | 'key';
  secret?: string;
  hostKeyFingerprint?: string;
  remotePath?: string;
  publicUrl: string;
}

// Workspace-scoped usage of a physical target (ADR-060).
export interface TargetAllocation {
  id: string;
  targetId: string;
  targetName: string;
  targetManagementState: 'active' | 'disconnected' | 'retired';
  namespace: string;
  rootPath: string | null;
  publicUrl: string | null;
  capabilities: RuntimeKind[];
  status: 'active' | 'disabled';
  maxEnvironments: number;
  cpuLimitMillicores: number;
  memoryLimitMb: number;
  pidsLimit: number;
  devTtlHours: number | null;
  testTtlHours: number | null;
  inUse: number;
  usage: TargetUsage[];
}

export interface TargetAllocationInput {
  targetId: string;
  capabilities: RuntimeKind[];
  publicUrl?: string;
  maxEnvironments: number;
  cpuLimitMillicores: number;
  memoryLimitMb: number;
  pidsLimit: number;
  devTtlHours?: number | null;
  testTtlHours?: number | null;
}

export interface WorkspacePortfolio {
  stats: {
    projects: number;
    environments: number;
    runningEnvironments: number;
    attentionProjects: number;
    activeAllocations: number;
    pendingApprovals: number;
    cleanupDebt: number;
  };
  projects: Array<{
    id: string;
    name: string;
    templateId: string;
    createdAt: string;
    health: 'attention' | 'deploying' | 'healthy' | 'idle';
    runningEnvironments: number;
    failedEnvironments: number;
    cleanupDebt: number;
    pendingApprovals: number;
    environments: Array<{
      name: EnvName;
      status: DeployStatus;
      version: string | null;
      expiresAt: string | null;
    }>;
    lastBuild: {
      status: string;
      runId: string;
      commitSha: string;
      createdAt: string;
    } | null;
    lastDeployment: {
      environment: EnvName;
      kind: string;
      status: string;
      phase: string;
      createdAt: string;
    } | null;
  }>;
}

// One application config variable for an environment (ADR-061). Secret values
// are never returned in the clear — `value` is null and `hasValue` tells whether
// a secret is set.
export interface ConfigVar {
  key: string;
  isSecret: boolean;
  value: string | null;
  hasValue: boolean;
  updatedAt: string;
}

export interface DeleteProjectOptions {
  deleteRepository: boolean;
  confirmProduction: boolean;
  confirmCleanupDebt: boolean;
}

export interface AuditEventFilters {
  action?: string;
  resourceType?: string;
  outcome?: 'accepted' | 'succeeded' | 'failed' | 'cancelled';
  cursor?: string;
  limit?: number;
}

export interface GitHubStatus {
  enabled: boolean;
  appConfigured: boolean;
  linked: boolean;
  login: string | null;
  credentialReady: boolean;
  ciCallbackReady: boolean;
  ciCallbackUrl: string | null;
  ciCallbackIssue: string | null;
  canInstall: boolean;
  installation: { present: boolean; suspended: boolean };
  installations: Array<{
    id: string;
    accountId: string | null;
    accountLogin: string;
    accountType: string;
    repositorySelection: string;
    suspended: boolean;
    canCreate: boolean;
  }>;
}

const BASE = '/api';
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
export const AUTH_EXPIRED_EVENT = 'initpad:auth-expired';

// Error carrying the HTTP status, so callers can distinguish "gone" (404)
// from other failures.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function responseErrorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const message = (body as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `HTTP ${response.status}`;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const workspaceId = localStorage.getItem('initpad.workspace');
  if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
  const res = await boundedFetch(
    BASE + path,
    {
      credentials: 'include',
      ...init,
      headers,
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new ApiError(await responseErrorMessage(res), res.status);
  }
  // 204 / empty body (e.g. DELETE) — nothing to parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers();
  const workspaceId = localStorage.getItem('initpad.workspace');
  if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
  const res = await boundedFetch(
    BASE + path,
    { credentials: 'include', headers },
    DOWNLOAD_TIMEOUT_MS,
  );
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new ApiError(await responseErrorMessage(res), res.status);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'initpad-metrics';
  return { blob: await res.blob(), filename };
}

async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) abortFromSource();
  else sourceSignal?.addEventListener('abort', abortFromSource, { once: true });
  const timeout = window.setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !sourceSignal?.aborted) {
      throw new ApiError('The server did not respond in time. Try again.', 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    sourceSignal?.removeEventListener('abort', abortFromSource);
  }
}

export const api = {
  listWorkspaces: () => http<Workspace[]>('/workspaces'),
  getWorkspacePortfolio: (workspaceId: string) =>
    http<WorkspacePortfolio>(`/workspaces/${workspaceId}/portfolio`),
  downloadWorkspaceMetrics: (
    workspaceId: string,
    format: 'json' | 'csv',
    from: string,
    to: string,
  ) => {
    const query = new URLSearchParams({ format, from, to });
    return download(`/workspaces/${workspaceId}/metrics?${query.toString()}`);
  },
  createWorkspace: (name: string, slug: string) =>
    http<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name, slug }) }),
  updateWorkspace: (workspaceId: string, name: string) =>
    http<Workspace>(`/workspaces/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  updateProductionApprovalPolicy: (
    workspaceId: string,
    policy: Workspace['productionApprovalPolicy'],
  ) =>
    http<Workspace>(`/workspaces/${workspaceId}/production-approval-policy`, {
      method: 'PUT',
      body: JSON.stringify({ policy }),
    }),
  deleteWorkspace: (workspaceId: string) =>
    http<void>(`/workspaces/${workspaceId}`, { method: 'DELETE' }),
  listWorkspaceMembers: (workspaceId: string) =>
    http<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
  addWorkspaceMember: (
    workspaceId: string,
    identity: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ) =>
    http<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ identity, role }),
    }),
  updateWorkspaceMember: (
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ) =>
    http<WorkspaceMember[]>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  removeWorkspaceMember: (workspaceId: string, userId: string) =>
    http<void>(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
  listProjects: () => http<Project[]>('/projects'),
  getProject: (id: string) => http<Project>(`/projects/${id}`),
  getCommits: (id: string, limit = 20) => http<Commit[]>(`/projects/${id}/commits?limit=${limit}`),
  getDeployments: (id: string, limit = 30) =>
    http<DeploymentOperation[]>(`/projects/${id}/deployments?limit=${limit}`),
  getProvisioning: (id: string) => http<ProvisioningStatus | null>(`/projects/${id}/provisioning`),
  listProvisioning: () => http<ProvisioningStatus[]>('/provisioning'),
  retryProvisioning: (id: string) => http<Project>(`/provisioning/${id}/retry`, { method: 'POST' }),
  cleanupProvisioning: (id: string) =>
    http<void>(`/provisioning/${id}/cleanup`, { method: 'POST' }),
  listTemplates: () => http<TemplateManifest[]>('/templates'),
  downloadTemplateWorkflow: (templateId: string, provider: 'gitea' | 'github') =>
    download(`/templates/${encodeURIComponent(templateId)}/workflows/${provider}`),
  getActivity: () => http<ActivityEvent[]>('/activity'),
  getAuditEvents: (filters: AuditEventFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.action) query.set('action', filters.action);
    if (filters.resourceType) query.set('resourceType', filters.resourceType);
    if (filters.outcome) query.set('outcome', filters.outcome);
    if (filters.cursor) query.set('cursor', filters.cursor);
    query.set('limit', String(filters.limit ?? 30));
    return http<AuditEventPage>(`/audit-events?${query.toString()}`);
  },
  createProject: (
    name: string,
    templateId: string,
    environments: EnvConfig[],
    scmInstallationId?: string,
  ) =>
    http<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, templateId, environments, scmInstallationId }),
    }),
  listImportableRepos: () => http<ImportableRepo[]>('/projects/import/repos'),
  importPreflight: (repositoryId: string, templateId: string) =>
    http<ImportPreflight>('/projects/import/preflight', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, templateId }),
    }),
  importRepo: (repositoryId: string, templateId: string, environments: EnvConfig[]) =>
    http<Project>('/projects/import', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, templateId, environments }),
    }),
  promote: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/promote/${env}`, { method: 'POST' }),
  redeploy: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/redeploy/${env}`, { method: 'POST' }),
  getRollbackPreview: (id: string, env: EnvName) =>
    http<RollbackPreview | null>(`/projects/${id}/rollback/${env}`),
  rollback: (id: string, env: EnvName, candidateOperationId: string, stateToken: string) =>
    http<Project>(`/projects/${id}/rollback/${env}`, {
      method: 'POST',
      body: JSON.stringify({ candidateOperationId, stateToken }),
    }),
  getProductionRequest: (id: string) =>
    http<ProductionDeploymentRequest | null>(`/projects/${id}/production-request`),
  requestProductionDeployment: (
    id: string,
    input: {
      kind: 'promote' | 'redeploy' | 'rollback';
      candidateOperationId?: string;
      stateToken?: string;
    },
  ) =>
    http<ProductionDeploymentRequest>(`/projects/${id}/production-request`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  approveProductionDeployment: (id: string, requestId: string, note?: string) =>
    http<ProductionDeploymentRequest>(`/projects/${id}/production-request/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  rejectProductionDeployment: (id: string, requestId: string, note?: string) =>
    http<ProductionDeploymentRequest>(`/projects/${id}/production-request/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
  cancelProductionDeployment: (id: string, requestId: string) =>
    http<ProductionDeploymentRequest | null>(
      `/projects/${id}/production-request/${requestId}/cancel`,
      {
        method: 'POST',
      },
    ),
  getWorkloadDiagnostic: (id: string, env: EnvName) =>
    http<WorkloadDiagnostic | null>(`/projects/${id}/diagnostics/${env}`),
  requestWorkloadDiagnostic: (id: string, env: EnvName, requestId: string) =>
    http<WorkloadDiagnostic>(`/projects/${id}/diagnostics/${env}`, {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),
  runAgain: (id: string) => http<Project>(`/projects/${id}/run-again`, { method: 'POST' }),
  rerunFailedJobs: (id: string) =>
    http<{ runId: string }>(`/projects/${id}/rerun-failed-jobs`, { method: 'POST' }),
  stopEnv: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/stop/${env}`, { method: 'POST' }),
  startEnv: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/start/${env}`, { method: 'POST' }),
  removeEnv: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/teardown/${env}`, { method: 'POST' }),
  // Point an environment at a target (built-in infra or the user's server).
  bindEnvTarget: (id: string, env: EnvName, targetId: string) =>
    http<Project>(`/projects/${id}/target/${env}`, {
      method: 'PUT',
      body: JSON.stringify({ targetId }),
    }),
  // Deployment targets (built-in infra + the user's own servers).
  listTargets: () => http<Target[]>('/targets'),
  createTarget: (body: TargetInput) =>
    http<Target>('/targets', { method: 'POST', body: JSON.stringify(body) }),
  updateTarget: (id: string, body: Partial<TargetInput>) =>
    http<Target>(`/targets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTarget: (id: string) => http<void>(`/targets/${id}`, { method: 'DELETE' }),
  disconnectTarget: (id: string) => http<void>(`/targets/${id}/disconnect`, { method: 'POST' }),
  retireTarget: (id: string) => http<void>(`/targets/${id}/retire`, { method: 'POST' }),
  restoreTarget: (id: string) => http<void>(`/targets/${id}/restore`, { method: 'POST' }),
  verifyTarget: (id: string) =>
    http<{ ok: boolean; message: string }>(`/targets/${id}/verify`, { method: 'POST' }),
  getTargetAgent: (id: string) => http<AgentStatus | null>(`/targets/${id}/agent`),
  issueAgentEnrollment: (id: string) =>
    http<AgentEnrollment>(`/targets/${id}/agent/enrollment`, { method: 'POST' }),
  getAgentDistribution: () => http<AgentDistribution>('/agent/distribution'),
  disableAgent: (id: string) => http<void>(`/targets/${id}/agent`, { method: 'DELETE' }),
  listAgentJobs: (id: string) => http<AgentJobSummary[]>(`/targets/${id}/agent/jobs`),
  createAgentProbeJob: (id: string, requestId: string, durationSeconds = 35) =>
    http<AgentJobSummary>(`/targets/${id}/agent/jobs/probe`, {
      method: 'POST',
      body: JSON.stringify({ requestId, durationSeconds }),
    }),
  createAgentLifecycleTest: (id: string, requestId: string) =>
    http<AgentJobSummary>(`/targets/${id}/agent/jobs/lifecycle-test`, {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),
  createGatewayPreflight: (id: string, requestId: string) =>
    http<AgentJobSummary>(`/targets/${id}/agent/jobs/gateway-preflight`, {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),
  // Workspace-scoped target allocations (ADR-060). Owner/admin manage; members read.
  listAllocations: () => http<TargetAllocation[]>('/allocations'),
  createAllocation: (body: TargetAllocationInput) =>
    http<TargetAllocation>('/allocations', { method: 'POST', body: JSON.stringify(body) }),
  updateAllocation: (
    id: string,
    body: Partial<Omit<TargetAllocationInput, 'targetId'>> & { status?: 'active' | 'disabled' },
  ) => http<TargetAllocation>(`/allocations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAllocation: (id: string) => http<void>(`/allocations/${id}`, { method: 'DELETE' }),
  // Per-environment application config & secrets (ADR-061). Secret values are
  // always masked (value === null); managed by a project-write member.
  listConfigVars: (projectId: string, env: EnvName) =>
    http<ConfigVar[]>(`/projects/${projectId}/environments/${env}/config`),
  upsertConfigVar: (
    projectId: string,
    env: EnvName,
    key: string,
    body: { value: string; isSecret?: boolean },
  ) =>
    http<ConfigVar>(
      `/projects/${projectId}/environments/${env}/config/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
    ),
  deleteConfigVar: (projectId: string, env: EnvName, key: string) =>
    http<void>(`/projects/${projectId}/environments/${env}/config/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),
  deleteProject: (id: string, options: DeleteProjectOptions) =>
    http<void>(`/projects/${id}`, {
      method: 'DELETE',
      body: JSON.stringify(options),
    }),
  me: () => http<User>('/auth/me'),
  authConfig: () =>
    http<{
      registrationAvailable: boolean;
      registrationMode: string;
      githubEnabled: boolean;
      edition: 'self-hosted' | 'saas';
      passwordAuthEnabled: boolean;
    }>('/auth/config'),
  listIdentities: () => http<LinkedIdentity[]>('/me/identities'),
  unlinkIdentity: (provider: string) =>
    http<void>(`/me/identities/${provider}`, { method: 'DELETE' }),
  githubStatus: () => http<GitHubStatus>('/scm/github/status'),
  startGithubSetup: () => http<{ installUrl: string }>('/scm/github/setup', { method: 'POST' }),
  recoverGithubSetup: () =>
    http<{ recovered: boolean; accountLogin: string | null }>('/scm/github/setup/recover', {
      method: 'POST',
    }),
  register: (username: string, email: string, password: string) =>
    http<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    }),
  signin: (username: string, password: string) =>
    http<User>('/auth/signin', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<User>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  requestEmailVerification: () =>
    http<{ verifyUrl: string }>('/auth/email/request-verification', { method: 'POST' }),
  verifyEmail: (token: string) =>
    http<void>('/auth/email/verify', { method: 'POST', body: JSON.stringify({ token }) }),
  requestPasswordReset: (identity: string) =>
    http<{ ok: boolean }>('/auth/password/request-reset', {
      method: 'POST',
      body: JSON.stringify({ identity }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    http<void>('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
  activateAccount: (token: string, newPassword: string) =>
    http<User>('/auth/activate', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  getGitAccess: () =>
    http<{ username: string; token: string | null; giteaUrl: string }>('/me/git-access'),
  // Instance administration (platform admin only).
  adminListUsers: () => http<AdminUser[]>('/admin/users'),
  adminCreateUser: (body: {
    username: string;
    email: string;
    name?: string;
    platformRole?: 'admin' | 'user';
  }) =>
    http<{ user: AdminUser; temporaryPassword: string; activationUrl: string }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminCreateActivationLink: (id: string) =>
    http<{ activationUrl: string }>(`/admin/users/${id}/activation-link`, { method: 'POST' }),
  adminDeactivateUser: (id: string) =>
    http<AdminUser>(`/admin/users/${id}/deactivate`, { method: 'POST' }),
  adminActivateUser: (id: string) =>
    http<AdminUser>(`/admin/users/${id}/activate`, { method: 'POST' }),
  adminResetPassword: (id: string) =>
    http<{ temporaryPassword: string }>(`/admin/users/${id}/reset-password`, { method: 'POST' }),
};
