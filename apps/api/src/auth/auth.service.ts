import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GiteaService } from '../scm/gitea.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from './password';
import { encryptSecret } from '../common/secret';
import { generateToken, hashToken } from '../common/token';
import { config } from '../config';
import { accountIdentifierEquals, normalizeAccountIdentifier } from '../common/account-identifier';
import { MailDeliveryService, type MailKind } from '../mail/mail-delivery.service';
import { AuditEventsService, type RecordAuditEvent } from '../audit/audit-events.service';
import { SessionsService, type SessionClient } from './sessions.service';
import { repositoryRef } from '../scm/scm-provider';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const ACTIVATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// A valid, precomputed scrypt record used only to make an unknown-account
// sign-in spend the same kind of work as a known account. The plaintext is
// irrelevant: callers always receive the same generic authentication error.
const DUMMY_PASSWORD_HASH =
  '42424242424242424242424242424242:7b1eed877afda522cc3d7931c595e1286685d07309088a38f59e89fcc7a6757d6007f55ec667d4a21cb6c989d838fffa305bb45467b6f388333ecf7d528cef12';

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  platformRole: 'admin' | 'user';
  edition: 'self-hosted' | 'saas';
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
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('AuthService');
  private registrationLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    jwt: JwtService,
    private readonly gitea: GiteaService,
    private readonly mail?: MailDeliveryService,
    // Nest always injects the audit sink or fails at startup; the default only
    // serves unit tests that construct the service directly.
    @Inject(AuditEventsService)
    private readonly audit: Pick<AuditEventsService, 'record'> = {
      record: () => Promise.resolve(),
    },
    @Inject(SessionsService)
    private readonly sessions: Pick<SessionsService, 'issue' | 'revoke'> = new SessionsService(
      prisma,
      jwt,
    ),
  ) {}

  /** Platform-level account event (ADR-142); `tx` keeps it with its change. */
  private accountEvent(
    action: string,
    account: { id: string; username: string } | null,
    event: Pick<RecordAuditEvent, 'actorUserId' | 'anonymous' | 'outcome' | 'details'> = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    return this.audit.record(
      {
        workspaceId: null,
        action,
        resourceType: 'user',
        resourceId: account?.id ?? null,
        resourceName: account?.username ?? null,
        ...event,
      },
      tx,
    );
  }

  /** Records a sign-in completed outside password authentication. */
  recordSignIn(user: { id: string; username: string }, method: 'github'): Promise<void> {
    return this.accountEvent('auth.signed_in', user, {
      actorUserId: user.id,
      details: { method },
    });
  }

  /**
   * Ends sessions of the signed-in account from the session overview
   * (ADR-147): one other session, or every session except the current one.
   */
  async endSessions(
    userId: string,
    filter: { id: string } | { exceptId: string | null },
  ): Promise<{ ended: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw new UnauthorizedException();
    const ended = await this.sessions.revoke(userId, filter);
    if (ended > 0) {
      await this.accountEvent('auth.sessions_ended', user, {
        actorUserId: userId,
        details: { sessions: ended },
      });
    }
    return { ended };
  }

  /**
   * Managed Gitea accounts are authenticated through InitPad OIDC. Rotate any
   * legacy/local Gitea passwords on startup so a platform password (including
   * an old password after reset) can never be used to bypass InitPad account
   * lifecycle checks by signing in to Gitea directly.
   */
  async onModuleInit(): Promise<void> {
    if (config.edition !== 'self-hosted') return;
    try {
      const users = await this.prisma.user.findMany({
        where: { giteaId: { not: null } },
        select: { username: true },
      });
      for (const user of users) {
        await this.gitea
          .randomizeUserPassword(user.username)
          .catch((error) =>
            this.logger.warn(
              `Could not harden the local Gitea password for ${user.username}: ${(error as Error).message}`,
            ),
          );
      }
    } catch (error) {
      this.logger.warn(`Managed Gitea password hardening skipped: ${(error as Error).message}`);
    }
  }

  /**
   * Whether the public self-service registration form is available. `open`
   * allows it unconditionally; every other policy only lets the very first
   * account bootstrap the instance administrator. Further closed-instance
   * accounts are provisioned explicitly by that administrator.
   */
  async registrationAvailable(): Promise<boolean> {
    // Public SaaS identity is GitHub-only. Native password registration is a
    // self-hosted feature and must never silently fall back to managed Gitea.
    if (config.edition === 'saas') return false;
    if (config.auth.registrationMode === 'open') return true;
    return (await this.prisma.user.count()) === 0;
  }

  registrationMode(): string {
    return config.auth.registrationMode;
  }

  /**
   * The first account becomes the instance administrator. Creating it needs
   * the bootstrap token printed by install.sh, so a freshly exposed server
   * cannot be claimed by whoever registers first (ADR-136). Local development
   * without a configured token keeps the plain first-user flow.
   */
  async bootstrapRequired(): Promise<boolean> {
    if (config.edition === 'saas' || !this.bootstrapTokenEnforced()) return false;
    return (await this.prisma.user.count()) === 0;
  }

  private bootstrapTokenEnforced(): boolean {
    return Boolean(config.auth.bootstrapToken) || process.env.NODE_ENV === 'production';
  }

  private assertBootstrapToken(candidate: string | undefined): void {
    const expected = config.auth.bootstrapToken;
    if (!expected) {
      throw new ForbiddenException(
        'The first administrator needs a setup token. Set INITPAD_BOOTSTRAP_TOKEN (install.sh generates it) and restart InitPad.',
      );
    }
    const expectedDigest = createHash('sha256').update(expected).digest();
    const candidateDigest = createHash('sha256')
      .update(candidate?.trim() ?? '')
      .digest();
    if (!timingSafeEqual(expectedDigest, candidateDigest)) {
      throw new ForbiddenException(
        'The setup token is not valid. Use the token printed at the end of install.sh.',
      );
    }
  }

  emailDeliveryEnabled(): boolean {
    return this.mail?.isEnabled() ?? false;
  }

  /** Managed registration: provisions a Gitea account + token, persists the user. */
  async register(
    dto: RegisterDto,
    client: SessionClient = {},
  ): Promise<{ token: string; user: SessionUser }> {
    let release!: () => void;
    const previous = this.registrationLock;
    this.registrationLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.registerUnlocked(dto, client);
    } finally {
      release();
    }
  }

  private async registerUnlocked(
    dto: RegisterDto,
    client: SessionClient,
  ): Promise<{ token: string; user: SessionUser }> {
    if (!(await this.registrationAvailable())) {
      throw new ForbiddenException(
        'Account registration is closed. Ask the platform administrator for access.',
      );
    }
    const userCount = await this.prisma.user.count();
    if (userCount === 0 && this.bootstrapTokenEnforced()) {
      this.assertBootstrapToken(dto.bootstrapToken);
    }
    const user = await this.provisionManagedUser({
      username: dto.username,
      email: dto.email,
      password: dto.password,
      // The very first account bootstraps the instance administrator.
      platformRole: userCount === 0 ? 'admin' : 'user',
    });
    await this.accountEvent('auth.registered', user, {
      actorUserId: user.id,
      details: { administrator: userCount === 0 },
    });
    return { token: await this.sessions.issue(user, client), user: this.toSession(user) };
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
    const username = normalizeAccountIdentifier(input.username);
    const email = normalizeAccountIdentifier(input.email);
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: accountIdentifierEquals(username) },
          { email: accountIdentifierEquals(email) },
        ],
      },
    });
    if (existing) {
      throw new BadRequestException('Username or e-mail is already taken');
    }

    let provisionedUsername: string | null = null;
    try {
      const giteaUser = await this.gitea.createUser({
        username,
        email,
        password: input.password,
      });
      provisionedUsername = giteaUser.login;
      const accessToken = await this.gitea.createCloneToken(username, input.password);
      await this.gitea.randomizeUserPassword(username);
      return await this.prisma.user.create({
        data: {
          giteaId: giteaUser.id,
          username: giteaUser.login,
          email,
          name: input.name ?? undefined,
          platformRole: input.platformRole ?? 'user',
          mustChangePassword: input.mustChangePassword ?? false,
          passwordHash: await hashPassword(input.password),
          accessToken: encryptSecret(accessToken),
          giteaCredentialsScopedAt: new Date(),
          memberships: {
            create: {
              role: 'owner',
              workspace: {
                create: {
                  slug: `personal-${giteaUser.login.toLowerCase()}`,
                  name: `${giteaUser.login}'s workspace`,
                  type: 'personal',
                  productionApprovalPolicy: 'self-review',
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
    emailVerified?: boolean;
    name?: string | null;
    avatarUrl?: string | null;
  }) {
    const username = await this.uniqueUsername(input.login);
    // In SaaS the e-mail participates in account display and workspace lookup,
    // so keep it only when GitHub explicitly attested it as verified.
    const emailRaw = input.emailVerified
      ? normalizeAccountIdentifier(input.email ?? '') || null
      : null;
    const emailTaken = emailRaw
      ? (await this.prisma.user.findFirst({
          where: { email: accountIdentifierEquals(emailRaw) },
        })) != null
      : false;
    const email = emailTaken ? null : emailRaw;
    return this.prisma.user.create({
      data: {
        username,
        email,
        name: input.name ?? null,
        avatarUrl: input.avatarUrl ?? null,
        // A public SaaS must never grant instance administration to whichever
        // visitor happens to sign in first. SaaS administration needs an
        // explicit, separately configured bootstrap policy.
        platformRole: 'user',
        passwordHash: null,
        accessToken: '',
        giteaId: null,
        emailVerifiedAt: email && input.emailVerified ? new Date() : null,
        memberships: {
          create: {
            role: 'owner',
            workspace: {
              create: {
                slug: `personal-${username.toLowerCase()}`,
                name: `${username}'s workspace`,
                type: 'personal',
                productionApprovalPolicy: 'self-review',
              },
            },
          },
        },
        externalIdentities: {
          create: {
            provider: input.provider,
            providerUserId: input.providerUserId,
            username: input.login,
          },
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
      if (
        !(await this.prisma.user.findFirst({
          where: { username: accountIdentifierEquals(candidate) },
        }))
      )
        return candidate;
      candidate = `${base}-${i}`;
    }
    return `${base}-${generateToken(3)}`;
  }

  /** Sign-in with a platform-native account (password verified locally). */
  async login(
    dto: LoginDto,
    client: SessionClient = {},
  ): Promise<{ token: string; user: SessionUser }> {
    if (config.edition === 'saas') {
      throw new ForbiddenException('Password sign-in is disabled in the SaaS edition');
    }
    const identity = normalizeAccountIdentifier(dto.username);
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: accountIdentifierEquals(identity) },
          { email: accountIdentifierEquals(identity) },
        ],
      },
    });
    const passwordMatches = await verifyPassword(
      dto.password,
      user?.passwordHash || DUMMY_PASSWORD_HASH,
    );
    if (!user || !user.passwordHash || !passwordMatches) {
      // The typed identifier is not stored: it may be a mistyped password.
      await this.accountEvent('auth.sign_in_failed', user, {
        anonymous: true,
        outcome: 'failed',
        details: { reason: user ? 'invalid_password' : 'unknown_account' },
      });
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.active === false) {
      await this.accountEvent('auth.sign_in_failed', user, {
        anonymous: true,
        outcome: 'failed',
        details: { reason: 'deactivated' },
      });
      throw new UnauthorizedException('This account has been deactivated');
    }
    await this.accountEvent('auth.signed_in', user, {
      actorUserId: user.id,
      details: { method: 'password' },
    });
    return { token: await this.sessions.issue(user, client), user: this.toSession(user) };
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
    client: SessionClient = {},
  ): Promise<{ token: string; user: SessionUser }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      !user.passwordHash ||
      !(await verifyPassword(currentPassword, user.passwordHash))
    ) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must differ from the current one');
    }
    const passwordHash = await hashPassword(newPassword);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
      });
      await this.accountEvent('auth.password_changed', changed, { actorUserId: userId }, tx);
      return changed;
    });
    return { token: await this.sessions.issue(updated, client), user: this.toSession(updated) };
  }

  /** Issues an e-mail verification link without exposing it when SMTP is configured. */
  async requestEmailVerification(
    userId: string,
  ): Promise<{ delivery: 'email' | 'manual'; verifyUrl?: string }> {
    if (config.edition === 'saas') {
      throw new BadRequestException('SaaS e-mail verification is provided by GitHub');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!user.email) throw new BadRequestException('No e-mail address on file');
    if (user.emailVerifiedAt) throw new BadRequestException('E-mail is already verified');
    const link = await this.issueAuthLink(
      user,
      'email_verify',
      EMAIL_VERIFY_TTL_MS,
      'verify-email',
    );
    this.logger.log({
      event: 'auth.email_verification.issued',
      userId: user.id,
      delivery: link.delivery,
    });
    return {
      delivery: link.delivery,
      ...(link.url ? { verifyUrl: link.url } : {}),
    };
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeAuthToken(token, 'email_verify');
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.accountEvent('auth.email_verified', user, { actorUserId: user.id }, tx);
    });
  }

  /**
   * Starts a password reset. Always resolves the same way regardless of whether
   * the account exists, so the endpoint cannot be used to enumerate users. The
   * plaintext link is never returned or logged. Without SMTP the operation is
   * intentionally a no-op and self-hosted administrators can reset the account.
   */
  async requestPasswordReset(identity: string): Promise<void> {
    const id = normalizeAccountIdentifier(identity);
    if (!id) return;
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: accountIdentifierEquals(id) }, { email: accountIdentifierEquals(id) }],
      },
    });
    if (!user || !user.passwordHash || !user.email || !this.mail?.isEnabled()) return;
    await this.issueAuthLink(user, 'password_reset', PASSWORD_RESET_TTL_MS, 'reset-password');
    await this.accountEvent('auth.password_reset_requested', user, { anonymous: true });
    this.logger.log({ event: 'auth.password_reset.queued', userId: user.id });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.findUsableAuthToken(token, 'password_reset');
    // A reset is how an account is recovered after a compromise. The Git
    // token obtainable through an old session must stop working first; the
    // link stays unused if Gitea cannot confirm the revocation.
    await this.revokeGitCredential(record.userId);
    await this.claimAuthToken(record);
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          // A reset invalidates every existing session.
          tokenVersion: { increment: 1 },
        },
      });
      await this.accountEvent('auth.password_reset', user, { actorUserId: user.id }, tx);
    });
  }

  /**
   * Revokes every Gitea token of the account and forgets its clone token; the
   * user receives a new one the next time Git access is requested (ADR-134).
   * Registry tokens of the account's repositories are reissued (ADR-148).
   */
  async revokeGitCredential(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, giteaId: true },
    });
    if (!user || user.giteaId == null) return;
    try {
      const projects = await this.prisma.project.findMany({
        where: { scmProvider: 'gitea', scmOwner: user.username, scmRepositoryId: { not: null } },
        select: {
          scmProvider: true,
          scmRepositoryId: true,
          scmOwner: true,
          scmRepositoryName: true,
          scmFullName: true,
          scmDefaultBranch: true,
          scmInstallationId: true,
          repoUrl: true,
        },
      });
      await this.gitea.revokeAccountCredentials(user.username, projects.map(repositoryRef));
    } catch (error) {
      this.logger.warn({
        event: 'auth.git_credential.revocation_failed',
        userId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new ServiceUnavailableException(
        'The Git service is temporarily unavailable. Try again in a few minutes.',
      );
    }
    await this.prisma.user.update({ where: { id: userId }, data: { accessToken: '' } });
  }

  /**
   * Issues an activation link for an admin-provisioned account: a single-use
   * link where the user sets their own password and is signed in. This is the
   * private-edition onboarding alternative to reading out a temporary password.
   */
  async createActivationLink(
    userId: string,
  ): Promise<{ delivery: 'email' | 'manual'; activationUrl?: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const link = await this.issueAuthLink(user, 'activation', ACTIVATION_TTL_MS, 'activate');
    return {
      delivery: link.delivery,
      ...(link.url ? { activationUrl: link.url } : {}),
    };
  }

  async activate(
    token: string,
    newPassword: string,
    client: SessionClient = {},
  ): Promise<{ token: string; user: SessionUser }> {
    const record = await this.consumeAuthToken(token, 'activation');
    const passwordHash = await hashPassword(newPassword);
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          // A fresh generation; any earlier temporary credential is invalidated.
          tokenVersion: { increment: 1 },
        },
      });
      await this.accountEvent('auth.account_activated', user, { actorUserId: user.id }, tx);
      return user;
    });
    return this.createSession(updated, client);
  }

  private frontendBase(): string {
    return config.auth.frontendUrl.replace(/\/+$/, '');
  }

  // The token travels in the fragment, which browsers never send to a server,
  // so it stays out of proxy and edge access logs (ADR-143).
  private authLinkUrl(route: string, token: string): string {
    return `${this.frontendBase()}/${route}#${token}`;
  }

  private async issueAuthLink(
    user: { id: string; email: string | null; name: string | null; username: string },
    kind: MailKind,
    ttlMs: number,
    route: string,
  ): Promise<{ delivery: 'email' | 'manual'; url?: string }> {
    const deliverByEmail = Boolean(this.mail?.isEnabled() && user.email);
    const token = await this.prisma.$transaction(async (tx) => {
      // Serialize token replacement for this account. The partial unique index
      // is the final invariant; this lock also makes simultaneous requests
      // deterministically supersede rather than surface a constraint error.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`);
      const token = await this.issueAuthToken(tx, user.id, kind, ttlMs);
      if (deliverByEmail) {
        await this.mail!.enqueueAuthMail(tx, {
          userId: user.id,
          kind,
          recipient: user.email!,
          displayName: user.name || user.username,
          url: this.authLinkUrl(route, token),
        });
      }
      return token;
    });
    if (deliverByEmail) {
      this.mail!.scheduleDelivery();
      return { delivery: 'email' };
    }
    return { delivery: 'manual', url: this.authLinkUrl(route, token) };
  }

  private async issueAuthToken(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
    kind: MailKind,
    ttlMs: number,
  ): Promise<string> {
    // Supersede any earlier unused token of the same kind for this user.
    await db.authToken.updateMany({
      where: { userId, kind, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = generateToken();
    await db.authToken.create({
      data: { userId, kind, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  private async consumeAuthToken(token: string, kind: string): Promise<{ userId: string }> {
    const record = await this.findUsableAuthToken(token, kind);
    await this.claimAuthToken(record);
    return { userId: record.userId };
  }

  private async findUsableAuthToken(
    token: string,
    kind: string,
  ): Promise<{ id: string; kind: string; userId: string }> {
    if (!token) throw new BadRequestException('This link is invalid or has expired');
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !record ||
      record.kind !== kind ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    return record;
  }

  // Claim the token atomically. Two concurrent requests may both read the
  // row, but exactly one is allowed to transition it from unused.
  private async claimAuthToken(record: { id: string; kind: string }): Promise<void> {
    const claimed = await this.prisma.authToken.updateMany({
      where: {
        id: record.id,
        kind: record.kind,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This link is invalid or has expired');
    }
  }

  /** Issues a signed session for an already-provisioned user (e.g. GitHub OAuth). */
  async createSession(
    user: {
      id: string;
      username: string;
      name: string | null;
      email: string | null;
      avatarUrl: string | null;
      platformRole: string;
      tokenVersion?: number;
      mustChangePassword?: boolean;
      emailVerifiedAt?: Date | null;
    },
    client: SessionClient = {},
  ): Promise<{ token: string; user: SessionUser }> {
    return { token: await this.sessions.issue(user, client), user: this.toSession(user) };
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
      edition: config.edition,
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
