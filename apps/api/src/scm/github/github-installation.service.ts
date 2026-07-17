import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubAppService, InstallationToken } from './github-app.service';

// Shape of the parts of a GitHub `installation` webhook payload we consume.
export interface InstallationEvent {
  action?: string;
  installation?: {
    id?: number | string;
    account?: { login?: string; type?: string };
    repository_selection?: string;
    suspended_at?: string | null;
  };
}

/**
 * Keeps GitHub App installation records in sync from webhooks and resolves the
 * installation for a repository owner so automation can mint a short-lived,
 * scoped token (ADR-030). This is the trust binding between a linked identity
 * and actual repository access; without a matching installation, create/import
 * is refused.
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
    if (!inst?.id || !inst.account?.login) return;
    const installationId = String(inst.id);

    if (event.action === 'deleted') {
      await this.prisma.gitHubInstallation.deleteMany({ where: { installationId } });
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
      accountLogin: inst.account.login,
      accountType: inst.account.type ?? 'User',
      repositorySelection: inst.repository_selection ?? 'selected',
      suspendedAt,
    };
    await this.prisma.gitHubInstallation.upsert({
      where: { installationId },
      create: { installationId, ...data },
      update: data,
    });
    this.logger.log(`GitHub App installation ${event.action ?? 'synced'} for ${inst.account.login}`);
  }

  findByOwner(login: string) {
    return this.prisma.gitHubInstallation.findFirst({ where: { accountLogin: login } });
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
    if (installation.suspendedAt) {
      throw new Error(`The GitHub App installation for '${installation.accountLogin}' is suspended`);
    }
    return this.app.createInstallationToken(installation.installationId, options);
  }

  /** Resolves the owner's installation and mints a short-lived scoped token. */
  async tokenForOwner(
    login: string,
    options?: { repositoryIds?: number[]; permissions?: Record<string, string> },
  ): Promise<InstallationToken> {
    const installation = await this.findByOwner(login);
    if (!installation) throw new Error(`No GitHub App installation found for '${login}'`);
    if (installation.suspendedAt) throw new Error(`The GitHub App installation for '${login}' is suspended`);
    return this.app.createInstallationToken(
      installation.installationId,
      options,
    );
  }
}
