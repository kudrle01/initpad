import { ConflictException } from '@nestjs/common';
import { config } from '../config';
import { ScmHttpStatusError } from '../scm/scm-http';
import { WorkspaceGitHubAccessService } from './workspace-github-access.service';

const ORG = { id: 'inst-org', accountLogin: 'acme', accountType: 'Organization' };

function orgProject(name = 'app') {
  return {
    scmProvider: 'github',
    scmRepositoryId: `repo-${name}`,
    scmOwner: 'acme',
    scmRepositoryName: name,
    scmFullName: `acme/${name}`,
    scmDefaultBranch: 'main',
    scmInstallationId: ORG.id,
    repoUrl: `https://github.com/acme/${name}`,
    scmInstallation: ORG,
  };
}

function setup(
  options: {
    linked?: boolean;
    orgMembership?: { state: 'pending' | 'active'; role: 'admin' | 'member' } | null;
    stored?: Array<{ invitedByInitPad: boolean }>;
    otherWorkspaces?: number;
    workspaceType?: string;
    personalProjects?: Array<{ scmInstallation: { accountLogin: string } }>;
    tokenRefused?: boolean;
  } = {},
) {
  const github = {
    setCollaborator: jest.fn(async () => undefined),
    removeCollaborator: jest.fn(async () => undefined),
    organizationMembership: jest.fn(async () => {
      if (options.tokenRefused) {
        throw new ScmHttpStatusError('GitHub', 'mint installation token', 422);
      }
      return options.orgMembership ?? null;
    }),
    inviteToOrganization: jest.fn(async () => ({ state: 'pending' as const, role: 'member' })),
    removeFromOrganization: jest.fn(async () => undefined),
  };
  const stored = (options.stored ?? []).map((row, index) => ({
    id: `membership-${index}`,
    githubInstallationId: ORG.id,
    githubLogin: 'bob-gh',
    githubInstallation: { id: ORG.id, accountLogin: ORG.accountLogin },
    ...row,
  }));
  const prisma = {
    workspace: {
      findUnique: jest.fn(async () => ({ type: options.workspaceType ?? 'team' })),
    },
    project: {
      findMany: jest.fn(async (args: { where: { scmInstallation?: unknown } }) =>
        args.where.scmInstallation ? (options.personalProjects ?? []) : [orgProject()],
      ),
    },
    externalIdentity: {
      findUnique: jest.fn(async () =>
        options.linked === false ? null : { providerUserId: '777', username: 'bob-gh' },
      ),
    },
    gitHubOrgMembership: {
      findUnique: jest.fn(async () => stored[0] ?? null),
      findMany: jest.fn(async () => stored),
      upsert: jest.fn(async () => ({})),
      delete: jest.fn(async () => ({})),
    },
    workspaceMember: {
      count: jest.fn(async () => options.otherWorkspaces ?? 0),
      findMany: jest.fn(async () => [{ workspaceId: 'w1', role: 'member' }]),
    },
  };
  const workspaceScm = {
    collaboratorUsername: jest.fn(async () => (options.linked === false ? null : 'bob-gh')),
    provider: jest.fn(() => github),
    githubProvider: jest.fn(() => github),
  };
  const service = new WorkspaceGitHubAccessService(prisma as never, workspaceScm as never);
  return { service, prisma, github };
}

