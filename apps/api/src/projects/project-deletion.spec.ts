import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config';
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

// The executing-operation probe filters on a live execution lease; every other
// lookup sees the plain list of unfinished operations.
function unfinishedOperations(rows: Array<{ id: string }>, executing: unknown[] = []) {
  return jest.fn(async ({ where }: { where: { executionOwner?: unknown } }) =>
    where.executionOwner ? executing : rows,
  );
}

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
    deploymentOperation: {
      findMany: unfinishedOperations([{ id: 'stuck-operation' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workloadDiagnostic: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    agentJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    environment: { update: jest.fn().mockResolvedValue(undefined) },
    project: {
      delete: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
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
        findMany: unfinishedOperations([{ id: 'operation-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      workloadDiagnostic: {
        findMany: jest.fn().mockResolvedValue([{ currentJobId: 'diagnostic-job-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      agentJob: { updateMany: fenceAgentJob },
      environment: { update: jest.fn().mockResolvedValue(undefined) },
      project: { delete: deleteProject, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

describe('ProjectDeletion safety', () => {
  const originalWorkspaceDir = config.workspaceDir;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'initpad-deletion-spec-'));
    config.workspaceDir = join(root, 'workspace');
    mkdirSync(config.workspaceDir);
  });

  afterEach(() => {
    config.workspaceDir = originalWorkspaceDir;
    rmSync(root, { recursive: true, force: true });
  });

  const projectWithPath = (repoPath: string) => ({ ...PROJECT, repoPath, environments: [] });

  it('never removes a legacy relative repoPath resolved against the API directory', async () => {
    const apiDir = join(root, 'api');
    mkdirSync(join(apiDir, 'team', 'app'), { recursive: true });
    const cwd = process.cwd();
    process.chdir(apiDir);
    try {
      await makeDeletion(deletionPrisma()).execute(projectWithPath('team/app') as never, {
        repoAction: 'detach',
      });
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(join(apiDir, 'team', 'app'))).toBe(true);
  });

  it('removes only an absolute checkout inside the workspace directory', async () => {
    const outside = join(root, 'outside');
    const inside = join(config.workspaceDir, 'team', 'app-abc123');
    mkdirSync(outside);
    mkdirSync(inside, { recursive: true });

    await makeDeletion(deletionPrisma()).execute(projectWithPath(outside) as never, {
      repoAction: 'detach',
    });
    await makeDeletion(deletionPrisma()).execute(projectWithPath(inside) as never, {
      repoAction: 'detach',
    });

    expect(existsSync(outside)).toBe(true);
    expect(existsSync(inside)).toBe(false);
  });

  it('refuses a second concurrent deletion before any teardown', async () => {
    const prisma = deletionPrisma();
    prisma.project.updateMany.mockResolvedValue({ count: 0 });
    const teardown = jest.fn();

    await expect(
      makeDeletion(prisma, teardown).execute(PROJECT as never, { repoAction: 'detach' }),
    ).rejects.toThrow('already being deleted');
    expect(teardown).not.toHaveBeenCalled();
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('cancels an executor-owned deployment and refuses deletion until it stops', async () => {
    const prisma = deletionPrisma();
    prisma.deploymentOperation.findMany = unfinishedOperations(
      [{ id: 'operation-1' }],
      [{ id: 'operation-1', environment: { name: 'dev' } }],
    );
    const teardown = jest.fn();

    await expect(
      makeDeletion(prisma, teardown).execute(PROJECT as never, { repoAction: 'detach' }),
    ).rejects.toThrow('A deployment is still running in dev. It has been cancelled');
    expect(prisma.deploymentOperation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['operation-1'] }, finishedAt: null },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(teardown).not.toHaveBeenCalled();
    // The lock is released so the user can retry once the executor finished.
    expect(prisma.project.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'project-1', deletionStartedAt: expect.any(Date) },
      data: { deletionStartedAt: null },
    });
  });
});
