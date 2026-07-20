import { decryptSecret, encryptSecret } from '../../common/secret';
import {
  GitHubReauthorizationRequiredError,
  GitHubUserCredentialService,
} from './github-user-credential.service';

function identity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'identity-1',
    userId: 'user-1',
    provider: 'github',
    providerUserId: '123',
    username: 'alice',
    accessTokenEncrypted: encryptSecret('ghu_old'),
    accessTokenExpiresAt: null,
    refreshTokenEncrypted: null,
    refreshTokenExpiresAt: null,
    credentialVersion: 3,
    credentialRefreshingAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('GitHubUserCredentialService', () => {
  it('stores access and refresh tokens encrypted after immutable identity matching', async () => {
    let captured: {
      where: Record<string, unknown>;
      data: Record<string, any>;
    } | undefined;
    const updateMany = jest.fn(async (input: typeof captured) => {
      captured = input;
      return { count: 1 };
    });
    const service = new GitHubUserCredentialService(
      { externalIdentity: { updateMany } } as never,
      {} as never,
    );
    const accessExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const refreshExpiry = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

    await service.storeExchange('user-1', {
      user: {
        providerUserId: '123', login: 'alice', name: null, email: null,
        emailVerified: false, avatarUrl: null,
      },
      token: {
        accessToken: 'ghu_secret', accessTokenExpiresAt: accessExpiry,
        refreshToken: 'ghr_secret', refreshTokenExpiresAt: refreshExpiry,
      },
    });

    expect(captured).toBeDefined();
    const call = captured!;
    expect(call.where).toMatchObject({
      userId: 'user-1', provider: 'github', providerUserId: '123',
    });
    expect(call.data.accessTokenEncrypted).not.toContain('ghu_secret');
    expect(call.data.refreshTokenEncrypted).not.toContain('ghr_secret');
    expect(decryptSecret(call.data.accessTokenEncrypted)).toBe('ghu_secret');
    expect(decryptSecret(call.data.refreshTokenEncrypted)).toBe('ghr_secret');
    expect(call.data).toMatchObject({
      accessTokenExpiresAt: accessExpiry,
      refreshTokenExpiresAt: refreshExpiry,
      credentialVersion: { increment: 1 },
    });
  });

  it('returns a non-expiring token without touching the refresh endpoint', async () => {
    const oauth = { refreshUserToken: jest.fn() };
    const service = new GitHubUserCredentialService(
      { externalIdentity: { findUnique: jest.fn(async () => identity()) } } as never,
      oauth as never,
    );

    await expect(service.accessTokenForUser('user-1')).resolves.toBe('ghu_old');
    expect(oauth.refreshUserToken).not.toHaveBeenCalled();
  });

  it('claims and atomically rotates an expired token pair', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const updateMany = jest.fn(async (input: Record<string, unknown>) => {
      calls.push(input);
      return { count: 1 };
    });
    const oauth = {
      refreshUserToken: jest.fn(async () => ({
        accessToken: 'ghu_new',
        accessTokenExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        refreshToken: 'ghr_new',
        refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      })),
    };
    const service = new GitHubUserCredentialService(
      {
        externalIdentity: {
          findUnique: jest.fn(async () => identity({
            accessTokenExpiresAt: new Date(Date.now() - 1_000),
            refreshTokenEncrypted: encryptSecret('ghr_old'),
            refreshTokenExpiresAt: new Date(Date.now() + 60_000),
          })),
          updateMany,
        },
      } as never,
      oauth as never,
    );

    await expect(service.accessTokenForUser('user-1')).resolves.toBe('ghu_new');
    expect(oauth.refreshUserToken).toHaveBeenCalledWith('ghr_old');
    expect(calls).toHaveLength(2);
    const stored = calls[1].data as Record<string, unknown>;
    expect(decryptSecret(stored.accessTokenEncrypted as string)).toBe('ghu_new');
    expect(decryptSecret(stored.refreshTokenEncrypted as string)).toBe('ghr_new');
    expect(stored.credentialVersion).toEqual({ increment: 1 });
  });

  it('waits for the lease owner and reuses its newly rotated token', async () => {
    const expired = identity({
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenEncrypted: encryptSecret('ghr_old'),
      refreshTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const fresh = identity({
      accessTokenEncrypted: encryptSecret('ghu_peer'),
      accessTokenExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
      credentialVersion: 4,
    });
    const findUnique = jest.fn()
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(fresh);
    const oauth = { refreshUserToken: jest.fn() };
    const service = new GitHubUserCredentialService(
      {
        externalIdentity: {
          findUnique,
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
      } as never,
      oauth as never,
    );

    await expect(service.accessTokenForUser('user-1')).resolves.toBe('ghu_peer');
    expect(oauth.refreshUserToken).not.toHaveBeenCalled();
  });

  it('clears unusable credentials and requires reauthorization', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const service = new GitHubUserCredentialService(
      {
        externalIdentity: {
          findUnique: jest.fn(async () => identity({
            accessTokenExpiresAt: new Date(Date.now() - 1_000),
          })),
          updateMany,
        },
      } as never,
      {} as never,
    );

    await expect(service.accessTokenForUser('user-1'))
      .rejects.toBeInstanceOf(GitHubReauthorizationRequiredError);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        credentialVersion: { increment: 1 },
      }),
    }));
  });

  it('clears credentials by immutable provider user id on revocation', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const service = new GitHubUserCredentialService(
      { externalIdentity: { updateMany } } as never,
      {} as never,
    );

    await service.revokeByProviderUserId('987654');
    expect(updateMany).toHaveBeenCalledWith({
      where: { provider: 'github', providerUserId: '987654' },
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        refreshTokenEncrypted: null,
        refreshTokenExpiresAt: null,
        credentialVersion: { increment: 1 },
        credentialRefreshingAt: null,
      },
    });
  });
});
