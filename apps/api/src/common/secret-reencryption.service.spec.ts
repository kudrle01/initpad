import { config } from '../config';
import { decryptSecret, encryptSecret } from './secret';
import { SecretReencryptionService } from './secret-reencryption.service';

const PREFIX = 'enc:v1:';

// In-memory stand-in for one Prisma delegate with the filters the service
// uses: id ranges, a "not encrypted yet" filter and compare-and-set updates.
function table(column: string, rows: Record<string, unknown>[]) {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) => {
      const value = row[key];
      if (condition && typeof condition === 'object') {
        const gt = (condition as { gt?: string }).gt;
        if (gt !== undefined) return typeof value === 'string' && value > gt;
        const prefix = (condition as { not?: { startsWith?: string } }).not?.startsWith;
        return typeof value === 'string' && !value.startsWith(prefix ?? '');
      }
      return value === condition;
    });
  return {
    rows,
    findMany: jest.fn(async (args: { where: Record<string, unknown>; take: number }) =>
      rows
        .filter((row) => matches(row, args.where))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .slice(0, args.take)
        .map((row) => ({ id: row.id, [column]: row[column] })),
    ),
    updateMany: jest.fn(
      async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hits = rows.filter((row) => matches(row, args.where));
        for (const row of hits) Object.assign(row, args.data);
        return { count: hits.length };
      },
    ),
  };
}

function harness(rows: { users?: Record<string, unknown>[]; targets?: Record<string, unknown>[] }) {
  const prisma = {
    user: table('accessToken', rows.users ?? []),
    externalIdentity: table('accessTokenEncrypted', []),
    emailOutbox: table('payloadEncrypted', []),
    target: table('secret', rows.targets ?? []),
    appConfigVar: table('value', []),
  };
  return { prisma, service: new SecretReencryptionService(prisma as never) };
}

describe('SecretReencryptionService (ADR-141)', () => {
  const original = {
    key: config.security.encryptionKey,
    previous: config.security.previousEncryptionKeys,
  };
  afterEach(() => {
    config.security.encryptionKey = original.key;
    config.security.previousEncryptionKeys = original.previous;
  });

  it('encrypts legacy plaintext credentials on start', async () => {
    const { prisma, service } = harness({
      users: [
        { id: 'u1', accessToken: 'legacy-gitea-token' },
        { id: 'u2', accessToken: '' },
        { id: 'u3', accessToken: encryptSecret('current-token') },
      ],
    });

    await expect(service.reencryptStoredSecrets()).resolves.toEqual({
      reencrypted: 1,
      unreadable: 0,
    });

    const [legacy, empty] = prisma.user.rows;
    expect(String(legacy.accessToken).startsWith(PREFIX)).toBe(true);
    expect(decryptSecret(String(legacy.accessToken))).toBe('legacy-gitea-token');
    expect(empty.accessToken).toBe('');
  });

  it('moves every value off the previous key and reports unreadable ones', async () => {
    config.security.encryptionKey = 'old-key-0123456789abcdef0123456789';
    const oldValues = Array.from({ length: 150 }, (_, index) => ({
      id: `t${String(index).padStart(3, '0')}`,
      secret: encryptSecret(`password-${index}`),
    }));
    config.security.encryptionKey = 'lost-key-0123456789abcdef012345678';
    const lost = { id: 't999', secret: encryptSecret('unrecoverable') };
    config.security.encryptionKey = 'new-key-0123456789abcdef0123456789';
    config.security.previousEncryptionKeys = ['old-key-0123456789abcdef0123456789'];
    const { prisma, service } = harness({ targets: [...oldValues, lost] });

    await expect(service.reencryptStoredSecrets()).resolves.toEqual({
      reencrypted: 150,
      unreadable: 1,
    });

    config.security.previousEncryptionKeys = [];
    expect(decryptSecret(String(prisma.target.rows[149].secret))).toBe('password-149');
    expect(prisma.target.rows.at(-1)?.secret).toBe(lost.secret);
  });

  it('does not overwrite a value that changed while it was being re-encrypted', async () => {
    const { prisma, service } = harness({ users: [{ id: 'u1', accessToken: 'legacy' }] });
    prisma.user.updateMany.mockImplementationOnce(async () => {
      prisma.user.rows[0].accessToken = encryptSecret('issued-meanwhile');
      return { count: 0 };
    });

    await service.reencryptStoredSecrets();

    expect(decryptSecret(String(prisma.user.rows[0].accessToken))).toBe('issued-meanwhile');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', accessToken: 'legacy' },
      data: { accessToken: expect.stringMatching(/^enc:v1:/) },
    });
  });
});
