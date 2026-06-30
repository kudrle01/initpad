import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export const TOKEN_COOKIE = 'initpad_token';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');
    try {
      const payload = this.jwt.verify<{ sub: string }>(token);
      (req as Request & { userId?: string }).userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
