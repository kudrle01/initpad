import { GitHubStatusController } from './github-status.controller';
import { config } from '../../config';

describe('GitHubStatusController', () => {
  const savedEdition = config.edition;
  const savedCiPublicUrl = config.ci.publicUrl;

  afterEach(() => {
    config.edition = savedEdition;
    config.ci.publicUrl = savedCiPublicUrl;
  });

  it('reports only installations explicitly authorized for the active workspace', async () => {
    const identities = {
      listForUser: jest.fn(async () => [{ provider: 'github', username: 'alice' }]),
    };
    const installations = {
      hasPendingRequest: jest.fn(async () => false),
      listForWorkspace: jest.fn(async () => [
        {
          githubInstallation: {
            id: 'installation-row-1',
            accountId: '987654',
            accountLogin: 'acme',
            accountType: 'Organization',
            repositorySelection: 'selected',
            suspendedAt: null,
          },
        },
      ]),
    };
    const app = { isConfigured: jest.fn(() => true) };
    const workspaces = {
      resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })),
      typeOf: jest.fn(async () => 'personal'),
    };
    const controller = new GitHubStatusController(
      identities as never,
      installations as never,
      app as never,
      workspaces as never,
      { isReadyForUser: jest.fn(async () => true) } as never,
    );

    const result = await controller.status('user-1', 'workspace-1');
    expect(installations.listForWorkspace).toHaveBeenCalledWith('workspace-1');
    expect(result.installation).toEqual({ present: true, suspended: false });
    expect(result.installations[0]).toMatchObject({ accountId: '987654', accountLogin: 'acme' });
  });

  it('offers only organizations for new projects of a team workspace (ADR-189)', async () => {
    const installation = (id: string, accountType: string, accountId: string) => ({
      githubInstallation: {
        id,
        accountId,
        accountLogin: id,
        accountType,
        repositorySelection: 'selected',
        suspendedAt: null,
      },
    });
    const controller = new GitHubStatusController(
      {
        listForUser: jest.fn(async () => [
          { provider: 'github', username: 'alice', providerUserId: '111' },
        ]),
      } as never,
      {
        hasPendingRequest: jest.fn(async () => false),
        listForWorkspace: jest.fn(async () => [
          installation('alice', 'User', '111'),
          installation('acme', 'Organization', '987654'),
        ]),
      } as never,
      { isConfigured: jest.fn(() => true) } as never,
      {
        resolve: jest.fn(async () => ({ id: 'workspace-team', role: 'owner' })),
        typeOf: jest.fn(async () => 'team'),
      } as never,
      { isReadyForUser: jest.fn(async () => true) } as never,
    );

    const result = await controller.status('user-1', 'workspace-team');

    expect(result.installations).toEqual([
      expect.objectContaining({ accountLogin: 'alice', canCreate: false }),
      expect.objectContaining({ accountLogin: 'acme', canCreate: true }),
    ]);
  });

  it('does not let a regular workspace member start installation setup', async () => {
    const controller = new GitHubStatusController(
      { listForUser: jest.fn(async () => [{ provider: 'github', username: 'alice' }]) } as never,
      {
        listForWorkspace: jest.fn(async () => []),
        hasPendingRequest: jest.fn(async () => false),
      } as never,
      { isConfigured: jest.fn(() => true) } as never,
      {
        resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'member' })),
        typeOf: jest.fn(async () => 'personal'),
      } as never,
      { isReadyForUser: jest.fn(async () => true) } as never,
    );
    await expect(controller.status('user-1', 'workspace-1')).resolves.toMatchObject({
      canInstall: false,
    });
  });

  it('reports a local callback as not ready in SaaS', async () => {
    config.edition = 'saas';
    config.ci.publicUrl = 'http://localhost:8080';
    const controller = new GitHubStatusController(
      { listForUser: jest.fn(async () => []) } as never,
      {
        listForWorkspace: jest.fn(async () => []),
        hasPendingRequest: jest.fn(async () => false),
      } as never,
      { isConfigured: jest.fn(() => true) } as never,
      {
        resolve: jest.fn(async () => ({ id: 'workspace-1', role: 'owner' })),
        typeOf: jest.fn(async () => 'personal'),
      } as never,
      { isReadyForUser: jest.fn(async () => false) } as never,
    );

    await expect(controller.status('user-1', 'workspace-1')).resolves.toMatchObject({
      ciCallbackReady: false,
      ciCallbackUrl: 'http://localhost:8080',
      ciCallbackIssue: expect.stringContaining('HTTPS'),
    });
  });
});
