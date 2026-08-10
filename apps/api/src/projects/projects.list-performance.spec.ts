import { ProjectsService } from './projects.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ProjectsService list performance', () => {
  it('returns database state without waiting for per-repository SCM checks', async () => {
    const repositoryCheck = deferred<boolean>();
    const repository = {
      id: 'p1',
      scmProvider: 'gitea',
      scmRepositoryId: '101',
      scmOwner: 'acme',
      scmRepositoryName: 'api',
      scmFullName: 'acme/api',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'http://gitea/acme/api',
      owner: null,
    };
    const prisma = {
      project: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([repository])
          .mockResolvedValueOnce([]),
      },
    };
    const scm = { repoMissing: jest.fn(() => repositoryCheck.promise) };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { provider: jest.fn(() => scm) } as never,
      { resolve: jest.fn(async () => ({ id: 'ws1' })) } as never,
      {} as never,
      {} as never,
    );

    await expect(service.list('u1', 'ws1')).resolves.toEqual([]);
    await Promise.resolve();
    expect(scm.repoMissing).toHaveBeenCalledTimes(1);

    // A second list read remains fast and does not start a duplicate sweep.
    await expect(service.list('u1', 'ws1')).resolves.toEqual([]);
    expect(prisma.project.findMany).toHaveBeenCalledTimes(3);
    expect(scm.repoMissing).toHaveBeenCalledTimes(1);

    repositoryCheck.resolve(false);
    await repositoryCheck.promise;
  });
});
