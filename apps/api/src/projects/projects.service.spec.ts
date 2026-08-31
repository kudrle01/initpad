import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const SCM_FIELDS = {
  scmProvider: 'gitea',
  scmRepositoryId: '101',
  scmOwner: 'team',
  scmRepositoryName: 'app',
  scmFullName: 'team/app',
  scmDefaultBranch: 'main',
  scmInstallationId: null,
};

describe('ProjectsService project deletion', () => {
  it('requires an explicit acknowledgement for production cleanup', async () => {
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'project-1',
          environments: [
            {
              id: 'prod-1',
              name: 'prod',
              status: 'running',
              version: 'abc123',
              url: 'https://example.test/app',
              target: null,
            },
          ],
          owner: null,
        }),
      },
    };
    const deployment = { teardown: jest.fn() };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      deployment as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.remove('project-1', {
        deleteRemoteRepo: false,
        confirmProduction: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deployment.teardown).not.toHaveBeenCalled();
  });

  it('marks an environment empty when only protected target cleanup remains', async () => {
    const environment = {
      id: 'prod-1',
      name: 'prod',
      provider: 'sftp',
      status: 'failed',
      version: 'abc123',
      url: 'https://example.test/app',
      activeOperationId: null,
      target: null,
    };
    const prisma = {
      project: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'project-1',
          name: 'app',
          repoUrl: 'https://git.test/team/app',
          ...SCM_FIELDS,
          templateId: 'nette',
        }),
      },
      environment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(environment),
        update: jest.fn().mockResolvedValue(environment),
      },
    };
    const deployment = {
      teardown: jest.fn().mockResolvedValue({
        warning: 'Public deployment removed. Administrator cleanup is still required.',
      }),
    };
    const service = new ProjectsService(
      prisma as never,
      { get: jest.fn().mockReturnValue({}) } as never,
      {} as never,
      deployment as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);

    await service.removeEnv('project-1', 'prod');

    expect(prisma.environment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'empty',
          version: null,
          url: null,
          statusReason: expect.stringContaining('Cleanup pending:'),
        }),
      }),
    );
  });

  it('keeps the project retryable while protected target cleanup is pending', async () => {
    const environment = {
      id: 'prod-1',
      name: 'prod',
      provider: 'sftp',
      status: 'failed',
      version: 'abc123',
      url: null,
      activeOperationId: null,
      target: { name: 'ESO' },
    };
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'project-1',
          name: 'app',
          repoUrl: 'https://git.test/team/app',
          ...SCM_FIELDS,
          repoPath: '/tmp/initpad-nonexistent-project-1',
          environments: [environment],
          owner: null,
        }),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      deploymentOperation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      agentJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      workloadDiagnostic: {
        findMany: jest.fn().mockResolvedValue([{ currentJobId: 'diagnostic-job-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      environment: { update: jest.fn().mockResolvedValue(environment) },
      buildArtifact: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const deployment = {
      teardown: jest.fn().mockResolvedValue({
        warning: 'Public deployment removed. Administrator cleanup is still required.',
      }),
      removeImages: jest.fn(),
    };
    const gitea = {
      deletePackages: jest.fn().mockResolvedValue(undefined),
      detachRepo: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      deployment as never,
      { connectionForTarget: jest.fn().mockReturnValue(undefined) } as never,
      { provider: jest.fn(() => gitea) } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.remove('project-1', {
        deleteRemoteRepo: false,
        confirmProduction: true,
      }),
    ).rejects.toThrow('project deletion is waiting for target cleanup');
    expect(deployment.removeImages).not.toHaveBeenCalled();
    expect(prisma.environment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'empty', url: null }),
      }),
    );

    await expect(
      service.remove('project-1', {
        deleteRemoteRepo: false,
        confirmProduction: true,
        confirmCleanupDebt: true,
      }),
    ).resolves.toBeUndefined();
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['diagnostic-job-1'] } }),
      data: expect.objectContaining({ status: 'cancelled', resultCode: 'project_deleted' }),
    }));
  });

  it('preserves the source repository when durable artifact cleanup fails', async () => {
    const project = {
      id: 'project-1',
      name: 'app',
      repoUrl: 'https://git.test/team/app',
      ...SCM_FIELDS,
      repoPath: '/tmp/initpad-nonexistent-project-1',
      environments: [],
      owner: null,
    };
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue(project),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      deploymentOperation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      agentJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      workloadDiagnostic: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      buildArtifact: {
        findMany: jest.fn().mockResolvedValue([
          { storageRef: 'artifacts/team/project-1/image.tar' },
        ]),
      },
    };
    const deployment = { removeImages: jest.fn().mockResolvedValue(undefined) };
    const gitea = {
      deletePackages: jest.fn().mockResolvedValue(undefined),
      deleteRepo: jest.fn().mockResolvedValue(undefined),
    };
    const artifactStore = {
      delete: jest.fn().mockRejectedValue(new Error('object store unavailable')),
    };
    const service = new ProjectsService(
      prisma as never,
      {} as never,
      {} as never,
      deployment as never,
      {} as never,
      { provider: jest.fn(() => gitea) } as never,
      {} as never,
      {} as never,
      artifactStore as never,
    );

    await expect(
      service.remove('project-1', {
        deleteRemoteRepo: true,
        confirmProduction: false,
      }),
    ).rejects.toThrow('deleting stored build artifacts failed');

    expect(artifactStore.delete).toHaveBeenCalledWith('artifacts/team/project-1/image.tar');
    expect(gitea.deletePackages).not.toHaveBeenCalled();
    expect(gitea.deleteRepo).not.toHaveBeenCalled();
    expect(prisma.project.delete).not.toHaveBeenCalled();

    await expect(
      service.remove('project-1', {
        deleteRemoteRepo: true,
        confirmProduction: false,
        confirmCleanupDebt: true,
      }),
    ).resolves.toBeUndefined();

    expect(gitea.deleteRepo).toHaveBeenCalledTimes(1);
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
  });
});