describe('WorkspaceGitHubAccessService (ADR-189)', () => {
  const savedEdition = config.edition;
  beforeEach(() => {
    config.edition = 'saas';
  });
  afterEach(() => {
    config.edition = savedEdition;
  });

  it('invites a new member to the organization and grants the role on its repositories', async () => {
    const { service, prisma, github } = setup();

    await service.grant('w1', 'u2', 'maintainer');

    expect(github.organizationMembership).toHaveBeenCalledWith(
      expect.objectContaining({ accountLogin: 'acme' }),
      'bob-gh',
    );
    expect(github.inviteToOrganization).toHaveBeenCalledTimes(1);
    expect(prisma.gitHubOrgMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'u2',
          githubLogin: 'bob-gh',
          invitedByInitPad: true,
          state: 'pending',
        }),
      }),
    );
    expect(github.setCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/app' }),
      'bob-gh',
      'maintainer',
    );
  });

  it('never re-invites an existing organization member, so an owner is not demoted', async () => {
    const { service, prisma, github } = setup({
      orgMembership: { state: 'active', role: 'admin' },
    });

    await service.grant('w1', 'u2', 'member');

    expect(github.inviteToOrganization).not.toHaveBeenCalled();
    expect(prisma.gitHubOrgMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ invitedByInitPad: false, state: 'active' }),
      }),
    );
  });

  it('remembers that InitPad sent the invitation after the member accepted it', async () => {
    const { service, prisma } = setup({
      orgMembership: { state: 'active', role: 'member' },
      stored: [{ invitedByInitPad: true }],
    });

    await service.grant('w1', 'u2', 'member');

    expect(prisma.gitHubOrgMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ invitedByInitPad: true }) }),
    );
  });

  it('leaves a member without linked GitHub for later instead of failing', async () => {
    const { service, github } = setup({ linked: false });

    await expect(service.grant('w1', 'u2', 'member')).resolves.toBeUndefined();

    expect(github.organizationMembership).not.toHaveBeenCalled();
    expect(github.setCollaborator).not.toHaveBeenCalled();
  });

  it('asks the organization to approve the new permission instead of failing with 500', async () => {
    const { service } = setup({ tokenRefused: true });

    const failure = service.grant('w1', 'u2', 'member');

    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await expect(failure).rejects.toThrow("GitHub organization 'acme' (Members: read and write)");
  });

  it('removes from the organization only a member InitPad invited and nothing else still needs', async () => {
    const invited = setup({ stored: [{ invitedByInitPad: true }] });
    await invited.service.revoke('w1', 'u2');
    expect(invited.github.removeCollaborator).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/app' }),
      'bob-gh',
    );
    expect(invited.github.removeFromOrganization).toHaveBeenCalledWith(
      { id: ORG.id, accountLogin: 'acme' },
      'bob-gh',
    );
    expect(invited.prisma.gitHubOrgMembership.delete).toHaveBeenCalled();

    const preexisting = setup({ stored: [{ invitedByInitPad: false }] });
    await preexisting.service.revoke('w1', 'u2');
    expect(preexisting.github.removeFromOrganization).not.toHaveBeenCalled();
    expect(preexisting.prisma.gitHubOrgMembership.delete).toHaveBeenCalled();

    const sharedOrg = setup({ stored: [{ invitedByInitPad: true }], otherWorkspaces: 1 });
    await sharedOrg.service.revoke('w1', 'u2');
    expect(sharedOrg.github.removeFromOrganization).not.toHaveBeenCalled();
    expect(sharedOrg.prisma.gitHubOrgMembership.delete).not.toHaveBeenCalled();
  });

  it('still revokes by the stored login after the member unlinked GitHub', async () => {
    const { service, github } = setup({ linked: false, stored: [{ invitedByInitPad: true }] });

    await service.revoke('w1', 'u2');

    expect(github.removeCollaborator).toHaveBeenCalledWith(expect.anything(), 'bob-gh');
    expect(github.removeFromOrganization).toHaveBeenCalled();
  });

  it('refuses member changes while a team workspace still uses a personal account', async () => {
    const legacy = setup({ personalProjects: [{ scmInstallation: { accountLogin: 'kudrle01' } }] });
    await expect(legacy.service.assertTeamUsesOrganizations('w1')).rejects.toThrow(
      "still uses the personal GitHub account 'kudrle01'",
    );

    const personal = setup({
      workspaceType: 'personal',
      personalProjects: [{ scmInstallation: { accountLogin: 'kudrle01' } }],
    });
    await expect(personal.service.assertTeamUsesOrganizations('w1')).resolves.toBeUndefined();
  });

  it('grants access after GitHub is linked without failing the link', async () => {
    const ok = setup();
    await ok.service.syncForUser('u2');
    expect(ok.github.setCollaborator).toHaveBeenCalledWith(expect.anything(), 'bob-gh', 'member');

    const refused = setup({ tokenRefused: true });
    await expect(refused.service.syncForUser('u2')).resolves.toBeUndefined();
  });

  it('does nothing with GitHub on the self-hosted edition', async () => {
    config.edition = 'self-hosted';
    const { service, prisma } = setup({
      personalProjects: [{ scmInstallation: { accountLogin: 'kudrle01' } }],
    });

    await expect(service.assertTeamUsesOrganizations('w1')).resolves.toBeUndefined();
    await expect(service.memberStatus('w1', ['u2'])).resolves.toEqual(new Map());
    expect(prisma.gitHubOrgMembership.findMany).not.toHaveBeenCalled();
  });
});
