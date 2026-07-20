import { GitHubInstallationService } from './github-installation.service';

function event(over: Record<string, unknown> = {}) {
  return {
    action: 'created',
    installation: {
      id: 42,
      account: { id: 987654, login: 'acme', type: 'Organization' },
      repository_selection: 'selected',
      suspended_at: null,
    },
    ...over,
  };
}

describe('GitHubInstallationService webhook lifecycle', () => {
  it('upserts immutable account identity and mutable display data', async () => {
    let upsertArgs: Record<string, unknown> | undefined;
    const prisma = {
      gitHubInstallation: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async (args: Record<string, unknown>) => { upsertArgs = args; return {}; }),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent(event());
    expect(upsertArgs).toMatchObject({
      where: { installationId: '42' },
      create: {
        installationId: '42',
        accountId: '987654',
        accountLogin: 'acme',
        accountType: 'Organization',
      },
      update: { accountId: '987654', accountLogin: 'acme', deletedAt: null },
    });
  });

  it('tombstones an uninstall instead of destroying its audit binding', async () => {
    const prisma = {
      gitHubInstallation: {
        findUnique: jest.fn(async () => ({ accountId: '987654' })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        upsert: jest.fn(),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent(event({ action: 'deleted' }));
    expect(prisma.gitHubInstallation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ installationId: '42' }),
      data: expect.objectContaining({ accountId: '987654', accountLogin: 'acme', deletedAt: expect.any(Date) }),
    }));
    expect(prisma.gitHubInstallation.upsert).not.toHaveBeenCalled();
  });

  it('refuses to rebind an installation id to another immutable account', async () => {
    const prisma = {
      gitHubInstallation: {
        findUnique: jest.fn(async () => ({ accountId: '111' })),
        upsert: jest.fn(),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await expect(service.handleEvent(event())).rejects.toThrow('immutable account identity');
    expect(prisma.gitHubInstallation.upsert).not.toHaveBeenCalled();
  });

  it('marks the installation suspended', async () => {
    let upsertArgs: { update?: { suspendedAt?: Date } } | undefined;
    const prisma = {
      gitHubInstallation: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async (args: { update?: { suspendedAt?: Date } }) => { upsertArgs = args; return {}; }),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent(event({ action: 'suspend' }));
    expect(upsertArgs?.update?.suspendedAt).toBeInstanceOf(Date);
  });

  it('ignores an event without immutable account identity', async () => {
    const prisma = { gitHubInstallation: { findUnique: jest.fn(), upsert: jest.fn() } };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent({ action: 'created', installation: { id: 42, account: { login: 'x' } } });
    expect(prisma.gitHubInstallation.findUnique).not.toHaveBeenCalled();
    expect(prisma.gitHubInstallation.upsert).not.toHaveBeenCalled();
  });
});

describe('GitHubInstallationService setup authorization', () => {
  it('stores only a hash of a short-lived one-time setup state', async () => {
    let created: { data: { tokenHash: string; expiresAt: Date } } | undefined;
    const prisma = {
      externalIdentity: { findUnique: jest.fn(async () => ({ id: 'identity-1' })) },
      gitHubInstallationSetup: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async (args: { data: { tokenHash: string; expiresAt: Date } }) => { created = args; return {}; }),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    const state = await service.createSetup('user-1', 'workspace-1');
    expect(state.length).toBeGreaterThan(30);
    expect(created?.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created?.data.tokenHash).not.toBe(state);
    expect(created!.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('verifies, consumes and binds an organization installation to the workspace', async () => {
    const tx = {
      gitHubInstallationSetup: { updateMany: jest.fn(async () => ({ count: 1 })) },
      gitHubInstallation: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({ id: 'installation-row-1' })),
      },
      gitHubInstallationAccess: { upsert: jest.fn(async () => ({})) },
    };
    const prisma = {
      gitHubInstallationSetup: {
        findUnique: jest.fn(async () => ({
          id: 'setup-1', userId: 'user-1', workspaceId: 'workspace-1',
          expiresAt: new Date(Date.now() + 60_000), usedAt: null,
        })),
      },
      externalIdentity: { findUnique: jest.fn(async () => ({ providerUserId: '123' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ role: 'owner' })) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const app = {
      getInstallation: jest.fn(async () => ({
        installationId: '42', accountId: '987654', accountLogin: 'acme',
        accountType: 'Organization', repositorySelection: 'selected', suspendedAt: null,
      })),
    };
    const service = new GitHubInstallationService(prisma as never, app as never);
    await expect(service.completeSetup('opaque-state', '42')).resolves.toMatchObject({ accountId: '987654' });
    expect(tx.gitHubInstallationAccess.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        githubInstallationId: 'installation-row-1',
        workspaceId: 'workspace-1',
        authorizedById: 'user-1',
      }),
    }));
  });

  it('rejects a personal installation belonging to another GitHub identity', async () => {
    const prisma = {
      gitHubInstallationSetup: {
        findUnique: jest.fn(async () => ({
          id: 'setup-1', userId: 'user-1', workspaceId: 'workspace-1',
          expiresAt: new Date(Date.now() + 60_000), usedAt: null,
        })),
      },
      externalIdentity: { findUnique: jest.fn(async () => ({ providerUserId: '123' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ role: 'admin' })) },
      $transaction: jest.fn(),
    };
    const app = {
      getInstallation: jest.fn(async () => ({
        installationId: '42', accountId: '999', accountLogin: 'somebody-else',
        accountType: 'User', repositorySelection: 'all', suspendedAt: null,
      })),
    };
    const service = new GitHubInstallationService(prisma as never, app as never);
    await expect(service.completeSetup('opaque-state', '42')).rejects.toThrow('does not match');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recovers a personal installation by immutable linked GitHub id', async () => {
    const tx = {
      gitHubInstallationSetup: { updateMany: jest.fn(async () => ({ count: 1 })) },
      gitHubInstallation: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({ id: 'installation-row-1' })),
      },
      gitHubInstallationAccess: { upsert: jest.fn(async () => ({})) },
    };
    const prisma = {
      gitHubInstallationSetup: {
        findFirst: jest.fn(async () => ({
          id: 'setup-1', userId: 'user-1', workspaceId: 'workspace-1',
          expiresAt: new Date(Date.now() + 60_000), usedAt: null,
        })),
      },
      externalIdentity: { findUnique: jest.fn(async () => ({ providerUserId: '145552632' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ role: 'owner' })) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const app = {
      listInstallations: jest.fn(async () => [{
        installationId: '147774798', accountId: '145552632', accountLogin: 'kudrle01',
        accountType: 'User', repositorySelection: 'all', suspendedAt: null,
      }]),
    };
    const service = new GitHubInstallationService(prisma as never, app as never);

    await expect(service.recoverPersonalSetup('user-1', 'workspace-1')).resolves.toMatchObject({
      installationId: '147774798',
      accountLogin: 'kudrle01',
    });
    expect(tx.gitHubInstallationAccess.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        workspaceId: 'workspace-1',
        authorizedById: 'user-1',
      }),
    }));
  });

  it('never recovers an organization installation from personal identity alone', async () => {
    const prisma = {
      gitHubInstallationSetup: {
        findFirst: jest.fn(async () => ({
          id: 'setup-1', userId: 'user-1', workspaceId: 'workspace-1',
          expiresAt: new Date(Date.now() + 60_000), usedAt: null,
        })),
      },
      externalIdentity: { findUnique: jest.fn(async () => ({ providerUserId: '145552632' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ role: 'owner' })) },
      $transaction: jest.fn(),
    };
    const app = {
      listInstallations: jest.fn(async () => [{
        installationId: '42', accountId: '145552632', accountLogin: 'acme',
        accountType: 'Organization', repositorySelection: 'all', suspendedAt: null,
      }]),
    };
    const service = new GitHubInstallationService(prisma as never, app as never);

    await expect(service.recoverPersonalSetup('user-1', 'workspace-1')).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses expired, replayed, or downgraded-admin callbacks', async () => {
    const expired = {
      gitHubInstallationSetup: {
        findUnique: jest.fn(async () => ({
          id: 'setup-1', userId: 'user-1', workspaceId: 'workspace-1',
          expiresAt: new Date(Date.now() - 1), usedAt: null,
        })),
      },
    };
    await expect(
      new GitHubInstallationService(expired as never, {} as never).completeSetup('old', '42'),
    ).rejects.toThrow('invalid, expired, or already used');

    const noLongerAdmin = {
      gitHubInstallationSetup: {
        findUnique: jest.fn(async () => ({
          id: 'setup-1', userId: 'user-1', workspaceId: 'workspace-1',
          expiresAt: new Date(Date.now() + 60_000), usedAt: null,
        })),
      },
      externalIdentity: { findUnique: jest.fn(async () => ({ providerUserId: '123' })) },
      workspaceMember: { findUnique: jest.fn(async () => ({ role: 'member' })) },
    };
    const app = {
      getInstallation: jest.fn(async () => ({
        installationId: '42', accountId: '77', accountLogin: 'acme',
        accountType: 'Organization', repositorySelection: 'selected', suspendedAt: null,
      })),
    };
    await expect(
      new GitHubInstallationService(noLongerAdmin as never, app as never).completeSetup('state', '42'),
    ).rejects.toThrow('Workspace admin access');
  });
});

