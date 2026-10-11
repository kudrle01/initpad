import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hashToken } from '../common/token';
import { ProjectsService } from './projects.service';

function serviceWith(projects: Record<string, unknown>[], scm: Record<string, unknown> = {}) {
  const prisma = {
    project: {
      findMany: jest.fn(async ({ where }: { where: { scmFullName: string } }) =>
        projects.filter((project) => project.scmFullName === where.scmFullName),
      ),
      // Lookups by the token hash, by id and for a taken project name.
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        'ciDeployTokenHash' in where
          ? (projects.find((project) => project.ciDeployTokenHash === where.ciDeployTokenHash) ??
            null)
          : null,
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          projects.find((project) => project.id === where.id) ?? null,
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
          Object.assign(projects.find((project) => project.id === where.id) ?? {}, data),
      ),
    },
    buildArtifact: { findMany: jest.fn(async () => []), update: jest.fn() },
    environment: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (run: (tx: typeof prisma) => unknown) =>
    run(prisma),
  );
  const service = new ProjectsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { provider: jest.fn(() => scm) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma };
}

const renamable = (token: string) => ({
  id: 'project-1',
  name: 'one',
  workspaceId: 'ws1',
  scmProvider: 'github',
  scmRepositoryId: '101',
  scmOwner: 'acme',
  scmRepositoryName: 'one',
  scmFullName: 'acme/one',
  scmDefaultBranch: 'main',
  scmInstallationId: 'installation-1',
  repoUrl: 'https://github.com/acme/one',
  deploymentKey: 'acme-one',
  ciDeployTokenHash: hashToken(token),
  owner: null,
});

const confirmed = (name: string) => ({
  state: 'found',
  repository: {
    provider: 'github',
    repositoryId: '101',
    owner: 'acme',
    name,
    fullName: `acme/${name}`,
    defaultBranch: 'main',
    repoUrl: `https://github.com/acme/${name}`,
    installationId: 'installation-1',
  },
});

describe('ProjectsService CI runner start signal', () => {
  it('keeps simultaneous projects isolated by repository and secret', async () => {
    const firstToken = 'first-repository-secret';
    const secondToken = 'second-repository-secret';
    const { service, prisma } = serviceWith([
      {
        id: 'project-1',
        scmFullName: 'acme/one',
        scmDefaultBranch: 'main',
        ciDeployTokenHash: hashToken(firstToken),
      },
      {
        id: 'project-2',
        scmFullName: 'acme/two',
        scmDefaultBranch: 'main',
        ciDeployTokenHash: hashToken(secondToken),
      },
    ]);

    await Promise.all([
      service.ciStarted('acme/one', 'a'.repeat(40), 'main', firstToken),
      service.ciStarted('acme/two', 'b'.repeat(40), 'main', secondToken),
    ]);

    expect(prisma.environment.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ projectId: 'project-1', version: null }),
      data: { statusReason: 'CI runner started the build' },
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ projectId: 'project-2', version: null }),
      data: { statusReason: 'CI runner started the build' },
    });
  });

  it('rejects a different repository secret before changing state', async () => {
    const { service, prisma } = serviceWith([
      {
        id: 'project-1',
        scmFullName: 'acme/one',
        scmDefaultBranch: 'main',
        ciDeployTokenHash: hashToken('correct-secret'),
      },
    ]);

    await expect(
      service.ciStarted('acme/one', 'a'.repeat(40), 'main', 'wrong-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.environment.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a callback from a renamed repository once the provider confirms the name', async () => {
    const token = 'repository-secret';
    const project = renamable(token);
    const scm = { resolveRepository: jest.fn(async () => confirmed('renamed')) };
    const { service, prisma } = serviceWith([project], scm);

    await expect(
      service.ciStarted('acme/renamed', 'a'.repeat(40), 'main', token),
    ).resolves.toBeUndefined();

    expect(scm.resolveRepository).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: '101', fullName: 'acme/one' }),
      expect.anything(),
    );
    expect(project).toMatchObject({
      name: 'renamed',
      scmFullName: 'acme/renamed',
      // The running workload keeps the key of its original name.
      deploymentKey: 'acme-one',
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'project-1' }) }),
    );
  });

  it('does not trust a new repository name the provider does not confirm', async () => {
    const token = 'repository-secret';
    const project = renamable(token);
    // The token is valid, but GitHub reports a different name for this ID.
    const scm = { resolveRepository: jest.fn(async () => confirmed('one')) };
    const { service, prisma } = serviceWith([project], scm);

    await expect(
      service.ciStarted('acme/forged', 'a'.repeat(40), 'main', token),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(project.scmFullName).toBe('acme/one');
    expect(prisma.environment.updateMany).not.toHaveBeenCalled();
  });

  it('returns a retryable failure while the project transaction is not visible yet', async () => {
    const { service, prisma } = serviceWith([]);

    await expect(
      service.ciStarted('acme/just-created', 'a'.repeat(40), 'main', 'secret'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.environment.updateMany).not.toHaveBeenCalled();
  });
});
