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
import { hashEnrollmentCode } from '../courses/enrollment-code';

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  platformRole: 'admin' | 'user';
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

  async registrationAvailable(): Promise<boolean> {
    if (config.auth.registrationMode === 'open') return true;
    if (config.auth.registrationMode === 'closed') return false;
    return (await this.prisma.user.count()) === 0;
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
    const userCount = await this.prisma.user.count();
    const publicRegistrationAvailable =
      config.auth.registrationMode === 'open' ||
      (config.auth.registrationMode === 'first-user' && userCount === 0);
    const enrollmentCode = dto.enrollmentCode?.trim();
    const course = enrollmentCode
      ? await this.prisma.course.findUnique({
          where: { enrollmentCodeHash: hashEnrollmentCode(enrollmentCode) },
          select: { id: true, enrollmentOpen: true, membershipLocked: true },
        })
      : null;
    if (enrollmentCode && !course) {
      throw new BadRequestException('Enrollment code is invalid');
    }
    if (course && (!course.enrollmentOpen || course.membershipLocked)) {
      throw new ForbiddenException(
        course.membershipLocked ? 'Course membership is locked' : 'Course enrollment is closed',
      );
    }
    if (!publicRegistrationAvailable && !course) {
      throw new ForbiddenException('Account registration is closed. Ask the platform administrator for access.');
    }
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
          ...(course
            ? { courseMemberships: { create: { courseId: course.id, role: 'student' } } }
            : {}),
        },
      });
      return { token: this.jwt.sign({ sub: user.id }), user: this.toSession(user) };
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
    return { token: this.jwt.sign({ sub: user.id }), user: this.toSession(user) };
  }

  private toSession(user: {
    id: string;
    username: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    platformRole: string;
  }): SessionUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole === 'admin' ? 'admin' : 'user',
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole === 'admin' ? 'admin' : 'user',
    };
  }
}
