import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { decryptSecret } from '../common/secret';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ScmActor, ScmKind, ScmProvisionTarget, ScmRepo, ScmRepositoryRef } from './scm-provider';
import { ScmRegistry } from './github/scm-registry';

/**
 * Resolves edition, workspace installation grants and provider identities at
 * the SCM boundary. Callers never trust an installation id supplied by the
 * browser without verifying its grant to the active workspace.
 */
@Injectable()
export class WorkspaceScmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ScmRegistry,
  ) {}

  kindForEdition(): ScmKind {
    return config.edition === 'saas' ? 'github' : 'gitea';
  }

  provider(kind: ScmKind) {
    return this.registry.for(kind);
  }

  async createContext(
    userId: string,
    workspaceId: string,
    requestedInstallationId?: string,
  ): Promise<{ kind: ScmKind; actor: ScmActor; target?: ScmProvisionTarget }> {
    const kind = this.kindForEdition();
    if (kind === 'gitea') {
      return { kind, actor: await this.actorFor(userId, kind) };
    }
    if (!requestedInstallationId) {
      throw new BadRequestException('Choose a GitHub account or organization for the repository');
    }
    const access = await this.prisma.gitHubInstallationAccess.findUnique({
      where: {
        githubInstallationId_workspaceId: {
          githubInstallationId: requestedInstallationId,
          workspaceId,
        },
      },
      include: { githubInstallation: true },
    });
    const installation = access?.githubInstallation;
    if (!installation || installation.deletedAt) {
      throw new BadRequestException(
        'The selected GitHub App installation is not authorized for this workspace',
      );
    }
    if (installation.suspendedAt) {
      throw new BadRequestException(
        `The GitHub App installation for '${installation.accountLogin}' is suspended`,
      );
    }
    if (installation.accountType === 'User') {
      const identity = await this.prisma.externalIdentity.findUnique({
        where: { provider_userId: { provider: 'github', userId } },
        select: { providerUserId: true },
      });
      if (!identity || identity.providerUserId !== installation.accountId) {
        throw new BadRequestException(
          `Only the owner of the personal GitHub account '${installation.accountLogin}' can create repositories there`,
        );
      }
    }
    return {
      kind,
      actor: {
        username: installation.accountLogin,
        token: '',
        installationId: installation.id,
      },
      target: { userId, installationId: installation.id },
    };
  }

  async listRepositories(userId: string, workspaceId: string): Promise<ScmRepo[]> {
    const kind = this.kindForEdition();
    if (kind === 'gitea') {
      return this.provider(kind).listRepositories(await this.actorFor(userId, kind));
    }
    const accesses = await this.prisma.gitHubInstallationAccess.findMany({
      where: {
        workspaceId,
        githubInstallation: { deletedAt: null, suspendedAt: null },
      },
      include: { githubInstallation: true },
      orderBy: { createdAt: 'asc' },
    });
    const listed = await Promise.all(
      accesses.map(({ githubInstallation: installation }) =>
        this.provider('github').listRepositories({
          username: installation.accountLogin,
          token: '',
          installationId: installation.id,
        }),
      ),
    );
    // A repository id is immutable and globally unique within a provider. A
    // dedupe also handles overlapping App grants without duplicate UI rows.
    return Array.from(
      new Map(listed.flat().map((repository) => [repository.repositoryId, repository])).values(),
    );
  }

  async repository(
    userId: string,
    workspaceId: string,
    repositoryId: string,
  ): Promise<{ repo: ScmRepo; actor: ScmActor }> {
    const repo = (await this.listRepositories(userId, workspaceId)).find(
      (candidate) => candidate.repositoryId === repositoryId,
    );
    if (!repo) throw new NotFoundException(`Repository '${repositoryId}' not found`);
    return {
      repo,
      actor: await this.actorFor(
        userId,
        repo.provider,
        repo.installationId ?? undefined,
        repo.owner,
      ),
    };
  }

  async actorFor(
    userId: string,
    kind: ScmKind,
    installationId?: string,
    owner?: string,
  ): Promise<ScmActor> {
    if (kind === 'gitea') {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      return { username: user.username, token: decryptSecret(user.accessToken) };
    }
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_userId: { provider: 'github', userId } },
      select: { username: true },
    });
    return {
      username: owner || identity?.username || '',
      token: '',
      installationId,
    };
  }

  async actorForRepository(userId: string, repository: ScmRepositoryRef): Promise<ScmActor> {
    return this.actorFor(
      userId,
      repository.provider,
      repository.installationId ?? undefined,
      repository.owner,
    );
  }

  async collaboratorUsername(userId: string, kind: ScmKind): Promise<string> {
    if (kind === 'gitea') {
      return (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).username;
    }
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_userId: { provider: 'github', userId } },
      select: { username: true },
    });
    if (!identity?.username) {
      throw new BadRequestException(
        'Every workspace member must link GitHub before receiving repository access',
      );
    }
    return identity.username;
  }
}
