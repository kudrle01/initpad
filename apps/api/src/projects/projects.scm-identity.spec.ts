import { ProjectsService } from './projects.service';
import { ProjectReconciliation } from './project-reconciliation';

function serviceWith(prisma: unknown, scm: unknown) {
  return new ProjectsService(
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
}

function reconciliationWith(prisma: unknown, scm: unknown) {
  return new ProjectReconciliation(
    prisma as never,
    {} as never,
    { provider: jest.fn(() => scm) } as never,
    { complete: jest.fn() } as never,
    () => ({ username: 'owner', token: '' }),
    jest.fn(async () => undefined),
  );
}

describe('ProjectsService SCM identity', () => {
  it('refreshes renamed repository coordinates by immutable provider id', async () => {
    const prisma = {
      project: {
        findMany: jest.fn(async () => [
          {
            id: 'project-1',
            scmProvider: 'gitea',
            scmRepositoryId: '101',
            scmOwner: 'old-owner',
            scmRepositoryName: 'old-name',
            scmFullName: 'old-owner/old-name',
            repoUrl: 'https://git.test/old-owner/old-name',
            owner: null,
          },
        ]),
        update: jest.fn(async () => ({})),
      },
    };
    const scm = {
      listRepositories: jest.fn(async () => [
        {
          provider: 'gitea',
          repositoryId: '101',
          owner: 'new-owner',
          name: 'new-name',
          fullName: 'new-owner/new-name',
          defaultBranch: 'trunk',
          repoUrl: 'https://git.test/new-owner/new-name',
          installationId: null,
          private: true,
          updatedAt: '',
          empty: false,
        },
      ]),
    };
    const reconciliation = reconciliationWith(prisma, scm);

    await reconciliation.reconcileRepositoryIdentities();

    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        scmRepositoryId: '101',
        scmOwner: 'new-owner',
        scmRepositoryName: 'new-name',
        scmFullName: 'new-owner/new-name',
        scmDefaultBranch: 'trunk',
        repoUrl: 'https://git.test/new-owner/new-name',
      },
    });
  });

  it('matches repository-deletion webhooks by immutable id with a legacy-only fallback', async () => {
    const prisma = { project: { findFirst: jest.fn(async () => null) } };
    const service = serviceWith(prisma, {});

    await service.removeByRepo('acme/api', 'gitea', '101');

    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scmProvider: 'gitea',
          OR: [{ scmRepositoryId: '101' }, { scmRepositoryId: null, scmFullName: 'acme/api' }],
        },
      }),
    );
  });

  it('reconciles healthy repository secrets even when another repository is gone', async () => {
    const project = (id: string, name: string) => ({
      scmProvider: 'gitea',
      scmRepositoryId: id,
      scmOwner: 'acme',
      scmRepositoryName: name,
      scmFullName: `acme/${name}`,
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: `https://git.test/acme/${name}`,
    });
    const prisma = {
      project: { findMany: jest.fn(async () => [project('101', 'gone'), project('102', 'api')]) },
    };
    const scm = {
      configureRepoRuntimeSecrets: jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 404'))
        .mockResolvedValueOnce(undefined),
    };
    const reconciliation = reconciliationWith(prisma, scm);

    await expect(reconciliation.reconcileCiRuntimeSecrets()).resolves.toBeUndefined();
    expect(scm.configureRepoRuntimeSecrets).toHaveBeenCalledTimes(2);
  });
});
