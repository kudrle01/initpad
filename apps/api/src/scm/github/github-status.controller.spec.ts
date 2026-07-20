import { GitHubStatusController } from './github-status.controller';

describe('GitHubStatusController', () => {
  it('reports only installations explicitly authorized for the active workspace', async () => {
    const identities = {
      listForUser: jest.fn(async () => [{ provider: 'github', username: 'alice' }]),
    };
    const installations = {
      listForWorkspace: jest.fn(async () => [{
        githubInstallation: {
          id: 'installation-row-1', accountId: '987654', accountLogin: 'acme',
          accountType: 'Organization', repositorySelection: 'selected', suspendedAt: null,
        },
      }]),
    };
    const app = { isConfigured: jest.fn(() => true) };
    const workspaces = { resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })) };
    const controller = new GitHubStatusController(
      identities as never,
      installations as never,
      app as never,
      workspaces as never,
      { isReadyForUser: jest.fn(async () => true) } as never,
    );

    const result = await controller.status('user-1', 'workspace-1');
    expect(installations.listForWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result.installation).toEqual({ present: true, suspended: false });
    expect(result.installations[0]).toMatchObject({ accountId: '987654', accountLogin: 'acme' });
  });

  it('does not let a regular workspace member start installation setup', async () => {
    const controller = new GitHubStatusController(
      { listForUser: jest.fn(async () => [{ provider: 'github', username: 'alice' }]) } as never,
      { listForWorkspace: jest.fn(async () => []) } as never,
      { isConfigured: jest.fn(() => true) } as never,
      { resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'member' })) } as never,
      { isReadyForUser: jest.fn(async () => true) } as never,
    );
    await expect(controller.status('user-1', 'workspace-1')).resolves.toMatchObject({
      canInstall: false,
    });
  });
});
