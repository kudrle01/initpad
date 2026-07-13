import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { GiteaService } from '../scm/gitea.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from './password';
import { encryptSecret } from '../common/secret';
import { config } from '../config';

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  platformRole: 'admin' | 'user';
  // True while the account must set a new password before doing anything else
  // (admin-provisioned temporary credentials, post-reset). The web app uses it
  // to route the user straight to the change-password screen.
  mustChangePassword: boolean;
}

/**
 * Platform identity — the single source of truth for user accounts.
 * Managed registration provisions the Gitea account on the user's behalf;
 * Gitea itself delegates sign-in back to the platform via OIDC (ADR-005),
 * so there is no reverse "sign in with Gitea" path (ADR-016).
 */
@Injectable()
export class AuthService {
  private registrationLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly gitea: GiteaService,
  ) {}

  /**
   * Whether the public self-service registration form is available. `open`
   * allows it unconditionally; every other policy only lets the very first
   * account bootstrap the instance administrator. Invited users register
   * through a separate token-carrying path, not this public gate.
   */
  async registrationAvailable(): Promise<boolean> {
    if (config.auth.registrationMode === 'open') return true;
    return (await this.prisma.user.count()) === 0;
  }

  registrationMode(): string {
    return config.auth.registrationMode;
  }

  /** Managed registration: provisions a Gitea account + token, persists the user. */
  async register(dto: RegisterDto): Promise<{ token: string; user: SessionUser }> {
    let release!: () => void;
    const previous = this.registrationLock;
    this.registrationLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.registerUnlocked(dto);
    } finally {
      release();
    }
  }

  private async registerUnlocked(
    dto: RegisterDto,
  ): Promise<{ token: string; user: SessionUser }> {
    if (!(await this.registrationAvailable())) {
      throw new ForbiddenException('Account registration is closed. Ask the platform administrator for access.');
    }
    const userCount = await this.prisma.user.count();
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email }] },
    });
    if (existing) {
      throw new BadRequestException('Username or e-mail is already taken');
    }

    let provisionedUsername: string | null = null;
    try {
      const giteaUser = await this.gitea.createUser({
        username: dto.username,
        email,
        password: dto.password,
      });
      provisionedUsername = giteaUser.login;
      const accessToken = await this.gitea.createUserToken(dto.username, dto.password);
      const user = await this.prisma.user.create({
        data: {
          giteaId: giteaUser.id,
          username: giteaUser.login,
          email,
          platformRole: userCount === 0 ? 'admin' : 'user',
          passwordHash: hashPassword(dto.password),
          accessToken: encryptSecret(accessToken),
          memberships: {
            create: {
              role: 'owner',
              workspace: {
                create: {
                  slug: `personal-${giteaUser.login.toLowerCase()}`,
                  name: `${giteaUser.login}'s workspace`,
                  type: 'personal',
                },
              },
            },
          },
        },
      });
      return { token: this.signToken(user), user: this.toSession(user) };
    } catch (e) {
      if (provisionedUsername) await this.gitea.deleteUser(provisionedUsername);
      throw e;
    }
  }

  /** Sign-in with a platform-native account (password verified locally). */
  async login(dto: LoginDto): Promise<{ token: string; user: SessionUser }> {
    const identity = dto.username.trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: identity }, { email: identity.toLowerCase() }] },
    });
    if (!user || !user.passwordHash || !verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.active === false) {
      throw new UnauthorizedException('This account has been deactivated');
    }
    return { token: this.signToken(user), user: this.toSession(user) };
  }

  /**
   * Change the signed-in user's own password. Verifies the current password,
   * clears any forced-change flag, and bumps the session generation so every
   * other session is invalidated; the caller's cookie is re-issued fresh.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ token: string; user: SessionUser }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (verifyPassword(newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must differ from the current one');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
    });
    return { token: this.signToken(updated), user: this.toSession(updated) };
  }

  private signToken(user: { id: string; tokenVersion?: number }): string {
    return this.jwt.sign({ sub: user.id, ver: user.tokenVersion ?? 0 });
  }

  private toSession(user: {
    id: string;
    username: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    platformRole: string;
    mustChangePassword?: boolean;
  }): SessionUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole === 'admin' ? 'admin' : 'user',
      mustChangePassword: user.mustChangePassword === true,
    };
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toSession(user);
  }
}
