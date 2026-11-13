import { describe, expect, it } from 'vitest';
import type { Commit, DeploymentOperation, Project } from '@/types';
import { FIRST_PIPELINE_PATIENCE_MS, firstPipelineState } from './project-readiness';

const now = Date.parse('2026-11-13T12:00:00Z');

function project(overrides: Partial<Project['environments'][number]> = {}, age = 60_000) {
  return {
    createdAt: new Date(now - age).toISOString(),
    environments: [{ name: 'dev', status: 'empty', version: null, ...overrides }],
  } as unknown as Project;
}

function head(...statuses: Commit['pipeline'][number]['status'][]): Commit[] {
  return [
    {
      sha: 'a'.repeat(40),
      pipeline: statuses.map((status, index) => ({ name: `stage${index}`, status })),
    } as unknown as Commit,
  ];
}

describe('firstPipelineState', () => {
  it('waits while a fresh project has no CI activity', () => {
    expect(firstPipelineState(project(), head('pending', 'pending'), [], now)).toBe('waiting');
  });

  it('reports the first run once a stage starts', () => {
    expect(firstPipelineState(project(), head('running', 'pending'), [], now)).toBe('running');
  });

  it('stops promising a quick start after the patience window', () => {
    const old = project({}, FIRST_PIPELINE_PATIENCE_MS + 1);
    expect(firstPipelineState(old, head('pending'), [], now)).toBe('overdue');
  });

  it('is silent once anything was deployed or CI failed', () => {
    expect(firstPipelineState(project({ status: 'running' }), head('success'), [], now)).toBe(
      'none',
    );
    expect(firstPipelineState(project(), head('pending'), [{} as DeploymentOperation], now)).toBe(
      'none',
    );
    expect(firstPipelineState(project(), head('failed'), [], now)).toBe('none');
  });
});
