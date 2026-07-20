import { config } from '../../config';
import { GitHubSetupController } from './github-setup.controller';

describe('GitHubSetupController', () => {
  const savedSlug = config.github.appSlug;
  const savedOAuthBase = config.github.oauthBaseUrl;

  afterEach(() => {
    config.github.appSlug = savedSlug;
    config.github.oauthBaseUrl = savedOAuthBase;
  });

  it('starts a workspace-bound setup only after admin authorization', async () => {
    config.github.appSlug = 'initpad-cloud';
    config.github.oauthBaseUrl = 'https://github.example';
    const installations = { createSetup: jest.fn(async () => 'opaque-state') };
    const app = { isConfigured: jest.fn(() => true) };
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })),
      require: jest.fn(async () => 'owner'),
    };
    const controller = new GitHubSetupController(
      installations as never,
      app as never,
      workspaces as never,
    );

    await expect(controller.start('user-1', 'workspace-1')).resolves.toEqual({
      installUrl: 'https://github.example/apps/initpad-cloud/installations/new?state=opaque-state',
    });
    expect(workspaces.require).toHaveBeenCalledWith('user-1', 'workspace-1', 'admin');
    expect(installations.createSetup).toHaveBeenCalledWith('user-1', 'workspace-1');
  });

  it('redirects a verified callback to the settings result', async () => {
    const installations = {
      completeSetup: jest.fn(async () => ({ accountLogin: 'acme' })),
    };
    const controller = new GitHubSetupController(
      installations as never,
      {} as never,
      {} as never,
    );
    const response = { redirect: jest.fn((url: string) => url) };
    await controller.callback('state', '42', 'install', response as never);
    expect(installations.completeSetup).toHaveBeenCalledWith('state', '42');
    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('/settings?github=installed&account=acme'));
  });

  it('does not bind a pending organization-owner request', async () => {
    const installations = { completeSetup: jest.fn() };
    const controller = new GitHubSetupController(
      installations as never,
      {} as never,
      {} as never,
    );
    const response = { redirect: jest.fn((url: string) => url) };
    await controller.callback('state', '', 'request', response as never);
    expect(installations.completeSetup).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('github=installation_requested'));
  });
});
