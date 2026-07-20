import { createHmac } from 'crypto';
import { config } from '../../config';
import { GitHubOAuthService } from './github-oauth.service';

describe('GitHubOAuthService', () => {
  const saved = { ...config.github };
  const savedFetch = global.fetch;

  beforeEach(() => {
    config.github.clientId = 'client-123';
    config.github.clientSecret = 'secret-xyz';
    config.github.callbackUrl = 'https://initpad.example/api/auth/github/callback';
    config.github.oauthBaseUrl = 'https://github.com';
    config.github.apiBaseUrl = 'https://api.github.com';
  });
  afterEach(() => {
    Object.assign(config.github, saved);
    global.fetch = savedFetch;
  });

  it('is inert until client credentials and a callback are set', () => {
    config.github.clientId = '';
    expect(new GitHubOAuthService().isConfigured()).toBe(false);
  });

  it('builds an authorize URL and a state that verifies', () => {
    const service = new GitHubOAuthService();
    const { url, state, nonce } = service.authorizeUrl('link');
    expect(url).toContain('https://github.com/login/oauth/authorize?');
    expect(url).toContain('client_id=client-123');
    expect(url).toContain('redirect_uri=https%3A%2F%2Finitpad.example');
    expect(url).toContain(`state=${encodeURIComponent(state)}`);
    const verified = service.verifyState(state);
    expect(verified).toEqual({ mode: 'link', nonce });
  });

  it('binds organization verification OAuth to the pending setup and installation', () => {
    const service = new GitHubOAuthService();
    const { url, state, nonce } = service.authorizeSetupUrl('pending-setup', '147774798');
    expect(url).toContain('client_id=client-123');
    expect(url).not.toContain('scope=');
    expect(service.verifyState(state)).toEqual({
      mode: 'setup',
      nonce,
      setupState: 'pending-setup',
      installationId: '147774798',
    });
  });

  it('rejects a tampered or expired state', () => {
    const service = new GitHubOAuthService();
    expect(service.verifyState('garbage')).toBeNull();
    const { state } = service.authorizeUrl('login');
    const [payload] = state.split('.');
    expect(service.verifyState(`${payload}.deadbeef`)).toBeNull(); // wrong signature
    // A correctly-signed but stale state must also fail.
    const stale = Buffer.from(JSON.stringify({ mode: 'login', nonce: 'n', ts: Date.now() - 11 * 60 * 1000 })).toString('base64url');
    const sig = createHmac('sha256', config.auth.jwtSecret).update(stale).digest('base64url');
    expect(service.verifyState(`${stale}.${sig}`)).toBeNull();
  });

  it('exchanges a code for the GitHub user identity', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'gho_tok' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 987654, login: 'octocat', name: 'The Octocat', email: 'octo@example.test', avatar_url: 'https://x/y.png' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ email: 'octo@example.test', primary: true, verified: true }]),
      });
    global.fetch = fetchMock as never;

    const user = await new GitHubOAuthService().exchangeCodeForUser('the-code');
    expect(user).toEqual({
      providerUserId: '987654',
      login: 'octocat',
      name: 'The Octocat',
      email: 'octo@example.test',
      emailVerified: true,
      avatarUrl: 'https://x/y.png',
    });
    // Second call must carry the bearer token from the exchange.
    const [, userInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((userInit.headers as Record<string, string>).Authorization).toBe('Bearer gho_tok');
  });

  it('returns a user token only to the immediate exchange caller', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ghu_transient' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 123, login: 'alice', email: null }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(new GitHubOAuthService().exchangeCode('code')).resolves.toMatchObject({
      accessToken: 'ghu_transient',
      user: { providerUserId: '123', login: 'alice' },
    });
  });

  it('throws when GitHub returns no access token', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ error: 'bad_verification_code' }) })) as never;
    await expect(new GitHubOAuthService().exchangeCodeForUser('x')).rejects.toThrow('access token');
  });
});
