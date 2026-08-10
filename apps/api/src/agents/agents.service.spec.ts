import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hashToken } from '../common/token';
import { AgentsService } from './agents.service';

const NOW = new Date('2026-08-10T12:00:00.000Z');

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    targetId: 'target-1',
    enrollmentTokenHash: null,
    enrollmentExpiresAt: null,
    credentialHash: null,
    credentialGeneration: 0,
    protocolVersion: 1,
    version: null,
    capabilities: null,
    enrolledAt: null,
    lastSeenAt: null,
    disabledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup(role: string | null = 'owner') {
  const prisma = {
    target: {
      findUnique: jest.fn(async () => ({
        kind: 'docker',
        scope: 'user',
        workspaceId: 'workspace-1',
      })),
    },
    agent: {
      findUnique: jest.fn(),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) =>
        agentRow({
          enrollmentTokenHash: create.enrollmentTokenHash,
          enrollmentExpiresAt: create.enrollmentExpiresAt,
        }),
      ),
      updateMany: jest.fn(async (_args: Record<string, unknown>) => ({ count: 1 })),
      update: jest.fn(async (_args: Record<string, unknown>) => agentRow()),
    },
  };
  const workspaces = {
    roleFor: jest.fn(async () => role),
    can: jest.fn((current: string, permission: string) =>
      permission === 'admin' && ['owner', 'admin'].includes(current),
    ),
  };
  return {
    service: new AgentsService(prisma as never, workspaces as never),
    prisma,
    workspaces,
  };
}

describe('AgentsService trust bootstrap', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues a short-lived enrollment secret but persists only its hash', async () => {
    const { service, prisma } = setup();

    const result = await service.issueEnrollment('target-1', 'owner-1');

    expect(result.enrollmentToken).toMatch(/^initpad_enroll_/);
    expect(result.enrollmentPending).toBe(true);
    const call = prisma.agent.upsert.mock.calls[0][0];
    expect(call.create.enrollmentTokenHash).toBe(hashToken(result.enrollmentToken));
    expect(call.create.enrollmentTokenHash).not.toContain(result.enrollmentToken);
    expect(call.create.enrollmentExpiresAt).toEqual(
      new Date(NOW.getTime() + 15 * 60_000),
    );
  });

  it('does not let a non-admin issue physical Agent credentials', async () => {
    const { service, prisma } = setup('member');

    await expect(service.issueEnrollment('target-1', 'member-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('hides a target belonging to another workspace', async () => {
    const { service, prisma } = setup(null);

    await expect(service.getForTarget('target-1', 'stranger')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
  });

  it('redeems the enrollment once and stores only the Agent credential hash', async () => {
    const token = `initpad_enroll_${'a'.repeat(43)}`;
    const { service, prisma } = setup();
    prisma.agent.findUnique.mockResolvedValue(
      agentRow({
        enrollmentTokenHash: hashToken(token),
        enrollmentExpiresAt: new Date(NOW.getTime() + 60_000),
        credentialGeneration: 2,
      }),
    );

    const result = await service.enroll({ token, version: '0.1.0', protocolVersion: 1 });

    expect(result).toMatchObject({
      agentId: 'agent-1',
      targetId: 'target-1',
      credentialGeneration: 3,
      protocolVersion: 1,
    });
    expect(result.credential).toMatch(/^initpad_agent_/);
    const update = prisma.agent.updateMany.mock.calls[0][0];
    expect(update.where).toEqual(expect.objectContaining({
      id: 'agent-1',
      enrollmentTokenHash: hashToken(token),
      disabledAt: null,
    }));
    expect(update.data).toEqual(expect.objectContaining({
      enrollmentTokenHash: null,
      enrollmentExpiresAt: null,
      credentialHash: hashToken(result.credential),
      credentialGeneration: 3,
      version: '0.1.0',
    }));
    expect(JSON.stringify(update.data)).not.toContain(result.credential);
  });

  it('rejects expired and concurrently consumed enrollment tokens', async () => {
    const token = `initpad_enroll_${'b'.repeat(43)}`;
    const expired = setup();
    expired.prisma.agent.findUnique.mockResolvedValue(
      agentRow({
        enrollmentTokenHash: hashToken(token),
        enrollmentExpiresAt: new Date(NOW.getTime() - 1),
      }),
    );
    await expect(
      expired.service.enroll({ token, version: '0.1.0', protocolVersion: 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(expired.prisma.agent.updateMany).not.toHaveBeenCalled();

    const raced = setup();
    raced.prisma.agent.findUnique.mockResolvedValue(
      agentRow({
        enrollmentTokenHash: hashToken(token),
        enrollmentExpiresAt: new Date(NOW.getTime() + 60_000),
      }),
    );
    raced.prisma.agent.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      raced.service.enroll({ token, version: '0.1.0', protocolVersion: 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('disables the identity without deleting the physical target', async () => {
    const { service, prisma } = setup();
    prisma.agent.findUnique.mockResolvedValue(agentRow({ credentialHash: hashToken('credential') }));

    await service.disable('target-1', 'owner-1');

    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { targetId: 'target-1' },
      data: expect.objectContaining({
        disabledAt: NOW,
        enrollmentTokenHash: null,
        enrollmentExpiresAt: null,
        credentialHash: null,
      }),
    });
    expect(prisma.target.findUnique).toHaveBeenCalled();
  });
});
