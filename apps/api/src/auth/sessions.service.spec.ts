import { UnauthorizedException } from '@nestjs/common';
import { SessionsService, SESSION_TTL_MS } from './sessions.service';

const user = { id: 'u1', active: true, tokenVersion: 2, mustChangePassword: false };

function prismaWith(
  sessions: Record<string, { userId: string; revokedAt: Date | null; expiresAt: Date }>,
) {
  return {
    user: {
      findUnique: jest.fn(async () => user),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    userSession: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({ id: 's-new' })),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        sessions[where.id] ? { ...sessions[where.id], user } : null,
      ),
      findMany: jest.fn(async () => [
        { id: 's1', userAgent: 'Firefox', createdAt: new Date(1) },
        { id: 's2', userAgent: null, createdAt: new Date(0) },
      ]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

describe('SessionsService (ADR-147)', () => {
  const jwt = {
    sign: jest.fn((payload: object) => JSON.stringify(payload)),
    verify: jest.fn((token: string) => JSON.parse(token) as object),
  };

  it('issues a token bound to a new session row of the current generation', async () => {
    const prisma = prismaWith({});
    const service = new SessionsService(prisma as never, jwt as never);
    const token = await service.issue(user, { userAgent: 'x'.repeat(400) });

    expect(JSON.parse(token)).toEqual({ sub: 'u1', ver: 2, sid: 's-new' });
    const data = (
      prisma.userSession.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({ userId: 'u1', version: 2 });
    expect((data.userAgent as string).length).toBe(256);
    expect((data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 5_000);
  });

  it('accepts a live session and refuses one that was ended', async () => {
    const future = new Date(Date.now() + 60_000);
    const prisma = prismaWith({
      live: { userId: 'u1', revokedAt: null, expiresAt: future },
      ended: { userId: 'u1', revokedAt: new Date(), expiresAt: future },
    });
    const service = new SessionsService(prisma as never, jwt as never);

    await expect(
      service.authenticate(JSON.stringify({ sub: 'u1', ver: 2, sid: 'live' })),
    ).resolves.toMatchObject({ id: 'u1', sessionId: 'live' });
    await expect(
      service.authenticate(JSON.stringify({ sub: 'u1', ver: 2, sid: 'ended' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // A token signed for another account cannot borrow this session id.
    await expect(
      service.authenticate(JSON.stringify({ sub: 'u2', ver: 2, sid: 'live' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs out one session, or the whole account for a token without a session', async () => {
    const prisma = prismaWith({});
    const service = new SessionsService(prisma as never, jwt as never);

    await service.revokeToken(JSON.stringify({ sub: 'u1', ver: 2, sid: 's1' }));
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();

    await service.revokeToken(JSON.stringify({ sub: 'u1', ver: 2 }));
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', tokenVersion: 2 },
      data: { tokenVersion: { increment: 1 } },
    });
  });

  it('lists the current generation and ends every other session', async () => {
    const prisma = prismaWith({});
    const service = new SessionsService(prisma as never, jwt as never);

    await expect(service.list('u1', 's2')).resolves.toEqual([
      expect.objectContaining({ id: 's1', current: false }),
      expect.objectContaining({ id: 's2', current: true }),
    ]);
    expect(prisma.userSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', version: 2 }) }),
    );

    await service.revoke('u1', { exceptId: 's2' });
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'u1', version: 2, id: { not: 's2' } }),
      data: { revokedAt: expect.any(Date) },
    });
  });
});
