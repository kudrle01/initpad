import type { Project, TemplateManifest, EnvName, Commit, User, ProviderKind } from '@/types';

export interface EnvConfig {
  name: EnvName;
  provider: ProviderKind;
}

const BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  // 204 / empty body (e.g. DELETE) — nothing to parse.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  listProjects: () => http<Project[]>('/projects'),
  getProject: (id: string) => http<Project>(`/projects/${id}`),
  getCommits: (id: string) => http<Commit[]>(`/projects/${id}/commits`),
  listTemplates: () => http<TemplateManifest[]>('/templates'),
  createProject: (name: string, templateId: string, environments: EnvConfig[]) =>
    http<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, templateId, environments }),
    }),
  promote: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/promote/${env}`, { method: 'POST' }),
  redeploy: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/redeploy/${env}`, { method: 'POST' }),
  stopEnv: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/stop/${env}`, { method: 'POST' }),
  startEnv: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/start/${env}`, { method: 'POST' }),
  removeEnv: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/teardown/${env}`, { method: 'POST' }),
  getLogs: (id: string, env: EnvName) =>
    http<{ logs: string }>(`/projects/${id}/logs/${env}`),
  deleteProject: (id: string) =>
    http<void>(`/projects/${id}`, { method: 'DELETE' }),
  me: () => http<User>('/auth/me'),
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
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  getGitAccess: () =>
    http<{ username: string; token: string | null; giteaUrl: string }>('/me/git-access'),
};
