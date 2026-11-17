import { ConflictException, Logger } from '@nestjs/common';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { repositoryRef, type ScmRepositoryRef } from '../scm/scm-provider';
import { ScmHttpStatusError } from '../scm/scm-http';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import type { GitHubOrganizationInstallation } from '../scm/github/github-scm.provider';

export interface MemberGitHubStatus {
  linked: boolean;
  organizations: Array<{ login: string; state: 'pending' | 'active' }>;
}

/** Repositories live on GitHub only in the hosted edition; self-hosted uses Gitea. */
function githubEdition(): boolean {
  return config.edition === 'saas';
}

const PROJECT_REPOSITORY_SELECT = {
  scmProvider: true,
  scmRepositoryId: true,
  scmOwner: true,
  scmRepositoryName: true,
  scmFullName: true,
  scmDefaultBranch: true,
  scmInstallationId: true,
  repoUrl: true,
  scmInstallation: { select: { id: true, accountLogin: true, accountType: true } },
} as const;

/**
 * Keeps a workspace member's access on the repository host in step with their
 * workspace role (ADR-189). In a team workspace backed by a GitHub
 * organization this means membership in that organization plus a per-
 * repository permission. A member who has not linked GitHub keeps their
 * workspace role and receives repository access when they link it.
 */
