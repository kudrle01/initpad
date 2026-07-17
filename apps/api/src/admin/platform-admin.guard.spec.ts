import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import { config } from '../config';

function contextFor(userId?: string) {
  const req = { userId };
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  const savedEdition = config.edition;

  beforeEach(() => {
    config.edition = 'self-hosted';
  });

  afterAll(() => {
    config.edition = savedEdition;
  });

  it('allows a platform administrator', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ platformRole: 'admin' })) } };
    const guard = new PlatformAdminGuard(prisma as never);
    await expect(guard.canActivate(contextFor('u1'))).resolves.toBe(true);
  });

  it('rejects an ordinary user', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => ({ platformRole: 'user' })) } };
    const guard = new PlatformAdminGuard(prisma as never);
    await expect(guard.canActivate(contextFor('u1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unauthenticated request', async () => {
    const guard = new PlatformAdminGuard({} as never);
    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose Gitea-backed user administration in SaaS', async () => {
    config.edition = 'saas';
    const guard = new PlatformAdminGuard({} as never);
    await expect(guard.canActivate(contextFor('u1'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
