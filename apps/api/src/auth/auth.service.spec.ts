import { ForbiddenException } from '@nestjs/common';
import { config } from '../config';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

describe('AuthService', () => {
  const originalMode = config.auth.registrationMode;

  afterEach(() => {
    config.auth.registrationMode = originalMode;
  });

  it('serializes bootstrap registration so only one account is created', async () => {
    config.auth.registrationMode = 'admin-provisioned';
    const users: Array<Record<string, unknown>> = [];
    const prisma = {
      user: {
        count: jest.fn(async () => users.length),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const user = { id: `u${users.length + 1}`, name: null, avatarUrl: null, ...data };
          users.push(user);
          return user;
        }),
      },
    };
    const gitea = {
      createUser: jest.fn(async ({ username }: { username: string }) => ({ id: 1, login: username })),
      createUserToken: jest.fn(async () => 'a'.repeat(40)),
      deleteUser: jest.fn(),
    };
    const jwt = { sign: jest.fn(() => 'jwt') };
    const service = new AuthService(prisma as never, jwt as never, gitea as never);

    const result = await Promise.allSettled([
      service.register({ username: 'first-user', email: 'first@example.test', password: 'long-password-1' }),
      service.register({ username: 'second-user', email: 'second@example.test', password: 'long-password-2' }),
    ]);

    expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ForbiddenException);
    expect(gitea.createUser).toHaveBeenCalledTimes(1);
  });

  it('keeps self-service registration open in the open policy', async () => {
    config.auth.registrationMode = 'open';
    const prisma = { user: { count: jest.fn(async () => 5) } };
    const service = new AuthService(prisma as never, {} as never, {} as never);
    expect(await service.registrationAvailable()).toBe(true);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('only allows the bootstrap admin under a non-open policy', async () => {
    config.auth.registrationMode = 'admin-provisioned';
    let count = 0;
    const prisma = { user: { count: jest.fn(async () => count) } };
    const service = new AuthService(prisma as never, {} as never, {} as never);
    expect(await service.registrationAvailable()).toBe(true); // empty instance bootstraps
    count = 1;
    expect(await service.registrationAvailable()).toBe(false); // then closed to self-service
  });

  it('normalizes an e-mail address during sign-in', async () => {
    const user = {
      id: 'u1', username: 'alice', email: 'alice@example.test', name: null, avatarUrl: null,
      passwordHash: hashPassword('long-password'), accessToken: '', platformRole: 'user',
      active: true, tokenVersion: 0, mustChangePassword: false,
    };
    const prisma = { user: { findFirst: jest.fn(async () => user) } };
    const service = new AuthService(prisma as never, { sign: () => 'jwt' } as never, {} as never);
    await service.login({ username: 'ALICE@EXAMPLE.TEST', password: 'long-password' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ username: 'ALICE@EXAMPLE.TEST' }, { email: 'alice@example.test' }] },
    });
  });

  it('refuses sign-in for a deactivated account', async () => {
    const user = {
      id: 'u1', username: 'bob', email: 'bob@example.test', name: null, avatarUrl: null,
      passwordHash: hashPassword('long-password'), accessToken: '', platformRole: 'user',
      active: false, tokenVersion: 0, mustChangePassword: false,
    };
    const prisma = { user: { findFirst: jest.fn(async () => user) } };
    const service = new AuthService(prisma as never, { sign: () => 'jwt' } as never, {} as never);
    await expect(service.login({ username: 'bob', password: 'long-password' }))
      .rejects.toThrow('deactivated');
  });

  it('clears the forced-change flag and bumps the session generation on change', async () => {
    const stored = {
      id: 'u1', username: 'carol', email: null, name: null, avatarUrl: null,
      passwordHash: hashPassword('old-password-1'), accessToken: '', platformRole: 'user',
      active: true, tokenVersion: 2, mustChangePassword: true,
    };
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findUnique: jest.fn(async () => stored),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateArgs = data;
          return { ...stored, ...data, tokenVersion: 3, mustChangePassword: false };
        }),
      },
    };
    const service = new AuthService(prisma as never, { sign: (p: unknown) => JSON.stringify(p) } as never, {} as never);
    const result = await service.changePassword('u1', 'old-password-1', 'brand-new-password-9');
    expect(updateArgs?.mustChangePassword).toBe(false);
    expect(updateArgs?.tokenVersion).toEqual({ increment: 1 });
    expect(result.user.mustChangePassword).toBe(false);
    expect(result.token).toContain('"ver":3');
  });

  it('rejects a password change with the wrong current password', async () => {
    const stored = {
      id: 'u1', passwordHash: hashPassword('old-password-1'), active: true, tokenVersion: 0,
    };
    const prisma = { user: { findUnique: jest.fn(async () => stored), update: jest.fn() } };
    const service = new AuthService(prisma as never, { sign: () => 'jwt' } as never, {} as never);
    await expect(service.changePassword('u1', 'wrong-password', 'brand-new-password-9'))
      .rejects.toThrow('incorrect');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
