import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';

export type ScmProviderKind = 'github' | 'gitlab';

export interface LinkedIdentity {
  provider: string;
  providerUserId: string;
  username: string | null;
  linkedAt: string;
  canUnlink: boolean;
}

/**
 * Links external SCM accounts (GitHub, later GitLab) to InitPad users by the
 * provider's IMMUTABLE user id (ADR-030/039). A matching e-mail is never used
 * to associate or merge accounts. One provider account maps to at most one
 * InitPad user, and one InitPad user links at most one account per provider —
 * both enforced by unique constraints and re-checked here for clear errors.
 */
@Injectable()
export class ExternalIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The InitPad user linked to an external account, resolved solely by the
   * immutable provider id. Used by "Sign in with GitHub"; returns null when the
   * account has never been linked (login alone must not create a link).
   */
  async findUser(provider: ScmProviderKind, providerUserId: string) {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
      include: { user: true },
    });
    return identity?.user ?? null;
  }

  async listForUser(userId: string): Promise<LinkedIdentity[]> {
    const [rows, user] = await Promise.all([
      this.prisma.externalIdentity.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: PASSWORD_SELECT }),
    ]);
    const hasUsablePassword = passwordSignInUsable(user);
    const canUnlink = hasUsablePassword || rows.length > 1;
    return rows.map((r) => ({
      provider: r.provider,
      providerUserId: r.providerUserId,
      username: r.username,
      linkedAt: r.createdAt.toISOString(),
      canUnlink,
    }));
  }

  /** Link an external account to an existing signed-in user, by immutable id. */
  async link(
    userId: string,
    provider: ScmProviderKind,
    providerUserId: string,
    username: string | null,
  ) {
    const existing = await this.prisma.externalIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictException(
          `This ${provider} account is already linked to another InitPad user`,
        );
      }
      // Idempotent re-link — refresh only the mutable display login.
      return this.prisma.externalIdentity.update({
        where: { id: existing.id },
        data: { username },
      });
    }
    const already = await this.prisma.externalIdentity.findUnique({
      where: { provider_userId: { provider, userId } },
    });
    if (already) {
      throw new ConflictException(`Your account is already linked to a ${provider} identity`);
    }
    return this.prisma.externalIdentity.create({
      data: { userId, provider, providerUserId, username },
    });
  }

  async unlink(userId: string, provider: ScmProviderKind): Promise<void> {
    const [identity, user, identityCount] = await Promise.all([
      this.prisma.externalIdentity.findUnique({
        where: { provider_userId: { provider, userId } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: PASSWORD_SELECT }),
      this.prisma.externalIdentity.count({ where: { userId } }),
    ]);
    if (!identity) return;
    const hasUsablePassword = passwordSignInUsable(user);
    if (!hasUsablePassword && identityCount <= 1) {
      throw new BadRequestException(
        `You cannot unlink your only sign-in method. Add another identity first.`,
      );
    }
    await this.prisma.externalIdentity.deleteMany({ where: { userId, provider } });
  }
}

const PASSWORD_SELECT = { passwordHash: true, emailVerifiedAt: true } as const;

/**
 * Whether a stored password still signs the account in. SaaS accepts a
 * password only with a confirmed e-mail (ADR-188), so an unconfirmed password
 * must never count as a fallback that would let GitHub be unlinked.
 */
function passwordSignInUsable(
  user: { passwordHash: string | null; emailVerifiedAt: Date | null } | null,
): boolean {
  if (!user?.passwordHash) return false;
  return config.edition === 'self-hosted' || user.emailVerifiedAt != null;
}
