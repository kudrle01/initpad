import { ProjectsController } from './projects.controller';

describe('ProjectsController project deletion', () => {
  it('passes independent repository and production choices to the service', async () => {
    const projects = {
      assertAccess: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ProjectsController(projects as never);

    await controller.remove(
      'project-1',
      { deleteRepository: true, confirmProduction: true, confirmCleanupDebt: true },
      'user-1',
    );

    expect(projects.assertAccess).toHaveBeenCalledWith('project-1', 'user-1', 'maintain');
    expect(projects.remove).toHaveBeenCalledWith('project-1', {
      deleteRemoteRepo: true,
      confirmProduction: true,
      confirmCleanupDebt: true,
    });
  });

  it('requires write access before requesting a failed GitHub job re-run', async () => {
    const projects = {
      assertAccess: jest.fn().mockResolvedValue(undefined),
      rerunFailedJobs: jest.fn().mockResolvedValue({ runId: '77' }),
    };
    const controller = new ProjectsController(projects as never);

    await expect(controller.rerunFailedJobs('project-1', 'user-1')).resolves.toEqual({
      runId: '77',
    });
    expect(projects.assertAccess).toHaveBeenCalledWith('project-1', 'user-1', 'write');
    expect(projects.rerunFailedJobs).toHaveBeenCalledWith('project-1');
  });

  it('requires maintainer access and forwards the reviewed rollback candidate', async () => {
    const projects = {
      assertAccess: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue({ id: 'project-1' }),
    };
    const controller = new ProjectsController(projects as never);
    const dto = {
      candidateOperationId: '123e4567-e89b-42d3-a456-426614174000',
      stateToken: 'a'.repeat(64),
    };

    await expect(controller.rollback('project-1', 'prod', dto, 'user-1'))
      .resolves.toEqual({ id: 'project-1' });
    expect(projects.assertAccess).toHaveBeenCalledWith(
      'project-1',
      'user-1',
      'maintain',
    );
    expect(projects.rollback).toHaveBeenCalledWith(
      'project-1',
      'prod',
      dto.candidateOperationId,
      dto.stateToken,
    );
  });
});
