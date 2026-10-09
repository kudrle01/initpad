import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SessionsService } from './sessions.service';
import { sessionCookieName } from './session-cookie';
import { PUBLIC_ENDPOINT, type PublicEndpointReason } from './public-endpoint.decorator';

type UserRow = {
  id: string;
  active: boolean;
  tokenVersion: number;
  mustChangePassword: boolean;
} | null;

function contextWith(cookieToken: string | undefined) {
  const req: { cookies: Record<string, string>; userId?: string; sessionId?: string | null } = {
    cookies: cookieToken ? { [sessionCookieName()]: cookieToken } : {},
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function build(opts: {
  payload?: unknown;
  verifyThrows?: boolean;
  user?: UserRow;
  session?: { userId: string; revokedAt: Date | null; expiresAt: Date; user: UserRow } | null;
  allowDuringChange?: boolean;
  publicEndpoint?: PublicEndpointReason;
}) {
  const jwt = {
    verify: jest.fn(() => {
      if (opts.verifyThrows) throw new Error('bad');
      return opts.payload ?? { sub: 'u1', ver: 0 };
    }),
  };
  const prisma = {
    user: { findUnique: jest.fn(async () => opts.user ?? null) },
    userSession: { findUnique: jest.fn(async () => opts.session ?? null) },
  };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === PUBLIC_ENDPOINT ? opts.publicEndpoint : (opts.allowDuringChange ?? false),
    ),
  } as unknown as Reflector;
  const guard = new JwtAuthGuard(new SessionsService(prisma as never, jwt as never), reflector);
  return { guard, jwt, prisma, reflector };
}

const activeUser = { id: 'u1', active: true, tokenVersion: 0, mustChangePassword: false };

describe('JwtAuthGuard', () => {
  it('allows only endpoints explicitly marked with a public access reason', async () => {
    const { guard, jwt, prisma } = build({ publicEndpoint: 'health-check' });
    const { ctx } = contextWith(undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a request without a session cookie', async () => {
    const { guard } = build({});
    const { ctx } = contextWith(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unverifiable token', async () => {
    const { guard } = build({ verifyThrows: true });
    const { ctx } = contextWith('tok');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts an active user and exposes the id', async () => {
    const { guard } = build({ user: activeUser });
    const { ctx, req } = contextWith('tok');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.userId).toBe('u1');
  });

  it('does not repeat the database lookup when a local guard follows the global guard', async () => {
    const { guard, jwt, prisma } = build({ user: activeUser });
    const { ctx, req } = contextWith('tok');
    req.userId = 'u1';

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a deactivated account', async () => {
    const { guard } = build({ user: { ...activeUser, active: false } });
    const { ctx } = contextWith('tok');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose generation is stale', async () => {
    const { guard } = build({
      payload: { sub: 'u1', ver: 0 },
      user: { ...activeUser, tokenVersion: 3 },
    });
    const { ctx } = contextWith('tok');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('treats a versionless legacy token as generation 0', async () => {
    const { guard } = build({ payload: { sub: 'u1' }, user: activeUser });
    const { ctx } = contextWith('tok');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('blocks ordinary endpoints while a password change is required', async () => {
    const { guard } = build({
      user: { ...activeUser, mustChangePassword: true },
      allowDuringChange: false,
    });
    const { ctx } = contextWith('tok');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows explicitly whitelisted endpoints during a forced change', async () => {
    const { guard } = build({
      user: { ...activeUser, mustChangePassword: true },
      allowDuringChange: true,
    });
    const { ctx } = contextWith('tok');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  describe('revocable sessions (ADR-147)', () => {
    const future = new Date(Date.now() + 60_000);

    it('accepts a live session and exposes its id', async () => {
      const { guard } = build({
        payload: { sub: 'u1', ver: 0, sid: 's1' },
        session: { userId: 'u1', revokedAt: null, expiresAt: future, user: activeUser },
      });
      const { ctx, req } = contextWith('tok');
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.sessionId).toBe('s1');
    });

    it('rejects a signed-out, expired, foreign or missing session', async () => {
      for (const session of [
        { userId: 'u1', revokedAt: new Date(), expiresAt: future, user: activeUser },
        { userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() - 1), user: activeUser },
        { userId: 'u2', revokedAt: null, expiresAt: future, user: { ...activeUser, id: 'u2' } },
        null,
      ]) {
        const { guard } = build({ payload: { sub: 'u1', ver: 0, sid: 's1' }, session });
        const { ctx } = contextWith('tok');
        await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      }
    });
  });
});
