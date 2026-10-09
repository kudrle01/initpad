import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

// Matches the JWT lifetime and the cookie max-age.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface JwtPayload {
  sub: string;
  // Session generation. Bumped on password change/reset and deactivation to
  // invalidate every previously issued token.
  ver?: number;
  // UserSession id (ADR-147). Tokens issued before ADR-147 have none and stay
  // valid until their JWT expires, at most seven days after the upgrade.
  sid?: string;
}

export interface AuthenticatedUser {
  id: string;
  active: boolean;
  tokenVersion: number;
  mustChangePassword: boolean;
  sessionId: string | null;
}

export interface SessionClient {
  userAgent?: string;
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  current: boolean;
}

const USER_FIELDS = { id: true, active: true, tokenVersion: true, mustChangePassword: true };

/**
 * Issues, verifies and revokes browser sessions (ADR-147). The JWT proves who
 * signed in; the UserSession row decides whether that sign-in still counts.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async issue(
    user: { id: string; tokenVersion?: number },
    client: SessionClient = {},
  ): Promise<string> {
    const now = Date.now();
    const version = user.tokenVersion ?? 0;
    // Expired rows are only history; prune them as new sessions arrive.
    await this.prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        version,
        userAgent: client.userAgent?.slice(0, 256) || null,
        expiresAt: new Date(now + SESSION_TTL_MS),
      },
      select: { id: true },
    });
    return this.jwt.sign({ sub: user.id, ver: version, sid: session.id });
  }

  /** The signed-in account behind a session token; throws when it no longer counts. */
  async authenticate(token: string): Promise<AuthenticatedUser> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    let user: Omit<AuthenticatedUser, 'sessionId'> | null;
    if (payload.sid) {
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.sid },
        select: { userId: true, revokedAt: true, expiresAt: true, user: { select: USER_FIELDS } },
      });
      if (
        !session ||
        session.userId !== payload.sub ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException('Session has been revoked');
      }
      user = session.user;
    } else {
      user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: USER_FIELDS,
      });
    }
    if (!user || !user.active) throw new UnauthorizedException('Session is no longer valid');
    if ((payload.ver ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }
    return { ...user, sessionId: payload.sid ?? null };
  }

  /**
   * Ends the session behind a token on sign-out. A token from before ADR-147
   * has no session row, so signing out with it ends every session of the
   * account instead.
   */
  async revokeToken(token: string): Promise<void> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      return;
    }
    if (payload.sid) {
      await this.prisma.userSession.updateMany({
        where: { id: payload.sid, userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }
    await this.prisma.user.updateMany({
      where: { id: payload.sub, tokenVersion: payload.ver ?? 0 },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  async list(userId: string, currentSessionId: string | null): Promise<SessionSummary[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    if (!user) return [];
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        version: user.tokenVersion,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userAgent: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((session) => ({ ...session, current: session.id === currentSessionId }));
  }

  /** Ends sessions of the account; returns how many were still active. */
  async revoke(
    userId: string,
    filter: { id: string } | { exceptId: string | null },
  ): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    if (!user) return 0;
    const id = 'id' in filter ? filter.id : filter.exceptId ? { not: filter.exceptId } : undefined;
    // Only sessions the overview shows: an older generation already ended.
    const { count } = await this.prisma.userSession.updateMany({
      where: {
        userId,
        version: user.tokenVersion,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(id ? { id } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
