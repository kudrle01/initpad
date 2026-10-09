import { createHash } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { config } from '../config';
import type { RecordAuditEvent } from '../audit/audit-events.service';
import { AuthService } from './auth.service';
import { hashPassword } from './password';

// Session rows behind issued tokens (ADR-147); merged into a Prisma mock.
function withSessions<T extends object>(prisma: T): T {
  return Object.assign(prisma, {
    userSession: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({ id: 'session-1' })),
    },
  });
}

describe('AuthService', () => {
  const originalMode = config.auth.registrationMode;
  const originalEdition = config.edition;

  const originalBootstrapToken = config.auth.bootstrapToken;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    config.auth.registrationMode = originalMode;
    config.edition = originalEdition;
    config.auth.bootstrapToken = originalBootstrapToken;
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('first administrator bootstrap (ADR-136)', () => {
    const setupToken = 's'.repeat(48);

    function registration(existingUsers = 0) {
      const users: Array<Record<string, unknown>> = [];
      const prisma = {
        $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
        user: {
          count: jest.fn(async () => existingUsers + users.length),
          findFirst: jest.fn(async () => null),
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const user = { id: `u${users.length + 1}`, name: null, avatarUrl: null, ...data };
            users.push(user);
            return user;
          }),
        },
      };
      const gitea = {
        createUser: jest.fn(async ({ username }: { username: string }) => ({
          id: 1,
          login: username,
        })),
        createCloneToken: jest.fn(async () => 'a'.repeat(40)),
        randomizeUserPassword: jest.fn(async () => undefined),
        deleteUser: jest.fn(),
      };
      const service = new AuthService(
        withSessions(prisma) as never,
        { sign: jest.fn(() => 'jwt') } as never,
        gitea as never,
      );
      return { service, gitea, users };
    }

    const account = (bootstrapToken?: string) => ({
      username: 'first-admin',
      email: 'admin@example.test',
      password: 'long-password-1',
      ...(bootstrapToken === undefined ? {} : { bootstrapToken }),
    });

    it('creates the administrator only with the installer setup token', async () => {
      config.auth.bootstrapToken = setupToken;
      const { service, gitea, users } = registration();

      await expect(service.register(account())).rejects.toThrow('setup token is not valid');
      await expect(service.register(account('s'.repeat(47)))).rejects.toThrow(
        'setup token is not valid',
      );
      expect(gitea.createUser).not.toHaveBeenCalled();

      await service.register(account(setupToken));
      expect(users[0]).toMatchObject({ platformRole: 'admin' });
    });

    it('refuses a production first administrator without a configured token', async () => {
      config.auth.bootstrapToken = '';
      process.env.NODE_ENV = 'production';
      const { service, gitea } = registration();

      await expect(service.register(account('anything'))).rejects.toThrow(
        'INITPAD_BOOTSTRAP_TOKEN',
      );
      expect(gitea.createUser).not.toHaveBeenCalled();
    });

    it('does not ask later open-registration accounts for the token', async () => {
      config.auth.bootstrapToken = setupToken;
      config.auth.registrationMode = 'open';
      const { service, users } = registration(1);

      await service.register(account());
      expect(users[0]).toMatchObject({ platformRole: 'user' });
    });

    it('reports the token requirement only while no account exists', async () => {
      config.auth.bootstrapToken = setupToken;
      await expect(registration().service.bootstrapRequired()).resolves.toBe(true);
      await expect(registration(1).service.bootstrapRequired()).resolves.toBe(false);
      config.edition = 'saas';
      await expect(registration().service.bootstrapRequired()).resolves.toBe(false);
    });
  });

  it('serializes bootstrap registration so only one account is created', async () => {
    config.auth.registrationMode = 'admin-provisioned';
    const users: Array<Record<string, unknown>> = [];
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
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
      createUser: jest.fn(async ({ username }: { username: string }) => ({
        id: 1,
        login: username,
      })),
      createCloneToken: jest.fn(async () => 'a'.repeat(40)),
      randomizeUserPassword: jest.fn(async () => undefined),
      deleteUser: jest.fn(),
    };
    const jwt = { sign: jest.fn(() => 'jwt') };
    const service = new AuthService(withSessions(prisma) as never, jwt as never, gitea as never);

    const result = await Promise.allSettled([
      service.register({
        username: 'First-User',
        email: 'first@example.test',
        password: 'long-password-1',
      }),
      service.register({
        username: 'second-user',
        email: 'second@example.test',
        password: 'long-password-2',
      }),
    ]);

    expect(result.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = result.find((entry) => entry.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ForbiddenException);
    expect(gitea.createUser).toHaveBeenCalledTimes(1);
    expect(gitea.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'first-user' }),
    );
    // New accounts start with the scoped clone token only (ADR-134).
    expect(gitea.createCloneToken).toHaveBeenCalledWith('first-user', 'long-password-1');
    expect(users[0]).toMatchObject({ giteaCredentialsScopedAt: expect.any(Date) });
  });

  it('keeps self-service registration open in the open policy', async () => {
    config.auth.registrationMode = 'open';
    const prisma = { user: { count: jest.fn(async () => 5) } };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    expect(await service.registrationAvailable()).toBe(true);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('never exposes managed password registration in the SaaS edition', async () => {
    config.edition = 'saas';
    config.auth.registrationMode = 'open';
    const prisma = { user: { count: jest.fn() } };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    expect(await service.registrationAvailable()).toBe(false);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('never accepts password sign-in in the SaaS edition', async () => {
    config.edition = 'saas';
    const prisma = { user: { findFirst: jest.fn() } };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await expect(service.login({ username: 'alice', password: 'long-password' })).rejects.toThrow(
      'disabled in the SaaS edition',
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('hardens every legacy managed Gitea account when self-hosted starts', async () => {
    config.edition = 'self-hosted';
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findMany: jest.fn(async () => [{ username: 'alice' }, { username: 'bob' }]),
      },
    };
    const gitea = { randomizeUserPassword: jest.fn(async () => undefined) };
    const service = new AuthService(withSessions(prisma) as never, {} as never, gitea as never);

    await service.onModuleInit();

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { giteaId: { not: null } },
      select: { username: true },
    });
    expect(gitea.randomizeUserPassword).toHaveBeenCalledTimes(2);
    expect(gitea.randomizeUserPassword).toHaveBeenNthCalledWith(1, 'alice');
    expect(gitea.randomizeUserPassword).toHaveBeenNthCalledWith(2, 'bob');
  });

  it('only allows the bootstrap admin under a non-open policy', async () => {
    config.auth.registrationMode = 'admin-provisioned';
    let count = 0;
    const prisma = { user: { count: jest.fn(async () => count) } };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    expect(await service.registrationAvailable()).toBe(true); // empty instance bootstraps
    count = 1;
    expect(await service.registrationAvailable()).toBe(false); // then closed to self-service
  });

  it('matches username and e-mail case-insensitively during sign-in', async () => {
    config.edition = 'self-hosted';
    const user = {
      id: 'u1',
      username: 'alice',
      email: 'alice@example.test',
      name: null,
      avatarUrl: null,
      passwordHash: await hashPassword('long-password'),
      accessToken: '',
      platformRole: 'user',
      active: true,
      tokenVersion: 0,
      mustChangePassword: false,
    };
    const prisma = { user: { findFirst: jest.fn(async () => user) } };
    const service = new AuthService(
      withSessions(prisma) as never,
      { sign: () => 'jwt' } as never,
      {} as never,
    );
    await service.login({ username: ' ALICE@EXAMPLE.TEST ', password: 'long-password' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { username: { equals: 'alice@example.test', mode: 'insensitive' } },
          { email: { equals: 'alice@example.test', mode: 'insensitive' } },
        ],
      },
    });

    await service.login({ username: 'ALIce', password: 'long-password' });
    expect(prisma.user.findFirst).toHaveBeenLastCalledWith({
      where: {
        OR: [
          { username: { equals: 'alice', mode: 'insensitive' } },
          { email: { equals: 'alice', mode: 'insensitive' } },
        ],
      },
    });
  });

  it('audits sign-in without storing the identifier a visitor typed (ADR-142)', async () => {
    config.edition = 'self-hosted';
    const user = {
      id: 'u1',
      username: 'alice',
      email: 'alice@example.test',
      name: null,
      avatarUrl: null,
      passwordHash: await hashPassword('long-password'),
      accessToken: '',
      platformRole: 'user',
      active: true,
      tokenVersion: 0,
      mustChangePassword: false,
    };
    const findFirst = jest.fn(async () => user as typeof user | null);
    const audit = { record: jest.fn(async (_event: RecordAuditEvent) => undefined) };
    const service = new AuthService(
      withSessions({ user: { findFirst } }) as never,
      { sign: () => 'jwt' } as never,
      {} as never,
      undefined,
      audit,
    );

    await service.login({ username: 'alice', password: 'long-password' });
    await expect(
      service.login({ username: 'alice', password: 'wrong-password' }),
    ).rejects.toThrow();
    findFirst.mockResolvedValueOnce(null);
    await expect(
      service.login({ username: 'my-secret-password', password: 'x' }),
    ).rejects.toThrow();

    expect(audit.record.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        workspaceId: null,
        actorUserId: 'u1',
        action: 'auth.signed_in',
        resourceName: 'alice',
        details: { method: 'password' },
      }),
      expect.objectContaining({
        anonymous: true,
        action: 'auth.sign_in_failed',
        outcome: 'failed',
        resourceId: 'u1',
        details: { reason: 'invalid_password' },
      }),
      expect.objectContaining({
        anonymous: true,
        action: 'auth.sign_in_failed',
        resourceId: null,
        resourceName: null,
        details: { reason: 'unknown_account' },
      }),
    ]);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('my-secret-password');
  });

  it('refuses sign-in for a deactivated account', async () => {
    config.edition = 'self-hosted';
    const user = {
      id: 'u1',
      username: 'bob',
      email: 'bob@example.test',
      name: null,
      avatarUrl: null,
      passwordHash: await hashPassword('long-password'),
      accessToken: '',
      platformRole: 'user',
      active: false,
      tokenVersion: 0,
      mustChangePassword: false,
    };
    const prisma = { user: { findFirst: jest.fn(async () => user) } };
    const service = new AuthService(
      withSessions(prisma) as never,
      { sign: () => 'jwt' } as never,
      {} as never,
    );
    await expect(service.login({ username: 'bob', password: 'long-password' })).rejects.toThrow(
      'deactivated',
    );
  });

  it('clears the forced-change flag and bumps the session generation on change', async () => {
    const stored = {
      id: 'u1',
      username: 'carol',
      email: null,
      name: null,
      avatarUrl: null,
      passwordHash: await hashPassword('old-password-1'),
      accessToken: '',
      platformRole: 'user',
      active: true,
      tokenVersion: 2,
      mustChangePassword: true,
    };
    let updateArgs: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findUnique: jest.fn(async () => stored),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updateArgs = data;
          return { ...stored, ...data, tokenVersion: 3, mustChangePassword: false };
        }),
      },
    };
    const service = new AuthService(
      withSessions(prisma) as never,
      { sign: (p: unknown) => JSON.stringify(p) } as never,
      {} as never,
    );
    const result = await service.changePassword('u1', 'old-password-1', 'brand-new-password-9');
    expect(updateArgs?.mustChangePassword).toBe(false);
    expect(updateArgs?.tokenVersion).toEqual({ increment: 1 });
    expect(result.user.mustChangePassword).toBe(false);
    expect(result.token).toContain('"ver":3');
  });

  it('rejects a password change with the wrong current password', async () => {
    const stored = {
      id: 'u1',
      passwordHash: await hashPassword('old-password-1'),
      active: true,
      tokenVersion: 0,
    };
    const prisma = { user: { findUnique: jest.fn(async () => stored), update: jest.fn() } };
    const service = new AuthService(
      withSessions(prisma) as never,
      { sign: () => 'jwt' } as never,
      {} as never,
    );
    await expect(
      service.changePassword('u1', 'wrong-password', 'brand-new-password-9'),
    ).rejects.toThrow('incorrect');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('creates a GitHub-only account with a linked identity and no Gitea id', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findFirst: jest.fn(async () => null), // username free, e-mail free
        count: jest.fn(async () => 3),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return { id: 'u9', ...data };
        }),
      },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await service.provisionExternalUser({
      provider: 'github',
      providerUserId: '555',
      login: 'octocat',
      email: 'octo@example.test',
      name: 'Octo',
      avatarUrl: null,
      emailVerified: true,
    });
    expect(createData?.giteaId).toBeNull();
    expect(createData?.accessToken).toBe('');
    expect(createData?.passwordHash).toBeNull();
    expect(createData?.platformRole).toBe('user');
    expect(createData?.username).toBe('octocat');
    expect(createData?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(createData?.externalIdentities).toEqual({
      create: { provider: 'github', providerUserId: '555', username: 'octocat' },
    });
  });

  it('never attaches a taken e-mail to a new external account', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        // username free (1st call) then e-mail already taken (2nd call).
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'other' }),
        count: jest.fn(async () => 3),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return { id: 'u9', ...data };
        }),
      },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await service.provisionExternalUser({
      provider: 'github',
      providerUserId: '9',
      login: 'dev',
      email: 'taken@example.test',
      emailVerified: true,
    });
    expect(createData?.email).toBeNull();
    expect(createData?.emailVerifiedAt).toBeNull();
  });

  it('does not store an unverified external profile e-mail', async () => {
    let createData: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return { id: 'u9', ...data };
        }),
      },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await service.provisionExternalUser({
      provider: 'github',
      providerUserId: '10',
      login: 'dev',
      email: 'unverified@example.test',
      emailVerified: false,
    });
    expect(createData?.email).toBeNull();
    expect(createData?.emailVerifiedAt).toBeNull();
  });

  it('does not issue self-verification links in the SaaS edition', async () => {
    config.edition = 'saas';
    const prisma = { user: { findUnique: jest.fn() } };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await expect(service.requestEmailVerification('u1')).rejects.toThrow('provided by GitHub');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not reveal whether an account exists on reset request', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      user: { findFirst: jest.fn(async () => null) },
      authToken: { updateMany: jest.fn(), create: jest.fn() },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await expect(service.requestPasswordReset('ghost@example.test')).resolves.toBeUndefined();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('issues a single-use reset token superseding earlier ones', async () => {
    let created: Record<string, unknown> | undefined;
    const transaction = jest.fn();
    const prisma = {
      user: {
        findFirst: jest.fn(async () => ({
          id: 'u1',
          username: 'dave',
          name: 'Dave',
          email: 'dave@example.test',
          passwordHash: 'x',
        })),
      },
      authToken: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return {};
        }),
      },
      $queryRaw: jest.fn(async () => [{ id: 'u1' }]),
      emailOutbox: { create: jest.fn(async () => ({})) },
      $transaction: transaction,
    };
    transaction.mockImplementation(async (operation: (tx: unknown) => Promise<void>) =>
      operation(prisma),
    );
    const mail = {
      isEnabled: jest.fn(() => true),
      enqueueAuthMail: jest.fn(async () => undefined),
      scheduleDelivery: jest.fn(),
    };
    const service = new AuthService(
      withSessions(prisma) as never,
      {} as never,
      {} as never,
      mail as never,
    );
    await service.requestPasswordReset('dave');
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', kind: 'password_reset', usedAt: null } }),
    );
    expect(created?.kind).toBe('password_reset');
    expect(typeof created?.tokenHash).toBe('string');
    expect(created?.tokenHash).toHaveLength(64); // sha-256 hex, never the plaintext
    expect(mail.enqueueAuthMail).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'u1',
        kind: 'password_reset',
        recipient: 'dave@example.test',
        // ADR-143: the token is in the fragment, never in the requested path.
        url: expect.stringMatching(/\/reset-password#[A-Za-z0-9_-]{43}$/),
      }),
    );
    expect(mail.scheduleDelivery).toHaveBeenCalledTimes(1);
  });

  it('returns a manual activation link with the token in the fragment', async () => {
    let created: Record<string, unknown> | undefined;
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u1',
          username: 'erin',
          name: null,
          email: null,
        })),
      },
      authToken: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return {};
        }),
      },
      $queryRaw: jest.fn(async () => [{ id: 'u1' }]),
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    const result = await service.createActivationLink('u1');
    expect(result.delivery).toBe('manual');
    const url = new URL(result.activationUrl!);
    expect(url.pathname).toMatch(/\/activate$/);
    const token = url.hash.slice(1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('resets the password, forces re-login and consumes the token', async () => {
    const record = {
      id: 't1',
      userId: 'u1',
      kind: 'password_reset',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    let usedUpdate: unknown;
    let userUpdate: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: {
        findUnique: jest.fn(async () => record),
        updateMany: jest.fn(async (args: unknown) => {
          usedUpdate = args;
          return { count: 1 };
        }),
      },
      project: { findMany: jest.fn(async () => []) },
      user: {
        findUnique: jest.fn(async () => ({ username: 'alice', giteaId: 7 })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.passwordHash) userUpdate = data;
          return {};
        }),
      },
    };
    const gitea = { revokeAccountCredentials: jest.fn(async () => undefined) };
    const service = new AuthService(withSessions(prisma) as never, {} as never, gitea as never);
    await service.resetPassword('plaintext-token', 'a-brand-new-password');
    // A Git token taken through the compromised session stops working.
    expect(gitea.revokeAccountCredentials).toHaveBeenCalledWith('alice', []);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { accessToken: '' },
    });
    expect(usedUpdate).toMatchObject({
      where: {
        id: 't1',
        kind: 'password_reset',
        usedAt: null,
        expiresAt: { gte: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    });
    expect(userUpdate?.mustChangePassword).toBe(false);
    expect(userUpdate?.tokenVersion).toEqual({ increment: 1 });
  });

  it('revokes Gitea credentials of the account and reissues its repository tokens (ADR-148)', async () => {
    const row = {
      scmProvider: 'gitea',
      scmRepositoryId: '101',
      scmOwner: 'alice',
      scmRepositoryName: 'app',
      scmFullName: 'alice/app',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'http://git.test/alice/app',
    };
    const prisma = {
      project: { findMany: jest.fn(async () => [row]) },
      user: {
        findUnique: jest.fn(async () => ({ username: 'alice', giteaId: 7 })),
        update: jest.fn(async () => ({})),
      },
    };
    const gitea = { revokeAccountCredentials: jest.fn(async () => undefined) };
    const service = new AuthService(withSessions(prisma) as never, {} as never, gitea as never);

    await service.revokeGitCredential('u1');

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scmProvider: 'gitea', scmOwner: 'alice', scmRepositoryId: { not: null } },
      }),
    );
    expect(gitea.revokeAccountCredentials).toHaveBeenCalledWith('alice', [
      expect.objectContaining({ provider: 'gitea', repositoryId: '101', fullName: 'alice/app' }),
    ]);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { accessToken: '' },
    });
  });

  it('keeps the reset link usable when Gitea cannot revoke the Git token', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: {
        findUnique: jest.fn(async () => ({
          id: 't1',
          userId: 'u1',
          kind: 'password_reset',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        })),
        updateMany: jest.fn(),
      },
      project: { findMany: jest.fn(async () => []) },
      user: {
        findUnique: jest.fn(async () => ({ username: 'alice', giteaId: 7 })),
        update: jest.fn(),
      },
    };
    const gitea = {
      revokeAccountCredentials: jest.fn(async () => {
        throw new Error('Gitea unavailable');
      }),
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, gitea as never);
    await expect(
      service.resetPassword('plaintext-token', 'a-brand-new-password'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('resets a GitHub-only account without contacting Gitea', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: {
        findUnique: jest.fn(async () => ({
          id: 't1',
          userId: 'u1',
          kind: 'password_reset',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: {
        findUnique: jest.fn(async () => ({ username: 'alice', giteaId: null })),
        update: jest.fn(async () => ({})),
      },
    };
    const gitea = { revokeAccountCredentials: jest.fn() };
    const service = new AuthService(withSessions(prisma) as never, {} as never, gitea as never);
    await service.resetPassword('plaintext-token', 'a-brand-new-password');
    expect(gitea.revokeAccountCredentials).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired or unknown reset token', async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: { findUnique: jest.fn(async () => null), updateMany: jest.fn() },
      user: { update: jest.fn() },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await expect(service.resetPassword('nope', 'a-brand-new-password')).rejects.toThrow(
      'invalid or has expired',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('marks the e-mail verified when the token is valid', async () => {
    const record = {
      id: 't2',
      userId: 'u1',
      kind: 'email_verify',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    let userUpdate: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: {
        findUnique: jest.fn(async () => record),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          userUpdate = data;
          return {};
        }),
      },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await service.verifyEmail('tok');
    expect(userUpdate?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('activates an account: sets the password, clears the flag and signs in', async () => {
    const record = {
      id: 't4',
      userId: 'u1',
      kind: 'activation',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    let userUpdate: Record<string, unknown> | undefined;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: {
        findUnique: jest.fn(async () => record),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          userUpdate = data;
          return {
            id: 'u1',
            username: 'newbie',
            name: null,
            email: null,
            avatarUrl: null,
            platformRole: 'user',
            tokenVersion: 1,
            mustChangePassword: false,
          };
        }),
      },
    };
    const service = new AuthService(
      withSessions(prisma) as never,
      { sign: () => 'jwt' } as never,
      {} as never,
    );
    const result = await service.activate('tok', 'a-brand-new-password');
    expect(userUpdate?.mustChangePassword).toBe(false);
    expect(userUpdate?.tokenVersion).toEqual({ increment: 1 });
    expect(result.token).toBe('jwt');
    expect(result.user.mustChangePassword).toBe(false);
  });

  it('does not accept a reset token for e-mail verification', async () => {
    const record = {
      id: 't3',
      userId: 'u1',
      kind: 'password_reset',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: { findUnique: jest.fn(async () => record), updateMany: jest.fn() },
      user: { update: jest.fn() },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await expect(service.verifyEmail('tok')).rejects.toThrow('invalid or has expired');
  });

  it('rejects a token that another concurrent request already claimed', async () => {
    const record = {
      id: 't5',
      userId: 'u1',
      kind: 'activation',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      authToken: {
        findUnique: jest.fn(async () => record),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      user: { update: jest.fn() },
    };
    const service = new AuthService(withSessions(prisma) as never, {} as never, {} as never);
    await expect(service.activate('tok', 'a-brand-new-password')).rejects.toThrow(
      'invalid or has expired',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
