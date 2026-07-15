import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { GiteaService } from '../scm/gitea.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from './password';
import { encryptSecret } from '../common/secret';
import { generateToken, hashToken } from '../common/token';
import { config } from '../config';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const ACTIVATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

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
  // Whether the account's e-mail address has been verified.
  emailVerified: boolean;
}

/**
 * Platform identity — the single source of truth for user accounts.
 * Managed registration provisions the Gitea account on the user's behalf;
 * Gitea itself delegates sign-in back to the platform via OIDC (ADR-005),
 * so there is no reverse "sign in with Gitea" path (ADR-016).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
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
    const user = await this.provisionManagedUser({
      username: dto.username,
      email: dto.email,
      password: dto.password,
      // The very first account bootstraps the instance administrator.
      platformRole: userCount === 0 ? 'admin' : 'user',
    });
    return { token: this.signToken(user), user: this.toSession(user) };
  }

  /**
   * Provisions a managed account: creates the Gitea user + access token, then
   * persists the platform user with a personal workspace. Any failure after the
   * Gitea account exists rolls it back, so provisioning stays consistent with
   * Gitea (ADR-040). Shared by self-service registration and admin creation.
   */
  async provisionManagedUser(input: {
    username: string;
    email: string;
    name?: string | null;
    password: string;
    platformRole?: 'admin' | 'user';
    mustChangePassword?: boolean;
  }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: input.username }, { email }] },
    });
    if (existing) {
      throw new BadRequestException('Username or e-mail is already taken');
    }

    let provisionedUsername: string | null = null;
    try {
      const giteaUser = await this.gitea.createUser({
        username: input.username,
        email,
        password: input.password,
      });
      provisionedUsername = giteaUser.login;
      const accessToken = await this.gitea.createUserToken(input.username, input.password);
      return await this.prisma.user.create({
        data: {
          giteaId: giteaUser.id,
          username: giteaUser.login,
          email,
          name: input.name ?? undefined,
          platformRole: input.platformRole ?? 'user',
          mustChangePassword: input.mustChangePassword ?? false,
          passwordHash: hashPassword(input.password),
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
    } catch (e) {
      if (provisionedUsername) await this.gitea.deleteUser(provisionedUsername);
      throw e;
    }
  }

  /**
   * Creates a SaaS account from an external identity (GitHub sign-in) — no
   * Gitea account, no password. The linked identity and personal workspace are
   * created in the same write, so a failure never leaves a half-linked account.
   * A matching e-mail never attaches to an existing account (ADR-030/039): if
   * the address is taken, the account is created without it.
   */
  async provisionExternalUser(input: {
    provider: 'github' | 'gitlab';
    providerUserId: string;
    login: string;
    email?: string | null;
    name?: string | null;
    avatarUrl?: string | null;
  }) {
    const username = await this.uniqueUsername(input.login);
    const userCount = await this.prisma.user.count();
    const emailRaw = input.email?.trim().toLowerCase() || null;
    const emailTaken = emailRaw
      ? (await this.prisma.user.findUnique({ where: { email: emailRaw } })) != null
      : false;
    const email = emailTaken ? null : emailRaw;
    return this.prisma.user.create({
      data: {
        username,
        email,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
        platformRole: userCount === 0 ? 'admin' : 'user',
        passwordHash: null,
        accessToken: '',
        giteaId: null,
        // GitHub returns a verified account e-mail; mark it verified when kept.
        emailVerifiedAt: email ? new Date() : null,
        memberships: {
          create: {
            role: 'owner',
            workspace: {
              create: {
                slug: `personal-${username.toLowerCase()}`,
                name: `${username}'s workspace`,
                type: 'personal',
              },
            },
          },
        },
        externalIdentities: {
          create: { provider: input.provider, providerUserId: input.providerUserId, username: input.login },
        },
      },
    });
  }

  private async uniqueUsername(login: string): Promise<string> {
    let base = (login || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '-')
      .replace(/^[^a-z0-9]+/, '')
      .slice(0, 30);
    if (base.length < 2) base = `${base}gh`;
    let candidate = base;
    for (let i = 1; i <= 50; i++) {
      if (!(await this.prisma.user.findUnique({ where: { username: candidate } }))) return candidate;
      candidate = `${base}-${i}`;
    }
    return `${base}-${generateToken(3)}`;
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

  /**
   * Issues an e-mail verification link for the signed-in user's own address.
   * Without SMTP the link is returned to the caller (their own account) and
   * logged; a production build wires this to actual delivery.
   */
  async requestEmailVerification(userId: string): Promise<{ verifyUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.email) throw new BadRequestException('No e-mail address on file');
    if (user.emailVerifiedAt) throw new BadRequestException('E-mail is already verified');
    const token = await this.issueAuthToken(userId, 'email_verify', EMAIL_VERIFY_TTL_MS);
    const verifyUrl = `${this.frontendBase()}/verify-email/${token}`;
    this.logger.log(`E-mail verification link issued for ${user.username}`);
    return { verifyUrl };
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeAuthToken(token, 'email_verify');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  /**
   * Starts a password reset. Always resolves the same way regardless of whether
   * the account exists, so the endpoint cannot be used to enumerate users. When
   * a matching local account is found the reset link is logged (stands in for
   * SMTP delivery); it is never returned in the API response.
   */
  async requestPasswordReset(identity: string): Promise<void> {
    const id = identity.trim();
    if (!id) return;
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: id }, { email: id.toLowerCase() }] },
    });
    if (!user || !user.passwordHash) return;
    const token = await this.issueAuthToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
    this.logger.warn(
      `Password reset link for ${user.username}: ${this.frontendBase()}/reset-password/${token}`,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.consumeAuthToken(token, 'password_reset');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        // A reset invalidates every existing session.
        tokenVersion: { increment: 1 },
      },
    });
  }

  /**
   * Issues an activation link for an admin-provisioned account: a single-use
   * link where the user sets their own password and is signed in. This is the
   * private-edition onboarding alternative to reading out a temporary password.
   */
  async createActivationLink(userId: string): Promise<string> {
    const token = await this.issueAuthToken(userId, 'activation', ACTIVATION_TTL_MS);
    return `${this.frontendBase()}/activate/${token}`;
  }

  async activate(token: string, newPassword: string): Promise<{ token: string; user: SessionUser }> {
    const record = await this.consumeAuthToken(token, 'activation');
    const updated = await this.prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        // A fresh generation; any earlier temporary credential is invalidated.
        tokenVersion: { increment: 1 },
      },
    });
    return this.createSession(updated);
  }

  private frontendBase(): string {
    return config.auth.frontendUrl.replace(/\/+$/, '');
  }

  private async issueAuthToken(userId: string, kind: string, ttlMs: number): Promise<string> {
    // Supersede any earlier unused token of the same kind for this user.
    await this.prisma.authToken.updateMany({
      where: { userId, kind, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = generateToken();
    await this.prisma.authToken.create({
      data: { userId, kind, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  private async consumeAuthToken(token: string, kind: string): Promise<{ userId: string }> {
    if (!token) throw new BadRequestException('This link is invalid or has expired');
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.kind !== kind || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    await this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return { userId: record.userId };
  }

  /** Issues a signed session for an already-provisioned user (e.g. invite sign-up). */
  createSession(user: {
    id: string;
    username: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    platformRole: string;
    tokenVersion?: number;
    mustChangePassword?: boolean;
    emailVerifiedAt?: Date | null;
  }): { token: string; user: SessionUser } {
    return { token: this.signToken(user), user: this.toSession(user) };
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
    emailVerifiedAt?: Date | null;
  }): SessionUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole === 'admin' ? 'admin' : 'user',
      mustChangePassword: user.mustChangePassword === true,
      emailVerified: user.emailVerifiedAt != null,
    };
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toSession(user);
  }
}
