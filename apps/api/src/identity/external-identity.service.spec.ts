import { BadRequestException, ConflictException } from '@nestjs/common';
import { config } from '../config';
import { ExternalIdentityService } from './external-identity.service';

describe('ExternalIdentityService', () => {
  const originalEdition = config.edition;

  afterEach(() => {
    config.edition = originalEdition;
  });

  it('resolves a user only by the immutable provider id', async () => {
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(async () => ({ user: { id: 'u1', username: 'dev' } })),
      },
    };
    const service = new ExternalIdentityService(prisma as never);
    const user = await service.findUser('github', '12345');
    expect(user).toEqual({ id: 'u1', username: 'dev' });
    expect(prisma.externalIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider_providerUserId: { provider: 'github', providerUserId: '12345' } } }),
    );
  });

  it('returns null when the external account has never been linked', async () => {
    const prisma = { externalIdentity: { findUnique: jest.fn(async () => null) } };
    const service = new ExternalIdentityService(prisma as never);
    expect(await service.findUser('github', 'nope')).toBeNull();
  });

  it('links a new account by immutable id', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { createData = data; return data; }),
      },
    };
    const service = new ExternalIdentityService(prisma as never);
    await service.link('u1', 'github', '999', 'octocat');
    expect(createData).toEqual({ userId: 'u1', provider: 'github', providerUserId: '999', username: 'octocat' });
  });

  it('is idempotent when the same user re-links the same account', async () => {
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(async () => ({ id: 'e1', userId: 'u1' })),
        update: jest.fn(async () => ({ id: 'e1' })),
        create: jest.fn(),
      },
    };
    const service = new ExternalIdentityService(prisma as never);
    await service.link('u1', 'github', '999', 'octocat-renamed');
    expect(prisma.externalIdentity.update).toHaveBeenCalled();
    expect(prisma.externalIdentity.create).not.toHaveBeenCalled();
  });

  it('refuses to steal an account already linked to another user', async () => {
    const prisma = {
      externalIdentity: { findUnique: jest.fn(async () => ({ id: 'e1', userId: 'someone-else' })) },
    };
    const service = new ExternalIdentityService(prisma as never);
    await expect(service.link('u1', 'github', '999', 'octocat')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a second identity for the same provider on one user', async () => {
    const prisma = {
      externalIdentity: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null) // no existing link for this provider account
          .mockResolvedValueOnce({ id: 'e0', userId: 'u1' }), // user already has one
        create: jest.fn(),
      },
    };
    const service = new ExternalIdentityService(prisma as never);
    await expect(service.link('u1', 'github', '999', 'octocat')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.externalIdentity.create).not.toHaveBeenCalled();
  });

  it('refuses to unlink the only sign-in method of an OAuth-only account', async () => {
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(async () => ({ id: 'e1', userId: 'u1' })),
        count: jest.fn(async () => 1),
        deleteMany: jest.fn(),
      },
      user: { findUnique: jest.fn(async () => ({ passwordHash: null })) },
    };
    const service = new ExternalIdentityService(prisma as never);
    await expect(service.unlink('u1', 'github')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.externalIdentity.deleteMany).not.toHaveBeenCalled();
  });

  it('allows unlinking when a local password remains available', async () => {
    config.edition = 'self-hosted';
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(async () => ({ id: 'e1', userId: 'u1' })),
        count: jest.fn(async () => 1),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      user: { findUnique: jest.fn(async () => ({ passwordHash: 'hash' })) },
    };
    const service = new ExternalIdentityService(prisma as never);
    await expect(service.unlink('u1', 'github')).resolves.toBeUndefined();
    expect(prisma.externalIdentity.deleteMany).toHaveBeenCalled();
  });

  it('does not treat a stored password as a usable SaaS sign-in method', async () => {
    config.edition = 'saas';
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(async () => ({ id: 'e1', userId: 'u1' })),
        count: jest.fn(async () => 1),
        deleteMany: jest.fn(),
      },
      user: { findUnique: jest.fn(async () => ({ passwordHash: 'legacy-hash' })) },
    };
    const service = new ExternalIdentityService(prisma as never);
    await expect(service.unlink('u1', 'github')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.externalIdentity.deleteMany).not.toHaveBeenCalled();
  });
});