describe('GitHubInstallationService tokens', () => {
  it('mints a scoped token for an active legacy owner lookup', async () => {
    const prisma = {
      gitHubInstallation: { findFirst: jest.fn(async () => ({ installationId: '42', suspendedAt: null })) },
    };
    const app = { createInstallationToken: jest.fn(async () => ({ token: 'ghs_x', expiresAt: 'z' })) };
    const service = new GitHubInstallationService(prisma as never, app as never);
    const token = await service.tokenForOwner('acme', {
      repositoryIds: [111], permissions: { contents: 'read' },
    });
    expect(app.createInstallationToken).toHaveBeenCalledWith('42', {
      repositoryIds: [111], permissions: { contents: 'read' },
    });
    expect(token.token).toBe('ghs_x');
  });

  it('mints through the immutable project installation binding', async () => {
    const prisma = {
      gitHubInstallation: {
        findUnique: jest.fn(async () => ({
          id: 'installation-row-1', installationId: '42', accountLogin: 'acme-renamed',
          suspendedAt: null, deletedAt: null,
        })),
      },
    };
    const app = { createInstallationToken: jest.fn(async () => ({ token: 'ghs_bound', expiresAt: 'z' })) };
    const service = new GitHubInstallationService(prisma as never, app as never);
    await expect(
      service.tokenForBinding('installation-row-1', { permissions: { contents: 'read' } }),
    ).resolves.toMatchObject({ token: 'ghs_bound' });
  });

  it('refuses removed or suspended installation tokens', async () => {
    const removed = {
      gitHubInstallation: { findUnique: jest.fn(async () => ({ accountLogin: 'acme', deletedAt: new Date() })) },
    };
    await expect(
      new GitHubInstallationService(removed as never, {} as never).tokenForBinding('gone'),
    ).rejects.toThrow('removed');
    const suspended = {
      gitHubInstallation: { findFirst: jest.fn(async () => ({ accountLogin: 'acme', suspendedAt: new Date() })) },
    };
    await expect(
      new GitHubInstallationService(suspended as never, {} as never).tokenForOwner('acme'),
    ).rejects.toThrow('suspended');
  });
});
