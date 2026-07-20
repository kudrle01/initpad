import { Injectable } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '../../common/secret';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubOAuthExchange, GitHubOAuthService, GitHubUserTokenSet } from './github-oauth.service';

const REFRESH_BEFORE_MS = 60_000;
const REFRESH_LEASE_MS = 30_000;
const REFRESH_WAIT_ATTEMPTS = 5;

export class GitHubReauthorizationRequiredError extends Error {
  constructor() {
    super('GitHub authorization must be renewed');
    this.name = 'GitHubReauthorizationRequiredError';
  }
}

export class GitHubCredentialRefreshInProgressError extends Error {
  constructor() {
    super('GitHub authorization is being refreshed; retry the operation');
    this.name = 'GitHubCredentialRefreshInProgressError';
  }
}

/**
 * Encrypted, rotatable GitHub App user-token vault (ADR-045).
 *
 * Identity data remains usable without credentials. Tokens are encrypted
 * independently at rest, never returned through identity APIs and are used
 * only server-side for operations that cannot use an installation token.
 */
@Injectable()
export class GitHubUserCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: GitHubOAuthService,
  ) {}

  /** Stores the token pair only after immutable identity matching succeeds. */
  async storeExchange(userId: string, exchange: GitHubOAuthExchange): Promise<void> {
    const updated = await this.prisma.externalIdentity.updateMany({
      where: {
        userId,
        provider: 'github',
        providerUserId: exchange.user.providerUserId,
      },
      data: {
        ...this.encrypted(exchange.token),
        credentialVersion: { increment: 1 },
        credentialRefreshingAt: null,
      },
    });
    if (updated.count !== 1) throw new GitHubReauthorizationRequiredError();
  }

  /** Returns a valid token, rotating it once under a database-backed lease. */
  async accessTokenForUser(userId: string): Promise<string> {
    for (let attempt = 0; attempt < REFRESH_WAIT_ATTEMPTS; attempt++) {
      const identity = await this.prisma.externalIdentity.findUnique({
        where: { provider_userId: { provider: 'github', userId } },
      });
      if (!identity?.accessTokenEncrypted) throw new GitHubReauthorizationRequiredError();

      const accessToken = decryptSecret(identity.accessTokenEncrypted);
      if (!accessToken) {
        await this.clearVersion(identity.id, identity.credentialVersion);
        throw new GitHubReauthorizationRequiredError();
      }
      if (
        !identity.accessTokenExpiresAt ||
        identity.accessTokenExpiresAt.getTime() > Date.now() + REFRESH_BEFORE_MS
      ) {
        return accessToken;
      }

      if (
        !identity.refreshTokenEncrypted ||
        !identity.refreshTokenExpiresAt ||
        identity.refreshTokenExpiresAt.getTime() <= Date.now()
      ) {
        await this.clearVersion(identity.id, identity.credentialVersion);
        throw new GitHubReauthorizationRequiredError();
      }

      const claimTime = new Date();
      const claimed = await this.prisma.externalIdentity.updateMany({
        where: {
          id: identity.id,
          credentialVersion: identity.credentialVersion,
          OR: [
            { credentialRefreshingAt: null },
            { credentialRefreshingAt: { lt: new Date(Date.now() - REFRESH_LEASE_MS) } },
          ],
        },
        data: { credentialRefreshingAt: claimTime },
      });
      if (claimed.count !== 1) {
        await this.waitForPeer(attempt);
        continue;
      }

      const refreshToken = decryptSecret(identity.refreshTokenEncrypted);
      if (!refreshToken) {
        await this.clearVersion(identity.id, identity.credentialVersion);
        throw new GitHubReauthorizationRequiredError();
      }

      try {
        const token = await this.oauth.refreshUserToken(refreshToken);
        const stored = await this.prisma.externalIdentity.updateMany({
          where: {
            id: identity.id,
            credentialVersion: identity.credentialVersion,
            credentialRefreshingAt: claimTime,
          },
          data: {
            ...this.encrypted(token),
            credentialVersion: { increment: 1 },
            credentialRefreshingAt: null,
          },
        });
        if (stored.count !== 1) throw new GitHubCredentialRefreshInProgressError();
        return token.accessToken;
      } catch (error) {
        await this.prisma.externalIdentity.updateMany({
          where: {
            id: identity.id,
            credentialVersion: identity.credentialVersion,
            credentialRefreshingAt: claimTime,
          },
          data: { credentialRefreshingAt: null },
        });
        throw error;
      }
    }
    throw new GitHubCredentialRefreshInProgressError();
  }

  /** GitHub tells us immutable sender.id when App authorization is revoked. */
  async revokeByProviderUserId(providerUserId: string): Promise<void> {
    await this.prisma.externalIdentity.updateMany({
      where: { provider: 'github', providerUserId },
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        refreshTokenEncrypted: null,
        refreshTokenExpiresAt: null,
        credentialVersion: { increment: 1 },
        credentialRefreshingAt: null,
      },
    });
  }

  private encrypted(token: GitHubUserTokenSet) {
    return {
      accessTokenEncrypted: encryptSecret(token.accessToken),
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshTokenEncrypted: token.refreshToken ? encryptSecret(token.refreshToken) : null,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    };
  }

  private async clearVersion(id: string, credentialVersion: number): Promise<void> {
    await this.prisma.externalIdentity.updateMany({
      where: { id, credentialVersion },
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        refreshTokenEncrypted: null,
        refreshTokenExpiresAt: null,
        credentialVersion: { increment: 1 },
        credentialRefreshingAt: null,
      },
    });
  }

  private async waitForPeer(attempt: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
  }
}
