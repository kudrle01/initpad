import { ForbiddenException } from '@nestjs/common';
import { config } from '../config';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

describe('AuthService', () => {
  const originalMode = config.auth.registrationMode;

  afterEach(() => {
    config.auth.registrationMode = originalMode;
  });

  it('serializes first-user registration so only one account is created', async () => {
    config.auth.registrationMode = 'first-user';
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

  it('normalizes an e-mail address during sign-in', async () => {
    const user = {
      id: 'u1', username: 'alice', email: 'alice@example.test', name: null, avatarUrl: null,
      passwordHash: hashPassword('long-password'), accessToken: '', platformRole: 'user',
    };
    const prisma = { user: { findFirst: jest.fn(async () => user) } };
    const service = new AuthService(prisma as never, { sign: () => 'jwt' } as never, {} as never);
    await service.login({ username: 'ALICE@EXAMPLE.TEST', password: 'long-password' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ username: 'ALICE@EXAMPLE.TEST' }, { email: 'alice@example.test' }] },
    });
  });
});
