import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

// Authentication endpoints are intentionally protected independently from the
// rest of the API. A distributed deployment should replace this in-memory
// store with Redis, but a single InitPad API instance gets deterministic brute
// force protection without another mandatory service.
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 5 * 60_000;
  private readonly limit = 10;
  private requestCount = 0;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    if (++this.requestCount % 100 === 0 || this.buckets.size > 10_000) {
      for (const [bucketKey, value] of this.buckets) {
        if (value.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const current = this.buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + this.windowMs }
      : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (bucket.count <= this.limit) return true;
    throw new HttpException(
      'Too many authentication attempts. Try again in a few minutes.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
