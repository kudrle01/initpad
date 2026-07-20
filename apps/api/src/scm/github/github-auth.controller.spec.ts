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
        token: {
          accessToken: 'ghu_transient', accessTokenExpiresAt: null,
          refreshToken: null, refreshTokenExpiresAt: null,
        },
        user: {
          providerUserId: '123', login: 'alice', name: null, email: null,
          emailVerified: false, avatarUrl: null,
        },
      })),
    };
    const installations = {
      completeSetup: jest.fn(async () => ({ accountLogin: 'acme' })),
    };
    const credentials = { storeExchange: jest.fn() };
    const controller = new GitHubAuthController(
      oauth as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      installations as never,
      credentials as never,
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
    expect(credentials.storeExchange).not.toHaveBeenCalled();
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

  it('stores a user credential after linking the immutable GitHub identity', async () => {
    config.auth.frontendUrl = 'https://initpad.example';
    const exchange = {
      token: {
        accessToken: 'ghu_user', accessTokenExpiresAt: null,
        refreshToken: null, refreshTokenExpiresAt: null,
      },
      user: {
        providerUserId: '123', login: 'alice', name: null, email: null,
        emailVerified: false, avatarUrl: null,
      },
    };
    const oauth = {
      isConfigured: jest.fn(() => true),
      verifyState: jest.fn(() => ({ mode: 'link', nonce: 'link-nonce' })),
      exchangeCode: jest.fn(async () => exchange),
    };
    const identities = { link: jest.fn(async () => undefined) };
    const credentials = { storeExchange: jest.fn(async () => undefined) };
    const controller = new GitHubAuthController(
      oauth as never,
      identities as never,
      {} as never,
      { verify: jest.fn(() => ({ sub: 'user-1', ver: 0 })) } as never,
      { user: { findUnique: jest.fn(async () => ({ id: 'user-1', active: true, tokenVersion: 0 })) } } as never,
      {} as never,
      credentials as never,
    );
    const request = {
      cookies: { initpad_gh_oauth: 'link-nonce', initpad_token: 'session' },
    };
    const response = {
      clearCookie: jest.fn(),
      redirect: jest.fn((url: string) => url),
    };

    await controller.callback('oauth-code', 'signed-state', request as never, response as never);

    expect(identities.link).toHaveBeenCalledWith('user-1', 'github', '123', 'alice');
    expect(credentials.storeExchange).toHaveBeenCalledWith('user-1', exchange);
    expect(response.redirect).toHaveBeenCalledWith(
      'https://initpad.example/settings?github=linked',
    );
  });
});
