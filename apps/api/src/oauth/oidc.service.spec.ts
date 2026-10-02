import { config } from '../config';
import { OidcService } from './oidc.service';

function grantStore() {
  const rows = new Map<string, Record<string, unknown>>();
  const oidcGrant = {
    deleteMany: jest.fn(async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
      let count = 0;
      for (const [key, row] of rows) {
        if ((row.expiresAt as Date) < where.expiresAt.lt) {
          rows.delete(key);
          count += 1;
        }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      rows.set(data.tokenHash as string, { ...data });
      return data;
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { tokenHash: string; kind: string; usedAt: null; expiresAt: { gt: Date } };
        data: Record<string, unknown>;
      }) => {
        const row = rows.get(where.tokenHash as string);
        if (
          !row ||
          row.kind !== where.kind ||
          row.usedAt != null ||
          (row.expiresAt as Date) <= where.expiresAt.gt
        )
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    ),
    findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
      return rows.get(where.tokenHash) ?? null;
    }),
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: { tokenHash: string; kind: string; usedAt: null; expiresAt: { gt: Date } };
      }) => {
        const row = rows.get(where.tokenHash as string);
        if (
          !row ||
          row.kind !== where.kind ||
          row.usedAt != null ||
          (row.expiresAt as Date) <= where.expiresAt.gt
        )
          return null;
        return { userId: row.userId, tokenVersion: row.tokenVersion };
      },
    ),
  };
  return { prisma: { oidcGrant }, rows };
}

describe('OidcService redirect validation', () => {
  const originalUrl = config.gitea.url;
  let service: OidcService;
  const store = grantStore();

  beforeAll(() => {
    config.gitea.url = 'https://git.example.test';
    service = new OidcService(store.prisma as never);
  });

  afterAll(() => {
    config.gitea.url = originalUrl;
  });

  it('accepts only a Gitea OAuth callback on the exact origin', () => {
    expect(service.isAllowedRedirect('https://git.example.test/user/oauth2/initpad/callback')).toBe(
      true,
    );
    expect(
      service.isAllowedRedirect('https://git.example.test.evil.test/user/oauth2/initpad/callback'),
    ).toBe(false);
    expect(service.isAllowedRedirect('https://git.example.test/other/callback')).toBe(false);
    expect(
      service.isAllowedRedirect('https://user@git.example.test/user/oauth2/initpad/callback'),
    ).toBe(false);
  });

  it('persists only a hash and consumes an authorization code once across replicas', async () => {
    const code = await service.issueCode({
      userId: 'u1',
      tokenVersion: 0,
      clientId: 'gitea',
      redirectUri: 'https://git.example.test/user/oauth2/initpad/callback',
    });
    expect(store.rows.has(code)).toBe(false);
    expect([...store.rows.keys()][0]).toMatch(/^[a-f0-9]{64}$/);

    const otherReplica = new OidcService(store.prisma as never);
    expect((await otherReplica.consumeCode(code))?.userId).toBe('u1');
    expect(await service.consumeCode(code)).toBeNull();
  });

  it('resolves an access token through another service instance', async () => {
    const token = await service.issueAccessToken('u1', 7);
    expect(store.rows.has(token)).toBe(false);

    const otherReplica = new OidcService(store.prisma as never);
    await expect(otherReplica.accessForToken(token)).resolves.toEqual({
      userId: 'u1',
      tokenVersion: 7,
    });
  });
});
