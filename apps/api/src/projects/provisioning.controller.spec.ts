import { ProvisioningController } from './provisioning.controller';

describe('ProvisioningController', () => {
  it('lists only the workspace resolved through the authenticated membership', async () => {
    const provisioning = { listWorkspace: jest.fn(async () => [{ id: 'op1' }]) };
    const projects = {};
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'ws1' })),
      require: jest.fn(async () => 'viewer'),
    };
    const controller = new ProvisioningController(
      provisioning as never,
      projects as never,
      workspaces as never,
    );
    await expect(controller.list('u1', 'ws1')).resolves.toEqual([{ id: 'op1' }]);
    expect(workspaces.resolve).toHaveBeenCalledWith('u1', 'ws1');
    expect(workspaces.require).toHaveBeenCalledWith('u1', 'ws1', 'read');
    expect(provisioning.listWorkspace).toHaveBeenCalledWith('ws1', 'u1');
  });

  it('delegates cleanup with the authenticated user rather than a body identity', async () => {
    const projects = { cleanupProvisioning: jest.fn(async () => undefined) };
    const controller = new ProvisioningController({} as never, projects as never, {} as never);
    await controller.cleanup('op1', 'u1');
    expect(projects.cleanupProvisioning).toHaveBeenCalledWith('op1', 'u1');
  });
});
