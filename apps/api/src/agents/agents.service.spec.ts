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
        name: 'Remote Docker',
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
    agentJob: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    workloadDiagnostic: {
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  const workspaces = {
    roleFor: jest.fn(async () => role),
    can: jest.fn((current: string, permission: string) =>
      permission === 'admin' && ['owner', 'admin'].includes(current),
    ),
  };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    service: new AgentsService(prisma as never, workspaces as never, audit as never),
    prisma,
    workspaces,
    audit,
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
    const { service, prisma, audit } = setup();

    const result = await service.issueEnrollment('target-1', 'owner-1');

    expect(result.enrollmentToken).toMatch(/^initpad_enroll_/);
    expect(result.enrollmentPending).toBe(true);
    const call = prisma.agent.upsert.mock.calls[0][0];
    expect(call.create.enrollmentTokenHash).toBe(hashToken(result.enrollmentToken));
    expect(call.create.enrollmentTokenHash).not.toContain(result.enrollmentToken);
    expect(call.create.enrollmentExpiresAt).toEqual(
      new Date(NOW.getTime() + 15 * 60_000),
    );
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'owner-1',
      action: 'agent.enrollment_issued',
      resourceType: 'agent',
      resourceId: 'agent-1',
      resourceName: 'Remote Docker',
      details: {
        targetId: 'target-1',
        generation: 0,
        expiresInMinutes: 15,
      },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(result.enrollmentToken);
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

  it('derives online/offline from the latest heartbeat without persisting a transient status', async () => {
    const { service, prisma } = setup();
    prisma.agent.findUnique
      .mockResolvedValueOnce(agentRow({
        credentialHash: hashToken('credential'),
        lastSeenAt: new Date(NOW.getTime() - 30_000),
      }))
      .mockResolvedValueOnce(agentRow({
        credentialHash: hashToken('credential'),
        lastSeenAt: new Date(NOW.getTime() - 120_000),
      }));

    await expect(service.getForTarget('target-1', 'owner-1')).resolves.toMatchObject({
      state: 'online',
    });
    await expect(service.getForTarget('target-1', 'owner-1')).resolves.toMatchObject({
      state: 'offline',
    });
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

  it('accepts an authenticated heartbeat and stores only bounded Docker telemetry', async () => {
    const credential = `initpad_agent_${'c'.repeat(43)}`;
    const { service, prisma } = setup();
    prisma.agent.findUnique.mockResolvedValue(agentRow({
      credentialHash: hashToken(credential),
      credentialGeneration: 3,
      enrolledAt: NOW,
    }));

    await expect(service.heartbeat(`Bearer ${credential}`, {
      version: '0.1.0',
      protocolVersion: 1,
      docker: {
        engineVersion: '27.5.1',
        apiVersion: '1.47',
        os: 'linux',
        arch: 'arm64',
        rootless: true,
        cpus: 4,
        memoryBytes: 8_589_934_592,
      },
    })).resolves.toEqual({
      targetId: 'target-1',
      credentialGeneration: 3,
      acceptedAt: NOW.toISOString(),
      nextHeartbeatSeconds: 30,
    });

    expect(prisma.agent.findUnique).toHaveBeenCalledWith({
      where: { credentialHash: hashToken(credential) },
    });
    expect(prisma.agent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'agent-1',
        credentialHash: hashToken(credential),
        disabledAt: null,
      },
      data: expect.objectContaining({
        version: '0.1.0',
        protocolVersion: 1,
        lastSeenAt: NOW,
        capabilities: expect.objectContaining({ engineVersion: '27.5.1', cpus: 4 }),
      }),
    });
  });

  it('rejects malformed, unknown and concurrently revoked Agent credentials', async () => {
    const credential = `initpad_agent_${'d'.repeat(43)}`;
    const malformed = setup();
    await expect(malformed.service.heartbeat('Basic nope', {
      version: '0.1.0',
      protocolVersion: 1,
      docker: {
        engineVersion: '27.5.1', apiVersion: '1.47', os: 'linux', arch: 'amd64',
        rootless: false, cpus: 2, memoryBytes: 1_073_741_824,
      },
    })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(malformed.prisma.agent.findUnique).not.toHaveBeenCalled();

    const unknown = setup();
    unknown.prisma.agent.findUnique.mockResolvedValue(null);
    await expect(unknown.service.heartbeat(`Bearer ${credential}`, {
      version: '0.1.0',
      protocolVersion: 1,
      docker: {
        engineVersion: '27.5.1', apiVersion: '1.47', os: 'linux', arch: 'amd64',
        rootless: false, cpus: 2, memoryBytes: 1_073_741_824,
      },
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const revoked = setup();
    revoked.prisma.agent.findUnique.mockResolvedValue(agentRow({
      credentialHash: hashToken(credential),
    }));
    revoked.prisma.agent.updateMany.mockResolvedValue({ count: 0 });
    await expect(revoked.service.heartbeat(`Bearer ${credential}`, {
      version: '0.1.0',
      protocolVersion: 1,
      docker: {
        engineVersion: '27.5.1', apiVersion: '1.47', os: 'linux', arch: 'amd64',
        rootless: false, cpus: 2, memoryBytes: 1_073_741_824,
      },
    })).rejects.toBeInstanceOf(UnauthorizedException);
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
    const { service, prisma, audit } = setup();
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
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith({
      where: { targetId: 'target-1', status: { in: ['blocked', 'queued', 'leased'] } },
      data: expect.objectContaining({
        status: 'cancelled',
        finishedAt: NOW,
      }),
    });
    expect(prisma.workloadDiagnostic.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['queued', 'running'] },
        currentJob: { is: { targetId: 'target-1' } },
      },
      data: expect.objectContaining({
        status: 'failed',
        finishedAt: NOW,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      actorUserId: 'owner-1',
      action: 'agent.disabled',
      resourceType: 'agent',
      resourceId: 'agent-1',
      resourceName: 'Remote Docker',
      details: { targetId: 'target-1' },
    });
  });
});
