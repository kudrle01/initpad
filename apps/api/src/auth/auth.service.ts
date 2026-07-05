import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { GiteaService } from '../scm/gitea.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from './password';
import { encryptSecret } from '../common/secret';

interface GiteaUser {
  id: number;
  login: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Platform identity. Supports managed registration (the platform provisions
 * the Gitea account on the user's behalf) as well as sign-in via Gitea
 * OAuth2 (SSO).
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

  authorizeUrl(state: string): string {
    const { clientId, callbackUrl } = config.auth;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      state,
    });
    return `${config.gitea.url}/login/oauth/authorize?${params}`;
  }

  /**
   * OAuth callback: exchanges the code for a token, loads the Gitea profile,
   * upserts the local user and returns a session JWT.
   */
  async handleCallback(code: string): Promise<string> {
    const accessToken = await this.exchangeCode(code);
    const profile = await this.fetchGiteaUser(accessToken);

    const user = await this.prisma.user.upsert({
      where: { giteaId: profile.id },
      // Note: accessToken is intentionally NOT updated here. Git operations
      // run through the service account (admin token + Sudo), so an OAuth
      // login must not overwrite a stored personal access token.
      update: {
        username: profile.login,
        name: profile.full_name || null,
        email: profile.email || null,
        avatarUrl: profile.avatar_url || null,
      },
      create: {
        giteaId: profile.id,
        username: profile.login,
        name: profile.full_name || null,
        email: profile.email || null,
        avatarUrl: profile.avatar_url || null,
        accessToken: encryptSecret(accessToken),
      },
    });

    return this.jwt.sign({ sub: user.id });
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

  private async exchangeCode(code: string): Promise<string> {
    const { clientId, clientSecret, callbackUrl } = config.auth;
    const res = await fetch(`${config.gitea.internalUrl}/login/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl,
      }),
    });
    if (!res.ok) throw new UnauthorizedException('OAuth code exchange failed');
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new UnauthorizedException('Missing access_token');
    return data.access_token;
  }

  private async fetchGiteaUser(token: string): Promise<GiteaUser> {
    const res = await fetch(`${config.gitea.internalUrl}/api/v1/user`, {
      headers: { Authorization: `token ${token}` },
    });
    if (!res.ok) throw new UnauthorizedException('Failed to load user from Gitea');
    return (await res.json()) as GiteaUser;
  }
}
