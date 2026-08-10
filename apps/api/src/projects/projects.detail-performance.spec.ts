import { ProjectsService } from './projects.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ProjectsService detail performance', () => {
  it('does not make a project read wait for SCM reconciliation', async () => {
    const repositoryCheck = deferred<boolean>();
    const project = {
      id: 'p1',
      templateId: 'react-vite',
      scmProvider: 'gitea',
      scmRepositoryId: '101',
      scmOwner: 'acme',
      scmRepositoryName: 'web',
      scmFullName: 'acme/web',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'http://gitea/acme/web',
      owner: null,
    };
    const prisma = {
      project: { findUnique: jest.fn(async () => project) },
      environment: { findUnique: jest.fn(async () => null) },
    };
    const scm = { repoMissing: jest.fn(() => repositoryCheck.promise) };
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

    await expect(service.reconcileProject(project.id)).resolves.toBeUndefined();
    expect(scm.repoMissing).toHaveBeenCalledTimes(1);

    await expect(service.reconcileProject(project.id)).resolves.toBeUndefined();
    expect(scm.repoMissing).toHaveBeenCalledTimes(1);

    repositoryCheck.resolve(false);
    await repositoryCheck.promise;
  });
});
