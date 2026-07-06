import {
  BadRequestException,
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

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Platform identity — the single source of truth for user accounts.
 * Managed registration provisions the Gitea account on the user's behalf;
 * Gitea itself delegates sign-in back to the platform via OIDC (ADR-005),
 * so there is no reverse "sign in with Gitea" path (ADR-016).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly gitea: GiteaService,
  ) {}

  /** Managed registration: provisions a Gitea account + token, persists the user. */
  async register(dto: RegisterDto): Promise<{ token: string; user: SessionUser }> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
    });
    if (existing) {
      throw new BadRequestException('Username or e-mail is already taken');
    }

    const giteaUser = await this.gitea.createUser({
      username: dto.username,
      email: dto.email,
      password: dto.password,
    });
    const accessToken = await this.gitea.createUserToken(dto.username, dto.password);

    const user = await this.prisma.user.create({
      data: {
        giteaId: giteaUser.id,
        username: giteaUser.login,
        email: dto.email,
        passwordHash: hashPassword(dto.password),
        accessToken: encryptSecret(accessToken),
      },
    });
    return { token: this.jwt.sign({ sub: user.id }), user: this.toSession(user) };
  }

  /** Sign-in with a platform-native account (password verified locally). */
  async login(dto: LoginDto): Promise<{ token: string; user: SessionUser }> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.username }] },
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
  }): SessionUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
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
    };
  }
}
