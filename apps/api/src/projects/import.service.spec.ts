import { NotFoundException } from '@nestjs/common';
import { ImportService } from './import.service';

// Encrypted-secret decrypt is exercised elsewhere; here the token value is opaque.
jest.mock('../common/secret', () => ({ decryptSecret: () => 'tok' }));

const OWNER = { username: 'kudrla', accessToken: 'enc' };

function repo(over: Record<string, unknown> = {}) {
  return {
    provider: 'gitea',
    repositoryId: '101',
    owner: 'kudrla',
    name: 'api',
    fullName: 'kudrla/api',
    repoUrl: 'https://git.test/kudrla/api',
    installationId: null,
    private: true,
    defaultBranch: 'main',
    updatedAt: '',
    empty: false,
    ...over,
  };
}

describe('ImportService.listImportable', () => {
  it('marks repositories already imported into the workspace', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn(async () => OWNER) },
      project: {
        findMany: jest.fn(async () => [
          { scmProvider: 'gitea', scmRepositoryId: '101', scmFullName: 'kudrla/api' },
        ]),
      },
    };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'member') };
    const scm = {
      listRepositories: jest.fn(async () => [
        repo(),
        repo({ repositoryId: '102', name: 'web', fullName: 'kudrla/web' }),
      ]),
    };
    const workspaceScm = { listRepositories: scm.listRepositories };
    const service = new ImportService(prisma as never, workspaces as never, {} as never, workspaceScm as never);
    const result = await service.listImportable('u1');
    expect(result.find((r) => r.name === 'api')?.alreadyImported).toBe(true);
    expect(result.find((r) => r.name === 'web')?.alreadyImported).toBe(false);
  });
});

describe('ImportService.preflight', () => {
  const workspaces = { resolve: jest.fn(async () => ({ id: 'ws1' })), require: jest.fn(async () => 'maintainer') };

  function build(opts: {
    repos?: unknown[];
    dockerfile?: string | null;
    workflow?: string | null;
    existingProject?: unknown;
    template?: unknown;
  }) {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn(async () => OWNER) },
      project: { findFirst: jest.fn(async () => opts.existingProject ?? null) },
    };
    const templates = { get: jest.fn(() => opts.template ?? { id: 'node-api', name: 'Node API', runtime: 'node', artifact: 'runtime' }) };
    const scm = {
      listRepositories: jest.fn(async () => opts.repos ?? [repo()]),
      readFile: jest.fn(async (_repo: unknown, path: string) =>
        path === 'Dockerfile'
          ? (opts.dockerfile === undefined ? 'FROM node' : opts.dockerfile)
          : (opts.workflow === undefined
              ? 'curl "$INITPAD_PLATFORM_URL" -H "$INITPAD_DEPLOY_TOKEN"'
              : opts.workflow)),
    };
    const workspaceScm = {
      repository: jest.fn(async (_userId: string, _workspaceId: string, repositoryId: string) => {
        const found = (opts.repos ?? [repo()]).find(
          (candidate) => (candidate as ReturnType<typeof repo>).repositoryId === repositoryId,
        ) as ReturnType<typeof repo> | undefined;
        if (!found) throw new NotFoundException(`Repository '${repositoryId}' not found`);
        return { repo: found, actor: { username: OWNER.username, token: 'tok' } };
      }),
      provider: jest.fn(() => scm),
    };
    return new ImportService(prisma as never, workspaces as never, templates as never, workspaceScm as never);
  }

  it('passes a healthy repo with a Dockerfile', async () => {
    const result = await build({}).preflight('u1', undefined, { repositoryId: '101', templateId: 'node-api' });
    expect(result).toMatchObject({ branch: 'main', runtime: 'node', hasDockerfile: true, canImport: true });
    expect(result.warnings).toHaveLength(0);
  });

  it('blocks a non-static template with no Dockerfile', async () => {
    const result = await build({ dockerfile: null }).preflight('u1', undefined, { repositoryId: '101', templateId: 'node-api' });
    expect(result.hasDockerfile).toBe(false);
    expect(result.canImport).toBe(false);
    expect(result.warnings.join(' ')).toContain('No Dockerfile');
  });

  it('blocks a repository without the provider-specific InitPad workflow', async () => {
    const result = await build({ workflow: null }).preflight(
      'u1',
      undefined,
      { repositoryId: '101', templateId: 'node-api' },
    );
    expect(result.hasCompatibleWorkflow).toBe(false);
    expect(result.canImport).toBe(false);
    expect(result.warnings.join(' ')).toContain('.gitea/workflows/ci.yml');
  });

  it('blocks a legacy GitHub callback without an immutable artifact handoff', async () => {
    const result = await build({
      repos: [repo({ provider: 'github', installationId: 'installation-1' })],
      workflow: 'INITPAD_PLATFORM_URL INITPAD_DEPLOY_TOKEN',
    }).preflight('u1', undefined, { repositoryId: '101', templateId: 'node-api' });
    expect(result.hasCompatibleWorkflow).toBe(false);
    expect(result.canImport).toBe(false);
    expect(result.warnings.join(' ')).toContain('legacy callback');
  });

  it('blocks an empty repository', async () => {
    const result = await build({ repos: [repo({ empty: true })] }).preflight('u1', undefined, { repositoryId: '101', templateId: 'node-api' });
    expect(result.canImport).toBe(false);
    expect(result.warnings.join(' ')).toContain('empty');
  });

  it('blocks a name already used in the workspace', async () => {
    const result = await build({ existingProject: { id: 'p1' } }).preflight('u1', undefined, { repositoryId: '101', templateId: 'node-api' });
    expect(result.alreadyImported).toBe(true);
    expect(result.canImport).toBe(false);
  });

  it('rejects an unknown repository', async () => {
    await expect(build({ repos: [] }).preflight('u1', undefined, { repositoryId: 'ghost', templateId: 'node-api' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
