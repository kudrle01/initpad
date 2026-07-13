import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { verifyPassword } from '../auth/password';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'u2', username: 'newuser', name: null, email: 'new@example.test',
    platformRole: 'user', active: true, mustChangePassword: false,
    emailVerifiedAt: null, createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('AdminService', () => {
  it('creates a user with a one-time forced-change password', async () => {
    let provisionInput: Record<string, unknown> | undefined;
    const auth = {
      provisionManagedUser: jest.fn(async (input: Record<string, unknown>) => {
        provisionInput = input;
        return row({ mustChangePassword: true, username: input.username as string });
      }),
    };
    const service = new AdminService({} as never, auth as never, {} as never);
    const result = await service.createUser({ username: 'alice', email: 'a@example.test' });
    expect(provisionInput?.mustChangePassword).toBe(true);
    expect(provisionInput?.platformRole).toBe('user');
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(result.user.mustChangePassword).toBe(true);
  });

  it('refuses to deactivate your own account', async () => {
    const service = new AdminService({} as never, {} as never, {} as never);
    await expect(service.setActive('u1', 'u1', false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to deactivate the last active administrator', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => row({ id: 'admin1', platformRole: 'admin', active: true })),
        count: jest.fn(async () => 0),
      },
    };
    const service = new AdminService(prisma as never, {} as never, {} as never);
    await expect(service.setActive('someoneElse', 'admin1', false)).rejects.toThrow('administrator');
  });

  it('deactivates through Gitea and revokes sessions', async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findUnique: jest.fn(async () => row({ id: 'u2', username: 'bob', active: true })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateArgs = data;
          return row({ id: 'u2', username: 'bob', active: false });
        }),
      },
    };
    const gitea = { setUserActive: jest.fn(async () => undefined) };
    const service = new AdminService(prisma as never, {} as never, gitea as never);
    const result = await service.setActive('admin1', 'u2', false);
    expect(gitea.setUserActive).toHaveBeenCalledWith('bob', false);
    expect(updateArgs).toMatchObject({ active: false, tokenVersion: { increment: 1 } });
    expect(result.active).toBe(false);
  });

  it('resets a password to a fresh one-time secret and revokes sessions', async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findUnique: jest.fn(async () => row({ id: 'u2' })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateArgs = data;
          return row();
        }),
      },
    };
    const service = new AdminService(prisma as never, {} as never, {} as never);
    const { temporaryPassword } = await service.resetPassword('u2');
    expect(updateArgs?.mustChangePassword).toBe(true);
    expect(updateArgs?.tokenVersion).toEqual({ increment: 1 });
    // The stored hash must verify against the returned one-time secret.
    expect(verifyPassword(temporaryPassword, updateArgs?.passwordHash as string)).toBe(true);
  });
});
