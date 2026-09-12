import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hashToken } from '../common/token';
import { AgentsService } from './agents.service';

const NOW = new Date('2026-08-10T12:00:00.000Z');
const HEARTBEAT = {
  version: '0.10.0',
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
};

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    targetId: 'target-1',
    enrollmentTokenHash: null,
    enrollmentExpiresAt: null,
    credentialHash: null,
    credentialGeneration: 0,
    credentialActivatedAt: null,
    pendingCredentialHash: null,
    pendingCredentialGeneration: null,
    pendingCredentialIssuedAt: null,
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
  const prisma: Record<string, any> = {
    target: {
      findUnique: jest.fn(async () => ({
        name: 'Remote Docker',
        kind: 'docker',
        scope: 'user',
        workspaceId: 'workspace-1',
        managementState: 'active',
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    agent: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
  };
  prisma.$transaction = jest.fn(async (work: unknown): Promise<unknown> =>
    typeof work === 'function'
      ? (work as (transaction: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(work as Promise<unknown>[]));
  const workspaces = {
    roleFor: jest.fn(async () => role),
    can: jest.fn((current: string, permission: string) =>
      permission === 'admin' && ['owner', 'admin'].includes(current),
    ),
  };
  const targets = { disconnect: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  return {
    service: new AgentsService(prisma as never, workspaces as never, targets as never, audit as never),
    prisma,
    workspaces,
    targets,
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
      credentialActivatedAt: NOW,
      pendingCredentialHash: null,
      pendingCredentialGeneration: null,
      pendingCredentialIssuedAt: null,
      version: '0.1.0',
    }));
    expect(JSON.stringify(update.data)).not.toContain(result.credential);
  });

  it('accepts an authenticated heartbeat and stores only bounded Docker telemetry', async () => {
    const credential = `initpad_agent_${'c'.repeat(43)}`;
    const { service, prisma } = setup();
    prisma.agent.findFirst.mockResolvedValue(agentRow({
      credentialHash: hashToken(credential),
      credentialGeneration: 3,
      credentialActivatedAt: NOW,
      enrolledAt: NOW,
      target: { workspaceId: 'workspace-1', name: 'Remote Docker' },
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
      credentialConfirmed: true,
      acceptedAt: NOW.toISOString(),
      nextHeartbeatSeconds: 30,
    });

    expect(prisma.agent.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { credentialHash: hashToken(credential) },
          { pendingCredentialHash: hashToken(credential) },
        ],
      },
      include: { target: { select: { workspaceId: true, name: true } } },
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

  it('stages an overdue credential for a compatible Agent without revoking the active one', async () => {
    const credential = `initpad_agent_${'g'.repeat(43)}`;
    const { service, prisma, audit } = setup();
    prisma.agent.findFirst.mockResolvedValue(agentRow({
      credentialHash: hashToken(credential),
      credentialGeneration: 3,
      credentialActivatedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60_000),
      enrolledAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60_000),
      target: { workspaceId: 'workspace-1', name: 'Remote Docker' },
    }));

    const result = await service.heartbeat(`Bearer ${credential}`, HEARTBEAT);

    expect(result.credentialRotation).toEqual({
      credential: expect.stringMatching(/^initpad_agent_/),
      credentialGeneration: 4,
    });
    const rotationWrite = prisma.agent.updateMany.mock.calls[1][0];
    expect(rotationWrite.where).toEqual(expect.objectContaining({
      id: 'agent-1',
      credentialHash: hashToken(credential),
      credentialGeneration: 3,
      disabledAt: null,
      OR: [
        { pendingCredentialHash: null },
        { pendingCredentialIssuedAt: { lte: new Date(NOW.getTime() - 24 * 60 * 60_000) } },
      ],
    }));
    expect(rotationWrite.data).toEqual({
      pendingCredentialHash: hashToken(result.credentialRotation!.credential),
      pendingCredentialGeneration: 4,
      pendingCredentialIssuedAt: NOW,
    });
    expect(rotationWrite.data).not.toHaveProperty('credentialHash');
    expect(JSON.stringify(rotationWrite.data)).not.toContain(result.credentialRotation!.credential);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      actorUserId: null,
      action: 'agent.credential_rotation_issued',
      details: { generation: 4 },
    }));
  });

  it('promotes a pending credential only after the Agent proves it possesses it', async () => {
    const activeCredential = `initpad_agent_${'h'.repeat(43)}`;
    const pendingCredential = `initpad_agent_${'i'.repeat(43)}`;
    const { service, prisma, audit } = setup();
    prisma.agent.findFirst.mockResolvedValue(agentRow({
      credentialHash: hashToken(activeCredential),
      credentialGeneration: 3,
      credentialActivatedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60_000),
      pendingCredentialHash: hashToken(pendingCredential),
      pendingCredentialGeneration: 4,
      pendingCredentialIssuedAt: NOW,
      target: { workspaceId: 'workspace-1', name: 'Remote Docker' },
    }));

    await expect(service.heartbeat(`Bearer ${pendingCredential}`, HEARTBEAT)).resolves.toEqual({
      targetId: 'target-1',
      credentialGeneration: 4,
      credentialConfirmed: true,
      acceptedAt: NOW.toISOString(),
      nextHeartbeatSeconds: 30,
    });

    expect(prisma.agent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'agent-1',
        pendingCredentialHash: hashToken(pendingCredential),
        pendingCredentialGeneration: 4,
        disabledAt: null,
      },
      data: expect.objectContaining({
        credentialHash: hashToken(pendingCredential),
        credentialGeneration: 4,
        credentialActivatedAt: NOW,
        pendingCredentialHash: null,
        pendingCredentialGeneration: null,
        pendingCredentialIssuedAt: null,
        lastSeenAt: NOW,
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'agent.credential_rotation_activated',
      details: { generation: 4 },
    }));
  });

  it('keeps older Agents on their active credential until they are upgraded', async () => {
    const credential = `initpad_agent_${'j'.repeat(43)}`;
    const { service, prisma } = setup();
    prisma.agent.findFirst.mockResolvedValue(agentRow({
      credentialHash: hashToken(credential),
      credentialGeneration: 2,
      credentialActivatedAt: new Date(NOW.getTime() - 31 * 24 * 60 * 60_000),
      target: { workspaceId: 'workspace-1', name: 'Remote Docker' },
    }));

    const response = await service.heartbeat(`Bearer ${credential}`, {
      ...HEARTBEAT,
      version: '0.9.0',
    });

    expect(response.credentialRotation).toBeUndefined();
    expect(prisma.agent.updateMany).toHaveBeenCalledTimes(1);
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
    expect(malformed.prisma.agent.findFirst).not.toHaveBeenCalled();

    const unknown = setup();
    unknown.prisma.agent.findFirst.mockResolvedValue(null);
    await expect(unknown.service.heartbeat(`Bearer ${credential}`, {
      version: '0.1.0',
      protocolVersion: 1,
      docker: {
        engineVersion: '27.5.1', apiVersion: '1.47', os: 'linux', arch: 'amd64',
        rootless: false, cpus: 2, memoryBytes: 1_073_741_824,
      },
    })).rejects.toBeInstanceOf(UnauthorizedException);

    const revoked = setup();
    revoked.prisma.agent.findFirst.mockResolvedValue(agentRow({
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

  it('invalidates the previous credential when a new credential generation is enrolled', async () => {
    const previousCredential = `initpad_agent_${'e'.repeat(43)}`;
    const currentCredential = `initpad_agent_${'f'.repeat(43)}`;

    const previous = setup();
    previous.prisma.agent.findFirst.mockResolvedValue(null);
    await expect(previous.service.authenticateCredential(`Bearer ${previousCredential}`))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(previous.prisma.agent.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { credentialHash: hashToken(previousCredential) },
          { pendingCredentialHash: hashToken(previousCredential) },
        ],
      },
      include: { target: { select: { workspaceId: true, name: true } } },
    });

    const current = setup();
    current.prisma.agent.findFirst.mockResolvedValue(agentRow({
      credentialHash: hashToken(currentCredential),
      credentialGeneration: 4,
    }));
    await expect(current.service.authenticateCredential(`Bearer ${currentCredential}`))
      .resolves.toMatchObject({
        id: 'agent-1',
        targetId: 'target-1',
        credentialHash: hashToken(currentCredential),
        credentialGeneration: 4,
      });
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
    const { service, prisma, targets } = setup();
    prisma.agent.findUnique.mockResolvedValue(agentRow({ credentialHash: hashToken('credential') }));

    await service.disable('target-1', 'owner-1');

    expect(prisma.target.findUnique).toHaveBeenCalled();
    expect(targets.disconnect).toHaveBeenCalledWith('target-1', 'owner-1');
  });
});
