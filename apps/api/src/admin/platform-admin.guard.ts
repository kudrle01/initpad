import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { config } from '../config';

// Runs after JwtAuthGuard (which sets req.userId) and confirms the caller holds
// the instance-wide administrator role. Instance administration is deliberately
// separate from workspace roles (ADR-028): workspace admins manage their team,
// the platform admin manages the self-hosted instance's user accounts.
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (config.edition !== 'self-hosted') {
      throw new ForbiddenException('Instance user administration is only available in the self-hosted edition');
    }
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    if (!req.userId) throw new ForbiddenException('Not authenticated');
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: { platformRole: true },
    });
    if (user?.platformRole !== 'admin') {
      throw new ForbiddenException('Platform administrator access required');
    }
    return true;
  }
}
