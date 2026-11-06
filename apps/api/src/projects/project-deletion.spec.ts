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
      url: null,
      activeOperationId: null,
      target: { id: 'builtin-docker', scope: 'builtin', kind: 'docker', name: 'Docker' },
      allocation: null,
      buildArtifact: null,
    },
  ],
};

function makeDeletion(prisma: Record<string, unknown>, teardown = jest.fn()) {
  const scm = {
    deletePackages: jest.fn().mockResolvedValue(undefined),
    detachRepo: jest.fn().mockResolvedValue(undefined),
  };
  return new ProjectDeletion(
    prisma as never,
    { teardown, removeImages: jest.fn().mockResolvedValue(undefined) } as never,
    {
      connection: jest.fn().mockReturnValue(undefined),
      allocation: jest.fn().mockReturnValue(undefined),
    } as never,
    { complete: jest.fn().mockResolvedValue(undefined) } as never,
    { purgeProjectObjects: jest.fn().mockResolvedValue([]) } as never,
    { provider: jest.fn().mockReturnValue(scm) } as never,
    () => ({ username: 'owner', token: 'token' }),
  );
}

const RETIRED_AGENT_PROJECT = {
  ...PROJECT,
  environments: [
    {
      ...PROJECT.environments[0],
      activeOperationId: 'stuck-operation',
      target: {
        id: 'target-1',
        scope: 'user',
        kind: 'docker',
        name: 'old-vps',
        managementState: 'retired',
      },
    },
  ],
};

function deletionPrisma() {
  return {
    deploymentOperation: { findMany: jest.fn().mockResolvedValue([{ id: 'stuck-operation' }]) },
    workloadDiagnostic: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    agentJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    environment: { update: jest.fn().mockResolvedValue(undefined) },
    project: { delete: jest.fn().mockResolvedValue(undefined) },
  };
}

describe('ProjectDeletion on a disconnected target', () => {
  it('requires the cleanup-debt acknowledgement before abandoning the deployment', async () => {
    const prisma = deletionPrisma();
    const deletion = makeDeletion(prisma);

    await expect(
      deletion.execute(RETIRED_AGENT_PROJECT as never, { repoAction: 'detach' }),
    ).rejects.toThrow(/dev \(old-vps\) cannot be cleaned up/);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('deletes the project without contacting the retired Agent once acknowledged', async () => {
    const prisma = deletionPrisma();
    const teardown = jest.fn();
    const deletion = makeDeletion(prisma, teardown);

    await deletion.execute(RETIRED_AGENT_PROJECT as never, {
      repoAction: 'detach',
      confirmCleanupDebt: true,
    });

    expect(teardown).not.toHaveBeenCalled();
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deploymentOperation: { environment: { projectId: 'project-1' } },
          status: { in: ['blocked', 'queued', 'leased'] },
        },
      }),
    );
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
  });

  it('still requires Agent cleanup on a connected target', async () => {
    const prisma = deletionPrisma();
    const deletion = makeDeletion(prisma);
    const connected = {
      ...RETIRED_AGENT_PROJECT,
      environments: [
        {
          ...RETIRED_AGENT_PROJECT.environments[0],
          target: { ...RETIRED_AGENT_PROJECT.environments[0].target, managementState: 'active' },
        },
      ],
    };

    await expect(
      deletion.execute(connected as never, { repoAction: 'detach', confirmCleanupDebt: true }),
    ).rejects.toThrow(/Remove Agent-managed deployments first/);
  });
});

describe('ProjectDeletion of a project that never deployed', () => {
  const connectedAgentProject = (environment: Record<string, unknown>) => ({
    ...RETIRED_AGENT_PROJECT,
    environments: [
      {
        ...RETIRED_AGENT_PROJECT.environments[0],
        target: { ...RETIRED_AGENT_PROJECT.environments[0].target, managementState: 'active' },
        ...environment,
      },
    ],
  });
  const failedBuild = { status: 'failed', version: null, url: null, activeOperationId: null };

  it('deletes a project whose build or publish failed before anything was deployed', async () => {
    const prisma = deletionPrisma();
    const deletion = makeDeletion(prisma);

    await deletion.execute(connectedAgentProject(failedBuild) as never, { repoAction: 'detach' });

    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
  });

  it('still blocks while a deploy job succeeded or is in flight on the server', async () => {
    const prisma = deletionPrisma();
    prisma.agentJob.count.mockResolvedValue(1);
    const deletion = makeDeletion(prisma);

    await expect(
      deletion.execute(connectedAgentProject(failedBuild) as never, { repoAction: 'detach' }),
    ).rejects.toThrow(/Remove Agent-managed deployments first/);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });
});

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
