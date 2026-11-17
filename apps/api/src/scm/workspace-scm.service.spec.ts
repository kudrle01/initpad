import { BadRequestException, ConflictException } from '@nestjs/common';
import { encryptSecret } from '../common/secret';
import { config } from '../config';
import { WorkspaceScmService } from './workspace-scm.service';

const savedEdition = config.edition;
afterEach(() => {
  config.edition = savedEdition;
});

describe('WorkspaceScmService', () => {
  it('keeps self-hosted creation on the managed Gitea identity', async () => {
    config.edition = 'self-hosted';
    const gitea = {};
    const service = new WorkspaceScmService(
      {
        user: {
          findUniqueOrThrow: jest.fn(async () => ({
            username: 'alice',
            accessToken: encryptSecret('gitea-user-token'),
          })),
        },
      } as never,
      { for: jest.fn(() => gitea) } as never,
    );

    await expect(service.createContext('user-1', 'workspace-1')).resolves.toEqual({
      kind: 'gitea',
      actor: { username: 'alice', token: 'gitea-user-token' },
    });
  });

  it('rejects a GitHub installation that is not granted to the active workspace', async () => {
    config.edition = 'saas';
    const service = new WorkspaceScmService(
      {
        gitHubInstallationAccess: { findUnique: jest.fn(async () => null) },
      } as never,
      {} as never,
    );

    await expect(
      service.createContext('user-1', 'workspace-a', '00000000-0000-4000-8000-000000000001'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not let a team member create under another member's personal GitHub installation", async () => {
    config.edition = 'saas';
    const service = new WorkspaceScmService(
      {
        gitHubInstallationAccess: {
          findUnique: jest.fn(async () => ({
            githubInstallation: {
              id: 'installation-a',
              accountId: 'github-user-a',
              accountLogin: 'alice',
              accountType: 'User',
              deletedAt: null,
              suspendedAt: null,
            },
          })),
        },
        externalIdentity: {
          findUnique: jest.fn(async () => ({ providerUserId: 'github-user-b' })),
        },
        workspace: { findUnique: jest.fn(async () => ({ type: 'personal' })) },
      } as never,
      {} as never,
    );

    await expect(
      service.createContext('user-b', 'workspace-team', '00000000-0000-4000-8000-000000000001'),
    ).rejects.toThrow('Only the owner');
  });

  it('refuses a personal GitHub account as the home of a team project (ADR-189)', async () => {
    config.edition = 'saas';
    const service = new WorkspaceScmService(
      {
        gitHubInstallationAccess: {
          findUnique: jest.fn(async () => ({
            githubInstallation: {
              id: 'installation-a',
              accountId: 'github-user-a',
              accountLogin: 'alice',
              accountType: 'User',
              deletedAt: null,
              suspendedAt: null,
            },
          })),
        },
        workspace: { findUnique: jest.fn(async () => ({ type: 'team' })) },
      } as never,
      {} as never,
    );

    await expect(
      service.createContext('user-a', 'workspace-team', '00000000-0000-4000-8000-000000000001'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('imports into a team workspace only from organization installations (ADR-189)', async () => {
    config.edition = 'saas';
    const findMany = jest.fn(async () => []);
    const service = new WorkspaceScmService(
      {
        gitHubInstallationAccess: { findMany },
        workspace: { findUnique: jest.fn(async () => ({ type: 'team' })) },
      } as never,
      { for: jest.fn(() => ({ listRepositories: jest.fn(async () => []) })) } as never,
    );

    await service.listRepositories('user-a', 'workspace-team');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          githubInstallation: expect.objectContaining({ accountType: 'Organization' }),
        }),
      }),
    );
  });

  it('lists every active workspace-authorized installation and deduplicates repositories', async () => {
    config.edition = 'saas';
    const installations = [
      { id: 'installation-a', accountLogin: 'alice' },
      { id: 'installation-b', accountLogin: 'acme' },
    ];
    const github = {
      listRepositories: jest.fn(async (actor: { installationId?: string; username: string }) => [
        {
          provider: 'github',
          repositoryId: '101',
          owner: actor.username,
          name: 'api',
          fullName: `${actor.username}/api`,
          repoUrl: `https://github.com/${actor.username}/api`,
          installationId: actor.installationId,
          private: true,
          defaultBranch: 'main',
          updatedAt: '',
          empty: false,
        },
      ]),
    };
    const service = new WorkspaceScmService(
      {
        workspace: { findUnique: jest.fn(async () => ({ type: 'personal' })) },
        gitHubInstallationAccess: {
          findMany: jest.fn(async () =>
            installations.map((githubInstallation) => ({ githubInstallation })),
          ),
        },
      } as never,
      { for: jest.fn(() => github) } as never,
    );

    const repos = await service.listRepositories('user-1', 'workspace-1');
    expect(github.listRepositories).toHaveBeenCalledTimes(2);
    expect(github.listRepositories).toHaveBeenNthCalledWith(2, {
      username: 'acme',
      token: '',
      installationId: 'installation-b',
    });
    expect(repos).toHaveLength(1);
  });
});
