import { config } from '../../config';
import { GitHubAuthController } from './github-auth.controller';

describe('GitHubAuthController setup verification', () => {
  const savedFrontendUrl = config.auth.frontendUrl;

  afterEach(() => {
    config.auth.frontendUrl = savedFrontendUrl;
  });

  it('uses the transient user token to finish an organization setup', async () => {
    config.auth.frontendUrl = 'https://initpad.example';
    const oauth = {
      isConfigured: jest.fn(() => true),
      verifyState: jest.fn(() => ({
        mode: 'setup',
        nonce: 'setup-nonce',
        setupState: 'pending-state',
        installationId: '42',
      })),
      exchangeCode: jest.fn(async () => ({
        accessToken: 'ghu_transient',
        user: {
          providerUserId: '123', login: 'alice', name: null, email: null,
          emailVerified: false, avatarUrl: null,
        },
      })),
    };
    const installations = {
      completeSetup: jest.fn(async () => ({ accountLogin: 'acme' })),
    };
    const controller = new GitHubAuthController(
      oauth as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      installations as never,
    );
    const request = { cookies: { initpad_gh_oauth: 'setup-nonce' } };
    const response = {
      clearCookie: jest.fn(),
      redirect: jest.fn((url: string) => url),
    };

    await controller.callback('oauth-code', 'signed-state', request as never, response as never);

    expect(installations.completeSetup).toHaveBeenCalledWith(
      'pending-state',
      '42',
      'ghu_transient',
    );
    expect(response.redirect).toHaveBeenCalledWith(
      'https://initpad.example/settings?github=installed&account=acme',
    );
  });

  it('does not exchange a setup code when the browser nonce is missing', async () => {
    const oauth = {
      isConfigured: jest.fn(() => true),
      verifyState: jest.fn(() => ({
        mode: 'setup',
        nonce: 'setup-nonce',
        setupState: 'pending-state',
        installationId: '42',
      })),
      exchangeCode: jest.fn(),
    };
    const controller = new GitHubAuthController(
      oauth as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const response = {
      clearCookie: jest.fn(),
      redirect: jest.fn((url: string) => url),
    };

    await controller.callback('oauth-code', 'signed-state', { cookies: {} } as never, response as never);

    expect(oauth.exchangeCode).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('installation_error'));
  });
});
