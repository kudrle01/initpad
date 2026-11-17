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
      {} as never,
      {} as never,
    );

    const startResponse = { cookie: jest.fn() };
    await expect(
      controller.start('user-1', startResponse as never, 'workspace-1'),
    ).resolves.toEqual({
      installUrl: 'https://github.example/apps/initpad-cloud/installations/new?state=opaque-state',
    });
    expect(startResponse.cookie).toHaveBeenCalledWith(
      'initpad_gh_setup',
      'opaque-state',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/scm/github/setup' }),
    );
    expect(workspaces.require).toHaveBeenCalledWith('user-1', 'workspace-1', 'admin');
    expect(installations.createSetup).toHaveBeenCalledWith('user-1', 'workspace-1');
  });

  it('redirects a verified callback to the settings result', async () => {
    const installations = {
      inspectSetup: jest.fn(async () => ({ accountType: 'User' })),
      completeSetup: jest.fn(async () => ({ accountLogin: 'acme' })),
    };
    const controller = new GitHubSetupController(
      installations as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = { redirect: jest.fn((url: string) => url), clearCookie: jest.fn() };
    await controller.callback(
      'state',
      '42',
      'install',
      { cookies: {} } as never,
      response as never,
    );
    expect(installations.completeSetup).toHaveBeenCalledWith('state', '42');
    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining('/settings/workspace?github=installed&account=acme'),
    );
  });

  it('takes the setup state from its cookie when GitHub returns from an update without it', async () => {
    const installations = {
      inspectSetup: jest.fn(async () => ({ accountType: 'User' })),
      completeSetup: jest.fn(async () => ({ accountLogin: 'acme' })),
    };
    const controller = new GitHubSetupController(
      installations as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = { redirect: jest.fn((url: string) => url), clearCookie: jest.fn() };

    await controller.callback(
      undefined as never,
      '42',
      'update',
      { cookies: { initpad_gh_setup: 'cookie-state' } } as never,
      response as never,
    );

    expect(installations.completeSetup).toHaveBeenCalledWith('cookie-state', '42');
    expect(response.clearCookie).toHaveBeenCalledWith('initpad_gh_setup', {
      path: '/api/scm/github/setup',
    });
  });

  it('recovers an already-installed personal App for the current workspace', async () => {
    config.github.appSlug = 'initpad-cloud';
    const installations = {
      recoverPersonalSetup: jest.fn(async () => ({ accountLogin: 'kudrle01' })),
      recoverRequestedOrganizationSetup: jest.fn(),
    };
    const app = { isConfigured: jest.fn(() => true) };
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })),
      require: jest.fn(async () => 'owner'),
    };
    const controller = new GitHubSetupController(
      installations as never,
      app as never,
      workspaces as never,
      {} as never,
      {} as never,
    );

    await expect(controller.recover('user-1', 'workspace-1')).resolves.toEqual({
      recovered: true,
      accountLogin: 'kudrle01',
    });
    expect(workspaces.require).toHaveBeenCalledWith('user-1', 'workspace-1', 'admin');
    expect(installations.recoverPersonalSetup).toHaveBeenCalledWith('user-1', 'workspace-1');
    expect(installations.recoverRequestedOrganizationSetup).not.toHaveBeenCalled();
  });

  it('claims an approved organization request with the user-bound GitHub token', async () => {
    config.github.appSlug = 'initpad-cloud';
    const installations = {
      recoverPersonalSetup: jest.fn(async () => null),
      recoverRequestedOrganizationSetup: jest.fn(
        async (_userId: string, _workspaceId: string, token: () => Promise<string>) => {
          await expect(token()).resolves.toBe('user-token');
          return { accountLogin: 'acme' };
        },
      ),
    };
    const app = { isConfigured: jest.fn(() => true) };
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })),
      require: jest.fn(async () => 'owner'),
    };
    const credentials = { accessTokenForUser: jest.fn(async () => 'user-token') };
    const controller = new GitHubSetupController(
      installations as never,
      app as never,
      workspaces as never,
      {} as never,
      credentials as never,
    );

    await expect(controller.recover('user-1', 'workspace-1')).resolves.toEqual({
      recovered: true,
      accountLogin: 'acme',
    });
    expect(credentials.accessTokenForUser).toHaveBeenCalledWith('user-1');
  });

  it('does not bind a pending organization-owner request', async () => {
    const installations = {
      completeSetup: jest.fn(),
      markRequested: jest.fn(async () => undefined),
    };
    const controller = new GitHubSetupController(
      installations as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = { redirect: jest.fn((url: string) => url), clearCookie: jest.fn() };
    await controller.callback('state', '', 'request', { cookies: {} } as never, response as never);
    expect(installations.markRequested).toHaveBeenCalledWith('state');
    expect(installations.completeSetup).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining('github=installation_requested'),
    );
  });

  it('continues an organization callback through user-bound OAuth verification', async () => {
    const installations = {
      inspectSetup: jest.fn(async () => ({ accountType: 'Organization' })),
      completeSetup: jest.fn(),
    };
    const oauth = {
      authorizeSetupUrl: jest.fn(() => ({
        url: 'https://github.example/login/oauth/authorize?state=signed',
        nonce: 'long-random-nonce',
      })),
    };
    const controller = new GitHubSetupController(
      installations as never,
      {} as never,
      {} as never,
      oauth as never,
      {} as never,
    );
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn((url: string) => url),
    };

    await controller.callback(
      'setup-state',
      '42',
      'install',
      { cookies: {} } as never,
      response as never,
    );
    expect(oauth.authorizeSetupUrl).toHaveBeenCalledWith('setup-state', '42');
    expect(response.cookie).toHaveBeenCalledWith(
      'initpad_gh_oauth',
      'long-random-nonce',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('github.example'));
    expect(installations.completeSetup).not.toHaveBeenCalled();
  });
});
