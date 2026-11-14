import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { verifyPassword } from '../auth/password';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'u2',
    username: 'newuser',
    name: null,
    email: 'new@example.test',
    platformRole: 'user',
    active: true,
    mustChangePassword: false,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

describe('AdminService', () => {
  it('updates workspace capacity and records the platform administrator action', async () => {
    const before = {
      workspaceId: 'workspace-1',
      workspaceName: 'Team Alpha',
      limits: {
        projects: 10,
        members: 20,
        targets: 5,
        concurrentOperations: 4,
        artifactBytes: '10737418240',
      },
    };
    const after = {
      ...before,
      limits: { ...before.limits, projects: 25 },
    };
    const capacity = {
      snapshot: jest.fn(async () => before),
      update: jest.fn(async () => after),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new AdminService(
      {} as never,
      {} as never,
      {} as never,
      capacity as never,
      audit,
    );

    await expect(
      service.updateWorkspaceCapacity('admin-1', 'workspace-1', {
        maxProjects: 25,
        maxMembers: 20,
        maxTargets: 5,
        maxConcurrentOperations: 4,
        maxArtifactStorageGiB: 10,
      }),
    ).resolves.toBe(after);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorUserId: 'admin-1',
        action: 'workspace.capacity_updated',
      }),
    );
  });
  it('creates a user with a one-time forced-change password', async () => {
    let provisionInput: Record<string, unknown> | undefined;
    const auth = {
      provisionManagedUser: jest.fn(async (input: Record<string, unknown>) => {
        provisionInput = input;
        return row({ mustChangePassword: true, username: input.username as string });
      }),
      createActivationLink: jest.fn(async () => ({
        delivery: 'manual',
        activationUrl: 'https://frontend/activate#tok',
      })),
    };
    const service = new AdminService({} as never, auth as never, {} as never);
    const result = await service.createUser('admin-1', {
      username: 'alice',
      email: 'a@example.test',
    });
    expect(provisionInput?.mustChangePassword).toBe(true);
    expect(provisionInput?.platformRole).toBe('user');
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(result.user.mustChangePassword).toBe(true);
    expect(result.activationUrl).toContain('/activate#');
  });

  it('refuses to deactivate your own account', async () => {
    const service = new AdminService({} as never, {} as never, {} as never);
    await expect(service.setActive('u1', 'u1', false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to deactivate the last active administrator', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findUnique: jest.fn(async () => row({ id: 'admin1', platformRole: 'admin', active: true })),
        count: jest.fn(async () => 0),
      },
    };
    const service = new AdminService(prisma as never, {} as never, {} as never);
    await expect(service.setActive('someoneElse', 'admin1', false)).rejects.toThrow(
      'administrator',
    );
  });

  it('deactivates through Gitea and revokes sessions', async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findUnique: jest.fn(async () => row({ id: 'u2', username: 'bob', active: true })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateArgs = data;
          return row({ id: 'u2', username: 'bob', active: false });
        }),
      },
      workspaceMember: { findMany: jest.fn(async () => []) },
    };
    const order: string[] = [];
    const gitea = {
      setUserActive: jest.fn(async () => {
        order.push('deactivate');
      }),
    };
    const auth = {
      revokeGitCredential: jest.fn(async () => {
        order.push('revoke');
      }),
    };
    const service = new AdminService(prisma as never, auth as never, gitea as never);
    const result = await service.setActive('admin1', 'u2', false);
    expect(gitea.setUserActive).toHaveBeenCalledWith('bob', false);
    // Gitea refuses token management for an inactive account, and the token
    // would otherwise work again after reactivation.
    expect(auth.revokeGitCredential).toHaveBeenCalledWith('u2');
    expect(order).toEqual(['revoke', 'deactivate']);
    expect(updateArgs).toMatchObject({ active: false, tokenVersion: { increment: 1 } });
    expect(result.active).toBe(false);
  });

  it('reactivates without touching Git credentials', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findUnique: jest.fn(async () => row({ id: 'u2', username: 'bob', active: false })),
        update: jest.fn(async () => row({ id: 'u2', username: 'bob', active: true })),
      },
    };
    const gitea = { setUserActive: jest.fn(async () => undefined) };
    const auth = { revokeGitCredential: jest.fn(async () => undefined) };
    const service = new AdminService(prisma as never, auth as never, gitea as never);
    await service.setActive('admin1', 'u2', true);
    expect(auth.revokeGitCredential).not.toHaveBeenCalled();
  });

  it('resets a password to a fresh one-time secret and revokes sessions', async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findUnique: jest.fn(async () => row({ id: 'u2' })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateArgs = data;
          return row();
        }),
      },
    };
    const auth = { revokeGitCredential: jest.fn(async () => undefined) };
    const service = new AdminService(prisma as never, auth as never, {} as never);
    const { temporaryPassword } = await service.resetPassword('admin-1', 'u2');
    expect(auth.revokeGitCredential).toHaveBeenCalledWith('u2');
    expect(updateArgs?.mustChangePassword).toBe(true);
    expect(updateArgs?.tokenVersion).toEqual({ increment: 1 });
    // The stored hash must verify against the returned one-time secret.
    await expect(
      verifyPassword(temporaryPassword, updateArgs?.passwordHash as string),
    ).resolves.toBe(true);
  });

  it('records an account deactivation in the same transaction as the change', async () => {
    const tx = {
      user: { update: jest.fn(async () => row({ id: 'u2', active: false })) },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
      user: { findUnique: jest.fn(async () => row({ id: 'u2' })), count: jest.fn() },
      workspaceMember: { findMany: jest.fn(async () => []) },
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new AdminService(
      prisma as never,
      { revokeGitCredential: jest.fn(async () => undefined) } as never,
      { setUserActive: jest.fn(async () => undefined) } as never,
      {} as never,
      audit,
    );

    await service.setActive('admin-1', 'u2', false);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: null,
        actorUserId: 'admin-1',
        action: 'user.deactivated',
        resourceId: 'u2',
        resourceName: 'newuser',
      }),
      tx,
    );
  });

  it('keeps the password when the Git token cannot be revoked', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findUnique: jest.fn(async () => row({ id: 'u2' })),
        update: jest.fn(),
      },
    };
    const auth = {
      revokeGitCredential: jest.fn(async () => {
        throw new Error('Gitea unavailable');
      }),
    };
    const service = new AdminService(prisma as never, auth as never, {} as never);
    await expect(service.resetPassword('admin-1', 'u2')).rejects.toThrow('Gitea unavailable');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses to deactivate the owner of a team workspace and names it', async () => {
    const gitea = { setUserActive: jest.fn() };
    const auth = { revokeGitCredential: jest.fn() };
    const prisma = {
      user: { findUnique: jest.fn(async () => row({ id: 'u2', username: 'bob' })) },
      workspaceMember: {
        findMany: jest.fn(async () => [{ workspace: { name: 'Team Alpha' } }]),
      },
    };
    const service = new AdminService(prisma as never, auth as never, gitea as never);
    const error = await service.setActive('admin-1', 'u2', false).catch((caught) => caught);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toMatch(/Team Alpha.*transfer ownership/);
    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u2', role: 'owner', workspace: { type: 'team' } },
      }),
    );
    expect(auth.revokeGitCredential).not.toHaveBeenCalled();
    expect(gitea.setUserActive).not.toHaveBeenCalled();
  });

  describe('platform role (audit P1.19)', () => {
    function harness(target: Record<string, unknown>, admins: string[]) {
      const tx = {
        user: {
          findUnique: jest.fn(async () => row(target)),
          update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
            row({ ...target, ...data }),
          ),
        },
        $queryRaw: jest.fn(async () => admins.map((id) => ({ id }))),
      };
      const prisma = { $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)) };
      const audit = { record: jest.fn(async () => undefined) };
      const service = new AdminService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        audit,
      );
      return { service, tx, audit };
    }

    it('promotes an account and audits the change in the same transaction', async () => {
      const { service, tx, audit } = harness({ id: 'u2', platformRole: 'user' }, ['admin-1']);
      await expect(service.setPlatformRole('admin-1', 'u2', 'admin')).resolves.toMatchObject({
        platformRole: 'admin',
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.platform_role_changed',
          details: { previousPlatformRole: 'user', platformRole: 'admin' },
        }),
        tx,
      );
    });

    it('demotes an administrator while another active one remains', async () => {
      const { service, tx } = harness({ id: 'u2', platformRole: 'admin' }, ['admin-1', 'u2']);
      await expect(service.setPlatformRole('admin-1', 'u2', 'user')).resolves.toMatchObject({
        platformRole: 'user',
      });
      expect(tx.user.update).toHaveBeenCalled();
    });

    it('refuses to demote the last active administrator, including oneself', async () => {
      const { service, tx } = harness({ id: 'admin-1', platformRole: 'admin' }, ['admin-1']);
      await expect(service.setPlatformRole('admin-1', 'admin-1', 'user')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('leaves an unchanged role alone', async () => {
      const { service, tx, audit } = harness({ id: 'u2', platformRole: 'user' }, []);
      await service.setPlatformRole('admin-1', 'u2', 'user');
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it('returns the created account and its password when the activation link fails (audit P3)', async () => {
    const auth = {
      provisionManagedUser: jest.fn(async () =>
        row({ username: 'alice', mustChangePassword: true }),
      ),
      createActivationLink: jest.fn(async () => {
        throw new Error('database unavailable');
      }),
    };
    const service = new AdminService({} as never, auth as never, {} as never);
    const result = await service.createUser('admin-1', {
      username: 'alice',
      email: 'a@example.test',
    });
    expect(result.user.username).toBe('alice');
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(result.activationDelivery).toBe('manual');
    expect(result.activationError).toMatch(/account was created.*database unavailable/);
    expect(result).not.toHaveProperty('activationUrl');
  });

  it('refuses an activation link for a deactivated account', async () => {
    const auth = { createActivationLink: jest.fn() };
    const prisma = { user: { findUnique: jest.fn(async () => row({ active: false })) } };
    const service = new AdminService(prisma as never, auth as never, {} as never);
    await expect(service.createActivationLink('admin-1', 'u2')).rejects.toThrow('Reactivate');
    expect(auth.createActivationLink).not.toHaveBeenCalled();
  });
});
