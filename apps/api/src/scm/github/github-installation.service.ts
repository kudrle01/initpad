import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GitHubAppService,
  InstallationToken,
  VerifiedGitHubInstallation,
} from './github-app.service';

const SETUP_TTL_MS = 10 * 60 * 1000;
const WORKSPACE_ADMINS = new Set(['owner', 'admin']);

// Shape of the parts of a GitHub `installation` webhook payload we consume.
export interface InstallationEvent {
  action?: string;
  installation?: {
    id?: number | string;
    account?: { id?: number | string; login?: string; type?: string };
    repository_selection?: string;
    suspended_at?: string | null;
  };
}

/**
 * Keeps GitHub App installations synchronized by their immutable GitHub
 * account id and owns the one-time setup handshake (ADR-044). A signed webhook
 * may discover an installation, but only a callback state initiated by a
 * workspace owner/admin grants that workspace access to it.
 */
@Injectable()
export class GitHubInstallationService {
  private readonly logger = new Logger('GitHubInstallationService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly app: GitHubAppService,
  ) {}

  async handleEvent(event: InstallationEvent): Promise<void> {
    const inst = event.installation;
    if (inst?.id == null || inst.account?.id == null || !inst.account.login) return;
    const installationId = String(inst.id);
    const accountId = String(inst.account.id);
    const existing = await this.prisma.gitHubInstallation.findUnique({ where: { installationId } });
    if (existing?.accountId && existing.accountId !== accountId) {
      throw new ConflictException(
        `GitHub installation '${installationId}' changed immutable account identity`,
      );
    }

    if (event.action === 'deleted') {
      await this.prisma.gitHubInstallation.updateMany({
        where: { installationId, OR: [{ accountId }, { accountId: null }] },
        data: { accountId, accountLogin: inst.account.login, deletedAt: new Date() },
      });
      this.logger.log(`GitHub App uninstalled for ${inst.account.login}`);
      return;
    }

    const suspendedAt =
      event.action === 'suspend'
        ? new Date()
        : event.action === 'unsuspend'
          ? null
          : inst.suspended_at
            ? new Date(inst.suspended_at)
            : null;
    const data = {
      accountId,
      accountLogin: inst.account.login,
      accountType: inst.account.type ?? 'User',
      repositorySelection: inst.repository_selection ?? 'selected',
      suspendedAt,
      deletedAt: null,
    };
    await this.prisma.gitHubInstallation.upsert({
      where: { installationId },
      create: { installationId, ...data },
      update: data,
    });
    this.logger.log(`GitHub App installation ${event.action ?? 'synced'} for ${inst.account.login}`);
  }

