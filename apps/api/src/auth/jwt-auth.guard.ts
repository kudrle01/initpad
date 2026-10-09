import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SessionsService } from './sessions.service';
import { readSessionToken } from './session-cookie';
import { ALLOW_PASSWORD_CHANGE } from './allow-password-change.decorator';
import { PUBLIC_ENDPOINT, type PublicEndpointReason } from './public-endpoint.decorator';

export type { JwtPayload } from './sessions.service';

// Verifies the session cookie and, unlike a stateless check, confirms the
// session was not ended, the account still exists, is active, and carries the
// current session generation (ADR-147).
// It also enforces a pending forced password change: while `mustChangePassword`
// is set, only endpoints marked @AllowDuringPasswordChange() are reachable.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { userId?: string; sessionId?: string | null }>();
    const publicReason = this.reflector.getAllAndOverride<PublicEndpointReason>(PUBLIC_ENDPOINT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publicReason) return true;

    // Some controllers still declare the same guard locally for readability.
    // The global guard has already authenticated this request, so avoid a
    // duplicate user lookup when the controller-level guard runs afterwards.
    if (req.userId) return true;

    const token = readSessionToken(req);
    if (!token) throw new UnauthorizedException('Not authenticated');

    const user = await this.sessions.authenticate(token);

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
    req.sessionId = user.sessionId;
    return true;
  }
}
