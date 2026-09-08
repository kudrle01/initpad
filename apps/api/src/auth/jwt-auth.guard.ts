import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_PASSWORD_CHANGE } from './allow-password-change.decorator';
import { PUBLIC_ENDPOINT, type PublicEndpointReason } from './public-endpoint.decorator';

export const TOKEN_COOKIE = 'initpad_token';

export interface JwtPayload {
  sub: string;
  // Session generation. Bumped on password change/reset and deactivation to
  // invalidate every previously issued token. Absent in pre-existing cookies,
  // which are treated as generation 0 so a deploy does not log everyone out.
  ver?: number;
}

// Verifies the session cookie and, unlike a stateless check, confirms the
// account still exists, is active, and carries the current session generation.
// It also enforces a pending forced password change: while `mustChangePassword`
// is set, only endpoints marked @AllowDuringPasswordChange() are reachable.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const publicReason = this.reflector.getAllAndOverride<PublicEndpointReason>(PUBLIC_ENDPOINT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publicReason) return true;

    // Some controllers still declare the same guard locally for readability.
    // The global guard has already authenticated this request, so avoid a
    // duplicate user lookup when the controller-level guard runs afterwards.
    if (req.userId) return true;

    const token = req.cookies?.[TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, active: true, tokenVersion: true, mustChangePassword: true },
    });
    if (!user || !user.active) throw new UnauthorizedException('Session is no longer valid');
    if ((payload.ver ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, [
        ctx.getHandler(),
        ctx.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenException('Password change required before continuing');
      }
    }

    req.userId = user.id;
    return true;
  }
}
