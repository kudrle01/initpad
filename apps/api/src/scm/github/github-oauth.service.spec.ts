import { createHmac } from 'crypto';
import { config } from '../../config';
import { GitHubOAuthService } from './github-oauth.service';

function oauthStateStore() {
  const rows = new Map<string, { expiresAt: Date; usedAt: Date | null }>();
  const externalOAuthState = {
    deleteMany: jest.fn(async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
      let count = 0;
      for (const [key, row] of rows) {
        if (row.expiresAt < where.expiresAt.lt) {
          rows.delete(key);
          count += 1;
        }
      }
      return { count };
    }),
    create: jest.fn(
      async ({ data }: { data: { tokenHash: string; expiresAt: Date; provider: string } }) => {
        rows.set(data.tokenHash, { expiresAt: data.expiresAt, usedAt: null });
        return data;
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: {
          tokenHash: string;
          provider: string;
          usedAt: null;
          expiresAt: { gt: Date };
        };
        data: { usedAt: Date };
      }) => {
        const row = rows.get(where.tokenHash);
        if (!row || row.usedAt || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        row.usedAt = data.usedAt;
        return { count: 1 };
      },
    ),
  };
  return { prisma: { externalOAuthState }, rows };
}

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
    expect(new GitHubOAuthService(oauthStateStore().prisma as never).isConfigured()).toBe(false);
  });

  it('builds an authorize URL and consumes its state once across replicas', async () => {
    const store = oauthStateStore();
    const service = new GitHubOAuthService(store.prisma as never);
    const { url, state, nonce } = await service.authorizeUrl('link');
    expect(url).toContain('https://github.com/login/oauth/authorize?');
    expect(url).toContain('client_id=client-123');
    expect(url).toContain('redirect_uri=https%3A%2F%2Finitpad.example');
    expect(url).toContain(`state=${encodeURIComponent(state)}`);
    expect(store.rows.has(state)).toBe(false);
    expect([...store.rows.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
    const otherReplica = new GitHubOAuthService(store.prisma as never);
    await expect(otherReplica.verifyState(state, 'wrong-browser-nonce')).resolves.toBeNull();
    const verified = await otherReplica.verifyState(state, nonce);
    expect(verified).toEqual({ mode: 'link', nonce });
    await expect(service.verifyState(state, nonce)).resolves.toBeNull();
  });

  it('binds organization verification OAuth to the pending setup and installation', async () => {
    const service = new GitHubOAuthService(oauthStateStore().prisma as never);
    const { url, state, nonce } = await service.authorizeSetupUrl('pending-setup', '147774798');
    expect(url).toContain('client_id=client-123');
    expect(url).not.toContain('scope=');
    await expect(service.verifyState(state, nonce)).resolves.toEqual({
      mode: 'setup',
      nonce,
      setupState: 'pending-setup',
      installationId: '147774798',
    });
  });

  it('rejects a tampered or expired state', async () => {
    const service = new GitHubOAuthService(oauthStateStore().prisma as never);
    await expect(service.verifyState('garbage', 'browser-nonce')).resolves.toBeNull();
    const { state, nonce } = await service.authorizeUrl('login');
    const [payload] = state.split('.');
    await expect(service.verifyState(`${payload}.deadbeef`, nonce)).resolves.toBeNull();
    // A correctly-signed but stale state must also fail.
    const stale = Buffer.from(
      JSON.stringify({ mode: 'login', nonce: 'n', ts: Date.now() - 11 * 60 * 1000 }),
    ).toString('base64url');
    const sig = createHmac('sha256', config.auth.jwtSecret).update(stale).digest('base64url');
    await expect(service.verifyState(`${stale}.${sig}`, 'n')).resolves.toBeNull();
  });

  it('exchanges a code for the GitHub user identity', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'gho_tok' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 987654,
          login: 'octocat',
          name: 'The Octocat',
          email: 'octo@example.test',
          avatar_url: 'https://x/y.png',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ email: 'octo@example.test', primary: true, verified: true }],
      });
    global.fetch = fetchMock as never;

    const user = await new GitHubOAuthService(
      oauthStateStore().prisma as never,
    ).exchangeCodeForUser('the-code');
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

    await expect(
      new GitHubOAuthService(oauthStateStore().prisma as never).exchangeCode('code'),
    ).resolves.toMatchObject({
      token: {
        accessToken: 'ghu_transient',
        accessTokenExpiresAt: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
      },
      user: { providerUserId: '123', login: 'alice' },
    });
  });

  it('parses and rotates an expiring GitHub App user token pair', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'ghu_new',
        expires_in: 28800,
        refresh_token: 'ghr_new',
        refresh_token_expires_in: 15897600,
      }),
    }));
    global.fetch = fetchMock as never;

    const before = Date.now();
    const token = await new GitHubOAuthService(oauthStateStore().prisma as never).refreshUserToken(
      'ghr_old',
    );
    expect(token.accessToken).toBe('ghu_new');
    expect(token.refreshToken).toBe('ghr_new');
    expect(token.accessTokenExpiresAt?.getTime()).toBeGreaterThanOrEqual(before + 28_800_000);
    expect(token.refreshTokenExpiresAt?.getTime()).toBeGreaterThanOrEqual(before + 15_897_600_000);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('grant_type=refresh_token');
    expect(String(init.body)).toContain('refresh_token=ghr_old');
  });

  it('rejects an incomplete expiring token pair', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'ghu_new', expires_in: 28800 }),
    })) as never;
    await expect(
      new GitHubOAuthService(oauthStateStore().prisma as never).refreshUserToken('ghr_old'),
    ).rejects.toThrow('incomplete');
  });

  it('throws when GitHub returns no access token', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ error: 'bad_verification_code' }),
    })) as never;
    await expect(
      new GitHubOAuthService(oauthStateStore().prisma as never).exchangeCodeForUser('x'),
    ).rejects.toThrow('access token');
  });
});
