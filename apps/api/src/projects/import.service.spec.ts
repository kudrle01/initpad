import { NotFoundException } from '@nestjs/common';
import { ImportService } from './import.service';

// Encrypted-secret decrypt is exercised elsewhere; here the token value is opaque.
jest.mock('../common/secret', () => ({ decryptSecret: () => 'tok' }));

const OWNER = { username: 'kudrla', accessToken: 'enc' };

function repo(over: Record<string, unknown> = {}) {
  return { name: 'api', fullName: 'kudrla/api', private: true, defaultBranch: 'main', updatedAt: '', empty: false, ...over };
}

describe('ImportService.listImportable', () => {
  it('marks repositories already imported into the workspace', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn(async () => OWNER) },
      project: { findMany: jest.fn(async () => [{ name: 'api' }]) },
    };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'member') };
    const scm = { listRepositories: jest.fn(async () => [repo(), repo({ name: 'web', fullName: 'kudrla/web' })]) };
    const service = new ImportService(prisma as never, workspaces as never, {} as never, scm as never);
    const result = await service.listImportable('u1');
    expect(result.find((r) => r.name === 'api')?.alreadyImported).toBe(true);
    expect(result.find((r) => r.name === 'web')?.alreadyImported).toBe(false);
  });
});

describe('ImportService.preflight', () => {
  const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'maintainer') };

  function build(opts: { repos?: unknown[]; dockerfile?: string | null; existingProject?: unknown; template?: unknown }) {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn(async () => OWNER) },
      project: { findFirst: jest.fn(async () => opts.existingProject ?? null) },
    };
    const templates = { get: jest.fn(() => opts.template ?? { id: 'node-api', name: 'Node API', runtime: 'node', artifact: 'runtime' }) };
    const scm = {
      listRepositories: jest.fn(async () => opts.repos ?? [repo()]),
      readFile: jest.fn(async () => (opts.dockerfile === undefined ? 'FROM node' : opts.dockerfile)),
    };
    return new ImportService(prisma as never, workspaces as never, templates as never, scm as never);
  }

  it('passes a healthy repo with a Dockerfile', async () => {
    const result = await build({}).preflight('u1', undefined, { repo: 'api', templateId: 'node-api' });
    expect(result).toMatchObject({ branch: 'main', runtime: 'node', hasDockerfile: true, canImport: true });
    expect(result.warnings).toHaveLength(0);
  });

  it('warns when a non-static template has no Dockerfile but still allows import', async () => {
    const result = await build({ dockerfile: null }).preflight('u1', undefined, { repo: 'api', templateId: 'node-api' });
    expect(result.hasDockerfile).toBe(false);
    expect(result.canImport).toBe(true);
    expect(result.warnings.join(' ')).toContain('No Dockerfile');
  });

  it('blocks an empty repository', async () => {
    const result = await build({ repos: [repo({ empty: true })] }).preflight('u1', undefined, { repo: 'api', templateId: 'node-api' });
    expect(result.canImport).toBe(false);
    expect(result.warnings.join(' ')).toContain('empty');
  });

  it('blocks a name already used in the workspace', async () => {
    const result = await build({ existingProject: { id: 'p1' } }).preflight('u1', undefined, { repo: 'api', templateId: 'node-api' });
    expect(result.alreadyImported).toBe(true);
    expect(result.canImport).toBe(false);
  });

  it('rejects an unknown repository', async () => {
    await expect(build({ repos: [] }).preflight('u1', undefined, { repo: 'ghost', templateId: 'node-api' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
