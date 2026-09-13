import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { RATE_LIMITS, type RateLimitPolicy } from './rate-limit.policy';

function context(request: Record<string, unknown>, setHeader = jest.fn()): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  const consume = jest.fn();
  const limiter = { consume };
  const reflector = { getAllAndOverride: jest.fn<RateLimitPolicy | undefined, unknown[]>() };
  const guard = new RateLimitGuard(limiter as never, reflector as never);

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(RATE_LIMITS.signIn);
    consume.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
  });

  it('consumes both the trusted client IP and normalized account identity', async () => {
    await expect(
      guard.canActivate(
        context({
          ip: '203.0.113.8',
          socket: {},
          body: { username: ' Alice@Example.Test ' },
          query: {},
        }),
      ),
    ).resolves.toBe(true);

    expect(consume).toHaveBeenNthCalledWith(1, 'auth.signin', 'ip', '203.0.113.8', 30, 300_000);
    expect(consume).toHaveBeenNthCalledWith(
      2,
      'auth.signin',
      'subject',
      'alice@example.test',
      10,
      300_000,
    );
  });

  it('uses the authenticated immutable user id for account-scoped actions', async () => {
    reflector.getAllAndOverride.mockReturnValue(RATE_LIMITS.changePassword);
    await guard.canActivate(
      context({ ip: '203.0.113.8', socket: {}, body: {}, query: {}, userId: 'user-1' }),
    );
    expect(consume).toHaveBeenNthCalledWith(
      2,
      'auth.change-password',
      'subject',
      'user-1',
      5,
      900_000,
    );
  });

  it('returns 429 with Retry-After when either dimension is exhausted', async () => {
    const setHeader = jest.fn();
    consume
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 60 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 42 });

    const promise = guard.canActivate(
      context({ ip: '203.0.113.8', socket: {}, body: { username: 'alice' }, query: {} }, setHeader),
    );
    await expect(promise).rejects.toHaveProperty('status', 429);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('fails closed when the shared store is unavailable', async () => {
    consume.mockRejectedValue(new Error('database unavailable'));
    await expect(
      guard.canActivate(
        context({ ip: '203.0.113.8', socket: {}, body: { username: 'alice' }, query: {} }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses accidental use without an explicit policy', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(
      guard.canActivate(context({ ip: '203.0.113.8', socket: {}, body: {}, query: {} })),
    ).rejects.toThrow('requires an explicit rate-limit policy');
  });
});
