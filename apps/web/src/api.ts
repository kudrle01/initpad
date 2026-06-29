import type { Project, TemplateManifest, EnvName, Commit } from '@/types';

const BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => http<Project[]>('/projects'),
  getProject: (id: string) => http<Project>(`/projects/${id}`),
  getCommits: (id: string) => http<Commit[]>(`/projects/${id}/commits`),
  listTemplates: () => http<TemplateManifest[]>('/templates'),
  createProject: (name: string, templateId: string) =>
    http<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, templateId }),
    }),
  promote: (id: string, env: EnvName) =>
    http<Project>(`/projects/${id}/promote/${env}`, { method: 'POST' }),
};
