import { ProjectDeletion } from './project-deletion';

const PROJECT = {
  id: 'project-1',
  name: 'app',
  repoUrl: 'https://git.test/team/app',
  repoPath: '/tmp/initpad-nonexistent-project-deletion-spec',
  scmProvider: 'gitea',
  scmRepositoryId: '101',
  scmOwner: 'team',
  scmRepositoryName: 'app',
  scmFullName: 'team/app',
  scmDefaultBranch: 'main',
  scmInstallationId: null,
  owner: null,
  environments: [
    {
      id: 'environment-1',
      name: 'dev',
      provider: 'docker',
      status: 'running',
      version: 'a'.repeat(40),
      activeOperationId: null,
      target: { id: 'builtin-docker', scope: 'builtin', kind: 'docker', name: 'Docker' },
      allocation: null,
      buildArtifact: null,
    },
  ],
};

describe('ProjectDeletion ordering', () => {
  it('fences active work before teardown and preserves source until artifacts are removed', async () => {
    const complete = jest.fn().mockResolvedValue(undefined);
    const fenceAgentJob = jest.fn().mockResolvedValue({ count: 1 });
    const teardown = jest.fn().mockResolvedValue(undefined);
    const purgeArtifacts = jest.fn().mockResolvedValue([]);
    const detachRepo = jest.fn().mockResolvedValue(undefined);
    const deleteProject = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      deploymentOperation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'operation-1' }]),
      },
      workloadDiagnostic: {
        findMany: jest.fn().mockResolvedValue([{ currentJobId: 'diagnostic-job-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agentJob: { updateMany: fenceAgentJob },
      environment: { update: jest.fn().mockResolvedValue(undefined) },
      project: { delete: deleteProject },
    };
    const scm = {
      deletePackages: jest.fn().mockResolvedValue(undefined),
      detachRepo,
    };
    const deletion = new ProjectDeletion(
      prisma as never,
      { teardown, removeImages: jest.fn().mockResolvedValue(undefined) } as never,
      {
        connection: jest.fn().mockReturnValue(undefined),
        allocation: jest.fn().mockReturnValue(undefined),
      } as never,
      { complete } as never,
      { purgeProjectObjects: purgeArtifacts } as never,
      { provider: jest.fn().mockReturnValue(scm) } as never,
      () => ({ username: 'owner', token: 'token' }),
    );

    await deletion.execute(PROJECT as never, { repoAction: 'detach' });

    expect(complete.mock.invocationCallOrder[0]).toBeLessThan(
      fenceAgentJob.mock.invocationCallOrder[0],
    );
    expect(fenceAgentJob.mock.invocationCallOrder[0]).toBeLessThan(
      teardown.mock.invocationCallOrder[0],
    );
    expect(teardown.mock.invocationCallOrder[0]).toBeLessThan(
      purgeArtifacts.mock.invocationCallOrder[0],
    );
    expect(purgeArtifacts.mock.invocationCallOrder[0]).toBeLessThan(
      detachRepo.mock.invocationCallOrder[0],
    );
    expect(detachRepo.mock.invocationCallOrder[0]).toBeLessThan(
      deleteProject.mock.invocationCallOrder[0],
    );
  });
});
