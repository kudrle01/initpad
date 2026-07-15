import { GitHubInstallationService } from './github-installation.service';

function event(over: Record<string, unknown> = {}) {
  return {
    action: 'created',
    installation: {
      id: 42,
      account: { login: 'acme', type: 'Organization' },
      repository_selection: 'selected',
      suspended_at: null,
    },
    ...over,
  };
}

describe('GitHubInstallationService', () => {
  it('upserts an installation from a created event', async () => {
    let upsertArgs: Record<string, unknown> | undefined;
    const prisma = {
      gitHubInstallation: {
        upsert: jest.fn(async (args: Record<string, unknown>) => { upsertArgs = args; return {}; }),
        deleteMany: jest.fn(),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent(event());
    expect(upsertArgs).toMatchObject({
      where: { installationId: '42' },
      create: { installationId: '42', accountLogin: 'acme', accountType: 'Organization' },
    });
  });

  it('removes an installation on the deleted event', async () => {
    const prisma = {
      gitHubInstallation: { deleteMany: jest.fn(async () => ({ count: 1 })), upsert: jest.fn() },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent(event({ action: 'deleted' }));
    expect(prisma.gitHubInstallation.deleteMany).toHaveBeenCalledWith({ where: { installationId: '42' } });
    expect(prisma.gitHubInstallation.upsert).not.toHaveBeenCalled();
  });

  it('marks the installation suspended', async () => {
    let upsertArgs: { update?: { suspendedAt?: Date } } | undefined;
    const prisma = {
      gitHubInstallation: {
        upsert: jest.fn(async (args: { update?: { suspendedAt?: Date } }) => { upsertArgs = args; return {}; }),
      },
    };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent(event({ action: 'suspend' }));
    expect(upsertArgs?.update?.suspendedAt).toBeInstanceOf(Date);
  });

  it('ignores an event without an installation id', async () => {
    const prisma = { gitHubInstallation: { upsert: jest.fn(), deleteMany: jest.fn() } };
    const service = new GitHubInstallationService(prisma as never, {} as never);
    await service.handleEvent({ action: 'created', installation: { account: { login: 'x' } } });
    expect(prisma.gitHubInstallation.upsert).not.toHaveBeenCalled();
  });

  it('mints a scoped token for an owner with an active installation', async () => {
    const prisma = {
      gitHubInstallation: { findFirst: jest.fn(async () => ({ installationId: '42', suspendedAt: null })) },
    };
    const app = { createInstallationToken: jest.fn(async () => ({ token: 'ghs_x', expiresAt: 'z' })) };
    const service = new GitHubInstallationService(prisma as never, app as never);
    const token = await service.tokenForOwner('acme', [111]);
    expect(app.createInstallationToken).toHaveBeenCalledWith('42', { repositoryIds: [111] });
    expect(token.token).toBe('ghs_x');
  });

  it('refuses a token when there is no installation or it is suspended', async () => {
    const none = { gitHubInstallation: { findFirst: jest.fn(async () => null) } };
    await expect(new GitHubInstallationService(none as never, {} as never).tokenForOwner('nobody'))
      .rejects.toThrow('No GitHub App installation');
    const suspended = { gitHubInstallation: { findFirst: jest.fn(async () => ({ installationId: '42', suspendedAt: new Date() })) } };
    await expect(new GitHubInstallationService(suspended as never, {} as never).tokenForOwner('acme'))
      .rejects.toThrow('suspended');
  });
});
