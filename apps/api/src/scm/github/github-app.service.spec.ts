import { createVerify, generateKeyPairSync, KeyObject } from 'crypto';
import { config } from '../../config';
import {
  DEFAULT_INSTALLATION_PERMISSIONS,
  GitHubAppService,
  signAppJwt,
} from './github-app.service';

let publicKey: KeyObject;
let privateKeyPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  publicKey = pair.publicKey;
  privateKeyPem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
});

describe('signAppJwt', () => {
  it('produces an RS256 JWT the App public key verifies, within the 10-minute limit', () => {
    const jwt = signAppJwt('12345', privateKeyPem, 1_000_000_000_000);
    const [header, payload, signature] = jwt.split('.');
    const verify = createVerify('RSA-SHA256');
    verify.update(`${header}.${payload}`);
    expect(verify.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iat).toBeLessThan(Math.floor(1_000_000_000_000 / 1000)); // backdated for skew
  });
});

describe('GitHubAppService', () => {
  const savedAppId = config.github.appId;
  const savedKey = config.github.privateKey;
  const savedFetch = global.fetch;

  afterEach(() => {
    config.github.appId = savedAppId;
    config.github.privateKey = savedKey;
    global.fetch = savedFetch;
  });

  it('is inert until an App id and key are configured', () => {
    config.github.appId = '';
    config.github.privateKey = '';
    expect(new GitHubAppService().isConfigured()).toBe(false);
    config.github.appId = '123';
    config.github.privateKey = privateKeyPem;
    expect(new GitHubAppService().isConfigured()).toBe(true);
  });

  it('exchanges the App JWT for a short-lived installation token with least privilege', async () => {
    config.github.appId = '123';
    config.github.privateKey = privateKeyPem;
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'ghs_secret', expires_at: '2026-07-14T10:00:00Z' }),
    }));
    global.fetch = fetchMock as never;

    const result = await new GitHubAppService().createInstallationToken(42);
    expect(result).toEqual({ token: 'ghs_secret', expiresAt: '2026-07-14T10:00:00Z' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/app/installations/42/access_tokens');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    const body = JSON.parse(init.body as string);
    expect(body.permissions).toEqual(DEFAULT_INSTALLATION_PERMISSIONS);
  });

  it('verifies immutable installation identity through the App API', async () => {
    config.github.appId = '123';
    config.github.privateKey = privateKeyPem;
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 42,
        account: { id: 987654, login: 'acme-renamed', type: 'Organization' },
        repository_selection: 'selected',
        suspended_at: null,
      }),
    }));
    global.fetch = fetchMock as never;

    await expect(new GitHubAppService().getInstallation('42')).resolves.toEqual({
      installationId: '42',
      accountId: '987654',
      accountLogin: 'acme-renamed',
      accountType: 'Organization',
      repositorySelection: 'selected',
      suspendedAt: null,
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/app/installations/42');
  });

  it('rejects an incomplete installation identity from GitHub', async () => {
    config.github.appId = '123';
    config.github.privateKey = privateKeyPem;
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: 42, account: { login: 'missing-id', type: 'User' } }),
    })) as never;
    await expect(new GitHubAppService().getInstallation('42')).rejects.toThrow('incomplete');
  });

  it('scopes the token to the requested repositories and permissions', async () => {
    config.github.appId = '123';
    config.github.privateKey = privateKeyPem;
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ token: 't', expires_at: 'x' }) }));
    global.fetch = fetchMock as never;

    await new GitHubAppService().createInstallationToken(7, {
      permissions: { contents: 'read' },
      repositoryIds: [111, 222],
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.permissions).toEqual({ contents: 'read' });
    expect(body.repository_ids).toEqual([111, 222]);
  });

  it('throws when GitHub rejects the token request', async () => {
    config.github.appId = '123';
    config.github.privateKey = privateKeyPem;
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as never;
    await expect(new GitHubAppService().createInstallationToken(1)).rejects.toThrow('HTTP 404');
  });
});
