import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitService, type RateLimitDecision } from './rate-limit.service';
import {
  RATE_LIMIT_POLICY,
  type RateLimitPolicy,
  type RateLimitSubject,
} from './rate-limit.policy';

type AuthenticatedRequest = Request & { userId?: string };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly limiter: RateLimitService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) {
      throw new Error('RateLimitGuard requires an explicit rate-limit policy');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    try {
      const ipDecision = await this.limiter.consume(
        policy.name,
        'ip',
        request.ip || request.socket.remoteAddress || 'unknown',
        policy.ipLimit,
        policy.windowMs,
      );
      this.enforce(ipDecision, response);

      const subject = this.readSubject(request, policy.subject);
      if (subject && policy.subjectLimit) {
        const subjectDecision = await this.limiter.consume(
          policy.name,
          'subject',
          subject,
          policy.subjectLimit,
          policy.windowMs,
        );
        this.enforce(subjectDecision, response);
      }
      return true;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error({
        event: 'rate_limit.store_unavailable',
        scope: policy.name,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new ServiceUnavailableException('Request protection is temporarily unavailable');
    }
  }

  private enforce(decision: RateLimitDecision, response: Response): void {
    if (decision.allowed) return;
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }

  private readSubject(request: AuthenticatedRequest, subject?: RateLimitSubject): string | null {
    if (!subject) return null;
    if (subject.source === 'user') return request.userId || null;
    const container: unknown = subject.source === 'body' ? request.body : request.query;
    if (!container || typeof container !== 'object') return null;
    const value = (container as Record<string, unknown>)[subject.field];
    if (typeof value !== 'string' || value.length === 0) return null;
    if (subject.normalization === 'opaque') return value;
    return value.normalize('NFKC').trim().toLowerCase();
  }
}
