import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

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
          repoPath: '/tmp/initpad-nonexistent-project-1',
          environments: [environment],
          owner: null,
        }),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      deploymentOperation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      environment: { update: jest.fn().mockResolvedValue(environment) },
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
      gitea as never,
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
  });
});
