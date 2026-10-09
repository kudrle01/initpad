import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
  return req.userId as string;
});

/** Id of the session behind the request; null for a token from before ADR-147. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<Request & { sessionId?: string | null }>();
    return req.sessionId ?? null;
  },
);