export class WorkspaceGitHubAccessService {
  private readonly logger = new Logger('WorkspaceGitHubAccess');

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
  ) {}

  /**
   * Personal GitHub accounts that still hold repositories of a team workspace.
   * A personal repository has no read-only or maintain permission, so member
   * access there cannot follow workspace roles.
   */
  async personalAccountsInTeam(workspaceId: string): Promise<string[]> {
    if (!githubEdition()) return [];
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { type: true },
    });
    if (workspace?.type !== 'team') return [];
    const projects = await this.prisma.project.findMany({
      where: { workspaceId, scmProvider: 'github', scmInstallation: { accountType: 'User' } },
      select: { scmInstallation: { select: { accountLogin: true } } },
    });
    return [...new Set(projects.flatMap((project) => project.scmInstallation?.accountLogin ?? []))];
  }

  /** Refuses a member change that GitHub could not mirror (ADR-189). */
  async assertTeamUsesOrganizations(workspaceId: string): Promise<void> {
    const [account] = await this.personalAccountsInTeam(workspaceId);
    if (account) {
      throw new ConflictException(
        `This team workspace still uses the personal GitHub account '${account}'. Connect a GitHub organization to change member access.`,
      );
    }
  }

  /** Grants or changes the member's access to every repository of the workspace. */
  async grant(workspaceId: string, userId: string, role: string): Promise<void> {
    const ensured = new Set<string>();
    for (const project of await this.projects(workspaceId)) {
      const repository = repositoryRef(project);
      const username = await this.workspaceScm.collaboratorUsername(userId, repository.provider);
      if (!username) continue;
      const installation = project.scmInstallation;
      if (
        repository.provider === 'github' &&
        installation?.accountType === 'Organization' &&
        !ensured.has(installation.id)
      ) {
        await this.ensureOrganizationMembership(installation, userId);
        ensured.add(installation.id);
      }
      await this.workspaceScm
        .provider(repository.provider)
        .setCollaborator(repository, username, role);
    }
  }

  /**
   * Removes the member's repository access and, where InitPad invited them and
   * no other workspace of theirs uses the same organization, their membership
   * in the organization.
   */
  async revoke(workspaceId: string, userId: string): Promise<void> {
    const projects = await this.projects(workspaceId);
    const memberships = githubEdition()
      ? await this.prisma.gitHubOrgMembership.findMany({
          where: {
            userId,
            githubInstallation: { accesses: { some: { workspaceId } } },
          },
          include: { githubInstallation: { select: { id: true, accountLogin: true } } },
        })
      : [];
    for (const project of projects) {
      const repository = repositoryRef(project);
      const username =
        (await this.workspaceScm.collaboratorUsername(userId, repository.provider)) ??
        memberships.find((row) => row.githubInstallationId === project.scmInstallationId)
          ?.githubLogin;
      if (!username) continue;
      await this.workspaceScm
        .provider(repository.provider)
        .removeCollaborator(repository, username);
    }
    for (const membership of memberships) {
      const stillNeeded = await this.prisma.workspaceMember.count({
        where: {
          userId,
          workspaceId: { not: workspaceId },
          workspace: {
            githubInstallationAccesses: {
              some: { githubInstallationId: membership.githubInstallationId },
            },
          },
        },
      });
      if (stillNeeded > 0) continue;
      if (membership.invitedByInitPad) {
        await this.organizationCall(membership.githubInstallation, () =>
          this.workspaceScm
            .githubProvider()
            .removeFromOrganization(membership.githubInstallation, membership.githubLogin),
        );
      }
      await this.prisma.gitHubOrgMembership.delete({ where: { id: membership.id } });
    }
  }

  /**
   * Releases the organization memberships a workspace created when it stops
   * using an installation. A member InitPad invited leaves the organization
   * unless another workspace of theirs still uses it; a member who was there
   * before stays. Best effort: disconnecting never fails on GitHub, so a
   * refused removal is logged and the member stays in the organization.
   */
  async releaseInstallation(workspaceId: string, installationId: string): Promise<void> {
    if (!githubEdition()) return;
    const memberships = await this.prisma.gitHubOrgMembership.findMany({
      where: {
        githubInstallationId: installationId,
        user: { memberships: { some: { workspaceId } } },
      },
      include: { githubInstallation: { select: { id: true, accountLogin: true } } },
    });
    for (const membership of memberships) {
      const stillNeeded = await this.prisma.workspaceMember.count({
        where: {
          userId: membership.userId,
          workspaceId: { not: workspaceId },
          workspace: {
            githubInstallationAccesses: { some: { githubInstallationId: installationId } },
          },
        },
      });
      if (stillNeeded > 0) continue;
      if (membership.invitedByInitPad) {
        try {
          await this.workspaceScm
            .githubProvider()
            .removeFromOrganization(membership.githubInstallation, membership.githubLogin);
        } catch (error) {
          this.logger.warn({
            event: 'workspace.github_access.release_failed',
            workspaceId,
            userId: membership.userId,
            organization: membership.githubInstallation.accountLogin,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            detail: error instanceof ScmHttpStatusError ? (error.detail ?? null) : null,
          });
          continue;
        }
      }
      await this.prisma.gitHubOrgMembership.delete({ where: { id: membership.id } });
    }
  }

  /**
   * Makes the user a member of the organization. A user GitHub already lists
   * (as member, owner or pending invitee) is left untouched: inviting with the
   * `member` role would demote an owner.
   */
  async ensureOrganizationMembership(
    installation: GitHubOrganizationInstallation,
    userId: string,
  ): Promise<void> {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_userId: { provider: 'github', userId } },
      select: { providerUserId: true, username: true },
    });
    if (!identity?.username) return;
    const github = this.workspaceScm.githubProvider();
    const existing = await this.prisma.gitHubOrgMembership.findUnique({
      where: { githubInstallationId_userId: { githubInstallationId: installation.id, userId } },
      select: { invitedByInitPad: true },
    });
    const current = await this.organizationCall(installation, () =>
      github.organizationMembership(installation, identity.username!),
    );
    const invited = current
      ? null
      : await this.organizationCall(installation, () =>
          github.inviteToOrganization(installation, identity.username!),
        );
    const data = {
      githubUserId: identity.providerUserId,
      githubLogin: identity.username,
      invitedByInitPad: invited !== null || (existing?.invitedByInitPad ?? false),
      state: (current ?? invited)!.state,
    };
    await this.prisma.gitHubOrgMembership.upsert({
      where: { githubInstallationId_userId: { githubInstallationId: installation.id, userId } },
      create: { githubInstallationId: installation.id, userId, ...data },
      update: data,
    });
  }

  /** Before a repository grant: makes the member part of the repository's organization. */
  async ensureRepositoryOrganization(
    repository: Pick<ScmRepositoryRef, 'provider' | 'installationId'>,
    userId: string,
  ): Promise<void> {
    if (repository.provider !== 'github' || !repository.installationId) return;
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { id: repository.installationId },
      select: { id: true, accountLogin: true, accountType: true },
    });
    if (installation?.accountType !== 'Organization') return;
    await this.ensureOrganizationMembership(installation, userId);
  }

  /**
   * Grants repository access in every team workspace of a user who has just
   * linked GitHub. Best effort: linking never fails because of a workspace, and
   * an admin can retry by changing the member's role.
   */
  async syncForUser(userId: string): Promise<void> {
    if (!githubEdition()) return;
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { type: 'team' } },
      select: { workspaceId: true, role: true },
    });
    for (const membership of memberships) {
      try {
        if ((await this.personalAccountsInTeam(membership.workspaceId)).length > 0) continue;
        await this.grant(membership.workspaceId, userId, membership.role);
      } catch (error) {
        this.logger.warn({
          event: 'workspace.github_access.sync_failed',
          workspaceId: membership.workspaceId,
          userId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          detail: error instanceof ScmHttpStatusError ? (error.detail ?? null) : null,
        });
      }
    }
  }

  /**
   * Whether each member linked GitHub and where they stand in the workspace's
   * organizations. Empty on the self-hosted edition, whose repositories live in
   * Gitea and need no GitHub account.
   */
  async memberStatus(
    workspaceId: string,
    userIds: string[],
  ): Promise<Map<string, MemberGitHubStatus>> {
    if (!githubEdition()) return new Map();
    const [identities, memberships] = await Promise.all([
      this.prisma.externalIdentity.findMany({
        where: { provider: 'github', userId: { in: userIds } },
        select: { userId: true },
      }),
      this.prisma.gitHubOrgMembership.findMany({
        where: {
          userId: { in: userIds },
          githubInstallation: { accesses: { some: { workspaceId } } },
        },
        select: {
          userId: true,
          state: true,
          githubInstallation: { select: { accountLogin: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const linked = new Set(identities.map((identity) => identity.userId));
    return new Map(
      userIds.map((userId) => [
        userId,
        {
          linked: linked.has(userId),
          organizations: memberships
            .filter((row) => row.userId === userId)
            .map((row) => ({
              login: row.githubInstallation.accountLogin,
              state: row.state === 'active' ? ('active' as const) : ('pending' as const),
            })),
        },
      ]),
    );
  }

  private projects(workspaceId: string) {
    return this.prisma.project.findMany({
      where: { workspaceId },
      select: PROJECT_REPOSITORY_SELECT,
    });
  }

  /**
   * An organization installed before ADR-189 has not approved the "Members"
   * permission, so GitHub refuses the token. That is a setup step for an
   * organization owner, not an outage, and the answer says what to approve.
   */
  private async organizationCall<T>(
    installation: GitHubOrganizationInstallation,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const missingPermission =
        error instanceof ScmHttpStatusError &&
        ((error.operation === 'mint installation token' && error.status === 422) ||
          error.status === 403);
      if (!missingPermission) throw error;
      throw new ConflictException(
        `Approve the updated InitPad app permissions in the GitHub organization '${installation.accountLogin}' (Members: read and write), then try again.`,
      );
    }
  }
}
