import { ProjectsController } from './projects.controller';

const PROJECT = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'app',
};

describe('ProjectsController project deletion', () => {
  it('passes independent repository and production choices to the service', async () => {
    const projects = {
      assertAccess: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(PROJECT),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new ProjectsController(projects as never, audit as never);

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
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'project.deleted',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'app',
      details: { repositoryDeleted: true },
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
      rollback: jest.fn().mockResolvedValue(PROJECT),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new ProjectsController(projects as never, audit as never);
    const dto = {
      candidateOperationId: '123e4567-e89b-42d3-a456-426614174000',
      stateToken: 'a'.repeat(64),
    };

    await expect(controller.rollback('project-1', 'prod', dto, 'user-1'))
      .resolves.toEqual(PROJECT);
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
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'environment.rollback_requested',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'app',
      details: {
        environment: 'prod',
        candidateOperationId: dto.candidateOperationId,
      },
    });
  });

  it('requires write access before exposing or refreshing sensitive workload logs', async () => {
    const projects = {
      assertAccess: jest.fn().mockResolvedValue(undefined),
      workloadDiagnostic: jest.fn().mockResolvedValue(null),
      requestWorkloadDiagnostic: jest.fn().mockResolvedValue({ status: 'queued' }),
      get: jest.fn().mockResolvedValue(PROJECT),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new ProjectsController(projects as never, audit as never);
    const requestId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(controller.workloadDiagnostic('project-1', 'dev', 'user-1'))
      .resolves.toBeNull();
    await expect(controller.requestWorkloadDiagnostic(
      'project-1',
      'dev',
      { requestId },
      'user-1',
    )).resolves.toEqual({ status: 'queued' });
    expect(projects.assertAccess).toHaveBeenNthCalledWith(1, 'project-1', 'user-1', 'write');
    expect(projects.assertAccess).toHaveBeenNthCalledWith(2, 'project-1', 'user-1', 'write');
    expect(projects.requestWorkloadDiagnostic).toHaveBeenCalledWith(
      'project-1',
      'dev',
      'user-1',
      requestId,
    );
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'user-1',
      action: 'environment.diagnostic_requested',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'app',
      details: { environment: 'dev' },
    });
  });
});
