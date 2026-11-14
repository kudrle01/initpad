import { ProjectsService } from './projects.service';
import { ciRuntimeSecretsFingerprint, ProjectReconciliation } from './project-reconciliation';
import { config } from '../config';
import { ProjectRepositoryIdentity } from './project-repository-identity';

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
    new ProjectRepositoryIdentity(
      prisma as never,
      { provider: jest.fn(() => scm) } as never,
      () => ({ username: 'owner', token: '' }),
    ),
  );
}

describe('ProjectsService SCM identity', () => {
  it('refreshes renamed repository coordinates by immutable provider id', async () => {
    const row = {
      id: 'project-1',
      name: 'old-name',
      workspaceId: 'ws1',
      scmProvider: 'gitea',
      scmRepositoryId: '101',
      scmOwner: 'old-owner',
      scmRepositoryName: 'old-name',
      scmFullName: 'old-owner/old-name',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'https://git.test/old-owner/old-name',
      deploymentKey: 'old-owner-old-name',
      owner: null,
    };
    const prisma = {
      project: {
        findMany: jest.fn(async () => [row]),
        findUnique: jest.fn(async () => row),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
      },
      buildArtifact: { findMany: jest.fn(async () => []), update: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (run: (tx: typeof prisma) => unknown) =>
      run(prisma),
    );
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
        name: 'new-name',
        scmRepositoryId: '101',
        scmOwner: 'new-owner',
        scmRepositoryName: 'new-name',
        scmFullName: 'new-owner/new-name',
        scmDefaultBranch: 'trunk',
        repoUrl: 'https://git.test/new-owner/new-name',
        // The workload keeps the key of the name it was deployed under.
        deploymentKey: 'old-owner-old-name',
      },
    });
  });

  it('does not hand a new repository the workload key a renamed one still holds', async () => {
    const service = serviceWith({}, {});
    const allocate = (taken: boolean, repositoryId: string | null) =>
      (service as any).allocateDeploymentKey(
        { project: { findFirst: jest.fn(async () => (taken ? { id: 'other' } : null)) } },
        { owner: 'Acme', name: 'api', repositoryId },
      );

    await expect(allocate(false, '4242')).resolves.toBe('acme-api');
    // 'acme/api' was renamed and keeps 'acme-api'; a new 'acme/api' must differ.
    await expect(allocate(true, '987654321')).resolves.toBe('acme-api-r87654321');
    await expect(allocate(true, null)).resolves.toMatch(/^acme-api-r[a-z0-9]{1,8}$/);
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

  it('deletes after a repository webhook only when Gitea confirms the repository is gone', async () => {
    const row = {
      id: 'p1',
      scmProvider: 'gitea',
      scmRepositoryId: '101',
      scmOwner: 'acme',
      scmRepositoryName: 'api',
      scmFullName: 'acme/api',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'https://git.test/acme/api',
      owner: { username: 'acme', accessToken: '' },
    };
    const prisma = { project: { findFirst: jest.fn(async () => row) } };
    const scm = { repoMissing: jest.fn(async () => false) };
    const service = serviceWith(prisma, scm);
    const removeByRepo = jest.spyOn(service, 'removeByRepo').mockResolvedValue(undefined);

    // A replayed or forged delivery while the repository still exists.
    await service.removeIfRepositoryGone('acme/api', 'gitea', '101');
    expect(scm.repoMissing).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/api', repositoryId: '101' }),
      expect.anything(),
    );
    expect(removeByRepo).not.toHaveBeenCalled();

    scm.repoMissing.mockResolvedValueOnce(true);
    await service.removeIfRepositoryGone('acme/api', 'gitea', '101');
    expect(removeByRepo).toHaveBeenCalledWith('acme/api', 'gitea', '101');
  });

  it('reconciles healthy repository secrets even when another repository is gone', async () => {
    const project = (id: string, name: string) => ({
      id: `project-${id}`,
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
      project: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([project('101', 'gone'), project('102', 'api')])
          .mockResolvedValue([]),
        count: jest.fn(async () => 0),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const scm = {
      configureRepoRuntimeSecrets: jest
        .fn()
        .mockRejectedValueOnce(new Error('HTTP 404'))
        .mockResolvedValueOnce(undefined),
    };
    const reconciliation = reconciliationWith(prisma, scm);

    await expect(reconciliation.reconcileCiRuntimeSecrets()).resolves.toBe(1);
    expect(scm.configureRepoRuntimeSecrets).toHaveBeenCalledTimes(2);
    // Only the repository that accepted the secrets records the fingerprint;
    // the failed one is retried by the next pass.
    expect(prisma.project.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-102' },
      data: { ciRuntimeSecretsFingerprint: ciRuntimeSecretsFingerprint('gitea') },
    });
  });

  it('writes no CI secrets when every repository already has the current configuration', async () => {
    const prisma = {
      project: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        updateMany: jest.fn(),
      },
    };
    const scm = { configureRepoRuntimeSecrets: jest.fn() };
    const reconciliation = reconciliationWith(prisma, scm);

    await expect(reconciliation.reconcileCiRuntimeSecrets()).resolves.toBe(0);

    expect(scm.configureRepoRuntimeSecrets).not.toHaveBeenCalled();
    const fingerprint = ciRuntimeSecretsFingerprint('gitea');
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scmProvider: 'gitea',
          OR: [
            { ciRuntimeSecretsFingerprint: null },
            { ciRuntimeSecretsFingerprint: { not: fingerprint } },
          ],
        },
        take: 50,
      }),
    );
  });

  it('changes the fingerprint when the platform URL or registry host changes', () => {
    const original = { ...config.ci };
    const before = ciRuntimeSecretsFingerprint('gitea');
    try {
      (config.ci as { platformUrl: string }).platformUrl = 'http://10.0.0.5:3000';
      expect(ciRuntimeSecretsFingerprint('gitea')).not.toBe(before);
    } finally {
      Object.assign(config.ci, original);
    }
    expect(ciRuntimeSecretsFingerprint('gitea')).toBe(before);
    expect(ciRuntimeSecretsFingerprint('github')).not.toBe(before);
  });
});
