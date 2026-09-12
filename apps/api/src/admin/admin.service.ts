import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { GiteaService } from '../scm/gitea.service';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import { CreateUserDto } from './dto/create-user.dto';

export interface AdminUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  platformRole: 'admin' | 'user';
  active: boolean;
  mustChangePassword: boolean;
  emailVerified: boolean;
  createdAt: string;
}

type UserRow = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  platformRole: string;
  active: boolean;
  mustChangePassword: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

function toAdminUser(u: UserRow): AdminUser {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    platformRole: u.platformRole === 'admin' ? 'admin' : 'user',
    active: u.active,
    mustChangePassword: u.mustChangePassword,
    emailVerified: u.emailVerifiedAt !== null,
    createdAt: u.createdAt.toISOString(),
  };
}

const USER_SELECT = {
  id: true,
  username: true,
  name: true,
  email: true,
  platformRole: true,
  active: true,
  mustChangePassword: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

/**
 * Instance administration for the self-hosted edition (ADR-040): list, create,
 * deactivate/reactivate and reset users. Creation and reset return a random
 * one-time password shown to the administrator once; only its hash is stored
 * and the account is forced to change it before doing anything else.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly gitea: GiteaService,
  ) {}

  async listUsers(): Promise<AdminUser[]> {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: USER_SELECT,
    });
    return rows.map(toAdminUser);
  }

  async createUser(
    dto: CreateUserDto,
  ): Promise<{ user: AdminUser; temporaryPassword: string; activationUrl: string }> {
    const temporaryPassword = generateTemporaryPassword();
    const user = await this.auth.provisionManagedUser({
      username: dto.username,
      email: dto.email,
      name: dto.name ?? null,
      password: temporaryPassword,
      platformRole: dto.platformRole ?? 'user',
      mustChangePassword: true,
    });
    // Two ways to onboard: read out the temporary password, or send the
    // activation link where the user sets their own password.
    const activationUrl = await this.auth.createActivationLink(user.id);
    return { user: toAdminUser(user), temporaryPassword, activationUrl };
  }

  async createActivationLink(targetId: string): Promise<{ activationUrl: string }> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    return { activationUrl: await this.auth.createActivationLink(targetId) };
  }

  async setActive(actingUserId: string, targetId: string, active: boolean): Promise<AdminUser> {
    if (!active && targetId === actingUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.active === active) {
      return toAdminUser(target);
    }
    if (!active && target.platformRole === 'admin') {
      const otherAdmins = await this.prisma.user.count({
        where: { platformRole: 'admin', active: true, id: { not: targetId } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException('At least one active administrator must remain');
      }
    }
    // Flip Gitea first: if it is unreachable, the platform state stays unchanged
    // rather than drifting out of sync with the SCM.
    await this.gitea.setUserActive(target.username, active);
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      // Deactivation also revokes live sessions by advancing the generation.
      data: active ? { active: true } : { active: false, tokenVersion: { increment: 1 } },
      select: USER_SELECT,
    });
    return toAdminUser(updated);
  }

  async resetPassword(targetId: string): Promise<{ temporaryPassword: string }> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('User not found');
    const temporaryPassword = generateTemporaryPassword();
    await this.prisma.user.update({
      where: { id: targetId },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        // Invalidate every existing session for the reset account.
        tokenVersion: { increment: 1 },
      },
    });
    return { temporaryPassword };
  }
}