  /** Creates a hashed, single-use state bound to the current user/workspace. */
  async createSetup(userId: string, workspaceId: string): Promise<string> {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_userId: { provider: 'github', userId } },
      select: { id: true },
    });
    if (!identity) {
      throw new BadRequestException('Link your GitHub account before installing the GitHub App');
    }
    const now = new Date();
    await this.prisma.gitHubInstallationSetup.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }] },
    });
    const state = randomBytes(32).toString('base64url');
    await this.prisma.gitHubInstallationSetup.create({
      data: {
        tokenHash: this.hashState(state),
        userId,
        workspaceId,
        expiresAt: new Date(now.getTime() + SETUP_TTL_MS),
      },
    });
    return state;
  }

  /**
   * Validates the one-time state and resolves callback data through the App
   * API without consuming the state. Organization callbacks use this before
   * starting their additional user-authorization round trip.
   */
  async inspectSetup(
    state: string,
    installationId: string,
  ): Promise<VerifiedGitHubInstallation> {
    return (await this.loadSetupCandidate(state, installationId)).verified;
  }

  /**
   * Verifies an untrusted callback against GitHub, consumes its state exactly
   * once, re-checks current workspace authority and grants installation access.
   */
  async completeSetup(
    state: string,
    installationId: string,
    userAccessToken?: string,
  ): Promise<VerifiedGitHubInstallation> {
    const { setup, verified } = await this.loadSetupCandidate(state, installationId);
    const now = new Date();

    const [identity, membership] = await Promise.all([
      this.prisma.externalIdentity.findUnique({
        where: { provider_userId: { provider: 'github', userId: setup.userId } },
        select: { providerUserId: true },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: setup.workspaceId, userId: setup.userId } },
        select: { role: true },
      }),
    ]);
    if (!identity) throw new ForbiddenException('The GitHub identity used for setup is no longer linked');
    if (!membership || !WORKSPACE_ADMINS.has(membership.role)) {
      throw new ForbiddenException('Workspace admin access is required to finish GitHub setup');
    }
    // For personal GitHub accounts we can prove that the installer and target
    // are the same immutable account. Organization installs are authorized by
    // GitHub's own installation UI and the bound one-time workspace state.
    if (verified.accountType === 'User' && identity.providerUserId !== verified.accountId) {
      throw new ForbiddenException('The installed GitHub account does not match your linked identity');
    }
    if (verified.accountType === 'Organization') {
      if (!userAccessToken) {
        throw new ForbiddenException('GitHub user authorization is required for an organization installation');
      }
      try {
        const accessible = await this.app.getUserAccessibleInstallation(
          userAccessToken,
          verified.installationId,
          identity.providerUserId,
        );
        if (
          accessible.installationId !== verified.installationId ||
          accessible.accountId !== verified.accountId ||
          accessible.accountType !== 'Organization'
        ) {
          throw new Error('GitHub returned a different user-accessible installation identity');
        }
      } catch {
        throw new ForbiddenException(
          'Your linked GitHub account cannot authorize this organization installation',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.gitHubInstallationSetup.updateMany({
        where: { id: setup.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('GitHub setup state was already used');
      }

      await this.bindVerifiedInstallation(tx, verified, setup.userId, setup.workspaceId);
    });
    return verified;
  }

  /**
   * Recovers a personal-account install when GitHub completed the installation
   * but did not return through the configured Setup URL. Recovery is deliberately
   * restricted to `User` installations: the linked identity's immutable GitHub
   * id proves ownership. Organization installations still require the verified
   * callback because a member's identity alone does not prove org authority.
   */
  async recoverPersonalSetup(
    userId: string,
    workspaceId: string,
  ): Promise<VerifiedGitHubInstallation | null> {
    const now = new Date();
    const [setup, identity, membership] = await Promise.all([
      this.prisma.gitHubInstallationSetup.findFirst({
        where: { userId, workspaceId, usedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.externalIdentity.findUnique({
        where: { provider_userId: { provider: 'github', userId } },
        select: { providerUserId: true },
      }),
      this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      }),
    ]);
    if (!setup || !identity) return null;
    if (!membership || !WORKSPACE_ADMINS.has(membership.role)) {
      throw new ForbiddenException('Workspace admin access is required to finish GitHub setup');
    }

    const verified = (await this.app.listInstallations()).find(
      (installation) =>
        installation.accountType === 'User' &&
        installation.accountId === identity.providerUserId &&
        installation.suspendedAt === null,
    );
    if (!verified) return null;

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.gitHubInstallationSetup.updateMany({
        where: { id: setup.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      await this.bindVerifiedInstallation(tx, verified, userId, workspaceId);
      return verified;
    });
  }

  listForWorkspace(workspaceId: string) {
    return this.prisma.gitHubInstallationAccess.findMany({
      where: { workspaceId, githubInstallation: { deletedAt: null } },
      include: { githubInstallation: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  findByOwner(login: string) {
    return this.prisma.gitHubInstallation.findFirst({
      where: { accountLogin: login, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.gitHubInstallation.findUnique({ where: { id } });
  }

  /** Mints a token through the installation row permanently bound to a project. */
  async tokenForBinding(
    id: string,
    options?: { repositoryIds?: number[]; permissions?: Record<string, string> },
  ): Promise<InstallationToken> {
    const installation = await this.findById(id);
    if (!installation) throw new Error(`GitHub App installation binding '${id}' no longer exists`);
    if (installation.deletedAt) {
      throw new Error(`The GitHub App installation for '${installation.accountLogin}' was removed`);
    }
    if (installation.suspendedAt) {
      throw new Error(`The GitHub App installation for '${installation.accountLogin}' is suspended`);
    }
    return this.app.createInstallationToken(installation.installationId, options);
  }

  /** Legacy owner lookup; new project flows use explicit workspace bindings. */
  async tokenForOwner(
    login: string,
    options?: { repositoryIds?: number[]; permissions?: Record<string, string> },
  ): Promise<InstallationToken> {
    const installation = await this.findByOwner(login);
    if (!installation) throw new Error(`No GitHub App installation found for '${login}'`);
    if (installation.suspendedAt) throw new Error(`The GitHub App installation for '${login}' is suspended`);
    return this.app.createInstallationToken(installation.installationId, options);
  }

  private hashState(state: string): string {
    return createHash('sha256').update(state).digest('hex');
  }

  private async loadSetupCandidate(state: string, installationId: string) {
    if (!state || !installationId) {
      throw new BadRequestException('Incomplete GitHub setup callback');
    }
    const setup = await this.prisma.gitHubInstallationSetup.findUnique({
      where: { tokenHash: this.hashState(state) },
    });
    if (!setup || setup.usedAt || setup.expiresAt <= new Date()) {
      throw new BadRequestException('GitHub setup state is invalid, expired, or already used');
    }
    // Never trust installation_id/account data from the browser redirect.
    const verified = await this.app.getInstallation(installationId);
    if (verified.installationId !== String(installationId)) {
      throw new BadRequestException('GitHub returned a different installation identity');
    }
    return { setup, verified };
  }

  private async bindVerifiedInstallation(
    tx: Prisma.TransactionClient,
    verified: VerifiedGitHubInstallation,
    authorizedById: string,
    workspaceId: string,
  ): Promise<void> {
    const existing = await tx.gitHubInstallation.findUnique({
      where: { installationId: verified.installationId },
    });
    if (existing?.accountId && existing.accountId !== verified.accountId) {
      throw new ConflictException(
        `GitHub installation '${verified.installationId}' changed immutable account identity`,
      );
    }
    const installation = await tx.gitHubInstallation.upsert({
      where: { installationId: verified.installationId },
      create: {
        installationId: verified.installationId,
        accountId: verified.accountId,
        accountLogin: verified.accountLogin,
        accountType: verified.accountType,
        repositorySelection: verified.repositorySelection,
        suspendedAt: verified.suspendedAt,
      },
      update: {
        accountId: verified.accountId,
        accountLogin: verified.accountLogin,
        accountType: verified.accountType,
        repositorySelection: verified.repositorySelection,
        suspendedAt: verified.suspendedAt,
        deletedAt: null,
      },
    });
    await tx.gitHubInstallationAccess.upsert({
      where: {
        githubInstallationId_workspaceId: {
          githubInstallationId: installation.id,
          workspaceId,
        },
      },
      create: {
        githubInstallationId: installation.id,
        workspaceId,
        authorizedById,
      },
      update: { authorizedById },
    });
  }
}
