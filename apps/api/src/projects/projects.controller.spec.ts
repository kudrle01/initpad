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
});
