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
  DeploymentOperation,
} from '@/types';

export interface EnvConfig {
  name: EnvName;
  // Target to deploy this environment to; omitted → server-side default.
  targetId?: string;
}

// Body for registering / editing a user deployment target.
export interface TargetInput {
  name: string;
  kind: 'ssh' | 'sftp';
  capabilities: RuntimeKind[];
  host: string;
  port: number;
  username: string;
  auth: 'password' | 'key';
  secret?: string;
  remotePath: string;
  publicUrl: string;
}

// Workspace-scoped usage of a physical target (ADR-060).
export interface TargetAllocation {
  id: string;
  targetId: string;
  targetName: string;
  namespace: string;
  rootPath: string | null;
  publicUrl: string | null;
  capabilities: RuntimeKind[];
  status: 'active' | 'disabled';
  maxEnvironments: number;
  inUse: number;
}

export interface DeleteProjectOptions {
  deleteRepository: boolean;
  confirmProduction: boolean;
  confirmCleanupDebt: boolean;
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

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const workspaceId = localStorage.getItem('initpad.workspace');
  if (workspaceId) headers.set('X-Workspace-Id', workspaceId);
  const res = await fetch(BASE + path, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message || `HTTP ${res.status}`, res.status);
  }
  // 204 / empty body (e.g. DELETE) — nothing to parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  listWorkspaces: () => http<Workspace[]>('/workspaces'),
  createWorkspace: (name: string, slug: string) =>
    http<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name, slug }) }),
  updateWorkspace: (workspaceId: string, name: string) =>
    http<Workspace>(`/workspaces/${workspaceId}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteWorkspace: (workspaceId: string) =>
    http<void>(`/workspaces/${workspaceId}`, { method: 'DELETE' }),
  listWorkspaceMembers: (workspaceId: string) =>
    http<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
  addWorkspaceMember: (workspaceId: string, identity: string, role: Exclude<WorkspaceRole, 'owner'>) =>
    http<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`, {
      method: 'POST', body: JSON.stringify({ identity, role }),
    }),
  updateWorkspaceMember: (
    workspaceId: string,
    userId: string,
    role: Exclude<WorkspaceRole, 'owner'>,
  ) => http<WorkspaceMember[]>(`/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PUT', body: JSON.stringify({ role }),
  }),
  removeWorkspaceMember: (workspaceId: string, userId: string) =>
    http<void>(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
  listProjects: () => http<Project[]>('/projects'),
  getProject: (id: string) => http<Project>(`/projects/${id}`),
  getCommits: (id: string, limit = 20) =>
    http<Commit[]>(`/projects/${id}/commits?limit=${limit}`),
  getDeployments: (id: string, limit = 30) =>
    http<DeploymentOperation[]>(`/projects/${id}/deployments?limit=${limit}`),
  getProvisioning: (id: string) =>
    http<ProvisioningStatus | null>(`/projects/${id}/provisioning`),
  listProvisioning: () => http<ProvisioningStatus[]>('/provisioning'),
  retryProvisioning: (id: string) =>
    http<Project>(`/provisioning/${id}/retry`, { method: 'POST' }),
  cleanupProvisioning: (id: string) =>
    http<void>(`/provisioning/${id}/cleanup`, { method: 'POST' }),
  listTemplates: () => http<TemplateManifest[]>('/templates'),
  getActivity: () => http<ActivityEvent[]>('/activity'),
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
  runAgain: (id: string) =>
    http<Project>(`/projects/${id}/run-again`, { method: 'POST' }),
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
  verifyTarget: (id: string) =>
    http<{ ok: boolean; message: string }>(`/targets/${id}/verify`, { method: 'POST' }),
  // Workspace-scoped target allocations (ADR-060). Owner/admin manage; members read.
  listAllocations: () => http<TargetAllocation[]>('/allocations'),
  updateAllocation: (
    id: string,
    body: Partial<{ status: 'active' | 'disabled'; maxEnvironments: number; capabilities: RuntimeKind[]; publicUrl: string }>,
  ) => http<TargetAllocation>(`/allocations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAllocation: (id: string) => http<void>(`/allocations/${id}`, { method: 'DELETE' }),
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
  githubStatus: () =>
    http<GitHubStatus>('/scm/github/status'),
  startGithubSetup: () =>
    http<{ installUrl: string }>('/scm/github/setup', { method: 'POST' }),
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
  adminCreateUser: (body: { username: string; email: string; name?: string; platformRole?: 'admin' | 'user' }) =>
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
