import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Readable } from 'stream';
import { encryptSecret } from '../common/secret';
import { hashToken } from '../common/token';
import { AgentJobsService } from './agent-jobs.service';
import { agentConfigFingerprint } from './agent-config-fingerprint';

const NOW = new Date('2026-08-12T09:00:00.000Z');
const AGENT = {
  id: 'agent-1',
  targetId: 'target-1',
  credentialHash: hashToken(`initpad_agent_${'a'.repeat(43)}`),
  credentialGeneration: 1,
  protocolVersion: 1,
};
const LEASE = `initpad_lease_${'b'.repeat(43)}`;

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    correlationId: '123e4567-e89b-42d3-a456-426614174099',
    targetId: 'target-1',
    kind: 'probe',
    protocolVersion: 1,
    payload: { durationSeconds: 35 },
    status: 'leased',
    attempt: 1,
    leasedByAgentId: 'agent-1',
    leaseTokenHash: hashToken(LEASE),
    leaseExpiresAt: new Date(NOW.getTime() + 30_000),
    progressSequence: 1,
    progressPercent: 10,
    progressStage: 'working',
    message: 'Probe running',
    resultCode: null,
    createdAt: NOW,
    leasedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    agent: {
      findUnique: jest.fn(
        async (): Promise<{
          credentialHash: string;
          disabledAt: Date | null;
          version: string;
          target: {
            kind: string;
            scope: string;
            workspaceId: string;
            capabilities: string;
            publicUrl: string;
            routingMode: string;
            gatewayAdapter: string | null;
            workspace: { slug: string };
          };
        } | null> => ({
          credentialHash: 'hash',
          disabledAt: null,
          version: '0.3.0',
          target: {
            kind: 'docker',
            scope: 'user',
            workspaceId: 'workspace-1',
            capabilities: 'node,php,static',
            publicUrl: 'https://apps.example.test',
            routingMode: 'direct-port',
            gatewayAdapter: null,
            workspace: { slug: 'team-alpha' },
          },
        }),
      ),
    },
    targetAllocation: {
      upsert: jest.fn(async () => ({ id: 'allocation-1', namespace: 'team-alpha' })),
    },
    agentJob: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        job({ ...data, status: 'queued', attempt: 0, leasedAt: null, leaseExpiresAt: null }),
      ),
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) =>
        job({ ...create, status: 'queued', attempt: 0, leasedAt: null, leaseExpiresAt: null }),
      ),
      findMany: jest.fn(async () => [job()]),
      findFirst: jest.fn(
        async (args?: { select?: { kind?: boolean } }): Promise<Record<string, unknown> | null> =>
          args?.select?.kind ? { kind: 'probe' } : null,
      ),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(async () => job()),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    deploymentOperation: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    environment: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    workloadDiagnostic: {
      findUnique: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    target: {
      findMany: jest.fn(async (): Promise<Array<{ gatewayPreflightJobId: string | null }>> => []),
      update: jest.fn(async () => ({ id: 'target-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    gatewayRoute: {
      findMany: jest.fn(async (): Promise<Array<{ reconcileJobId: string | null }>> => []),
      updateMany: jest.fn(async (_input: unknown) => ({ count: 1 })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (input: unknown) =>
    typeof input === 'function'
      ? (input as (transaction: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(input as Promise<unknown>[]),
  );
  const agents = {
    requireTargetAccess: jest.fn(async () => undefined),
    authenticateCredential: jest.fn(async () => AGENT),
  };
  const artifactStore = {
    head: jest.fn(async () => ({ sizeBytes: 13 })),
    openRead: jest.fn(async () => Readable.from('archive-bytes')),
  };
  const gatewayRoutes = {
    queueReconcile: jest.fn(async () => ({
      routeId: 'route-1',
      jobId: 'route-job-1',
      generation: 1,
      status: 'queued',
    })),
  };
  const audit = { recordOperationResult: jest.fn(async () => undefined) };
  return {
    service: new AgentJobsService(
      prisma as never,
      agents as never,
      artifactStore as never,
      gatewayRoutes as never,
      audit,
    ),
    prisma,
    agents,
    artifactStore,
    gatewayRoutes,
    audit,
  };
}

function deliveryBinding(overrides: Record<string, unknown> = {}) {
  const configVars = [
    { key: 'APP_MODE', value: 'production', isSecret: false },
    { key: 'DATABASE_PASSWORD', value: encryptSecret('db-secret'), isSecret: true },
  ];
  return {
    kind: 'deploy',
    payload: { configFingerprint: agentConfigFingerprint(configVars) },
    targetId: 'target-1',
    allocationId: 'allocation-1',
    deploymentOperation: {
      buildArtifact: {
        digest: 'a'.repeat(64),
        sizeBytes: 13n,
        status: 'available',
        storageKind: 'object-store',
        storageRef: 'artifacts/ws/project/artifact/a.tar',
      },
      environment: {
        targetId: 'target-1',
        allocationId: 'allocation-1',
        configVars,
      },
    },
    ...overrides,
  };
}

describe('AgentJobsService durable lease protocol', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('replays only current preflight fences instead of scanning terminal history', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findMany.mockResolvedValue([]);
    prisma.target.findMany.mockResolvedValue([{ gatewayPreflightJobId: 'current-preflight' }]);
    prisma.agentJob.findUnique.mockResolvedValue(
      job({
        id: 'current-preflight',
        kind: 'gateway-preflight',
        status: 'succeeded',
        finishedAt: NOW,
      }),
    );

    await service.onModuleInit();

    expect(prisma.agentJob.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['succeeded', 'failed'] },
        deploymentOperation: { is: { status: 'running', finishedAt: null } },
      },
      select: { id: true },
    });
    expect(prisma.target.findMany).toHaveBeenCalledWith({
      where: {
        gatewayPreflightStatus: { in: ['queued', 'running'] },
        gatewayPreflightJobId: { not: null },
      },
      select: { gatewayPreflightJobId: true },
    });
    expect(prisma.gatewayRoute.findMany).toHaveBeenCalledWith({
      where: { reconcileJobId: { not: null } },
      select: { reconcileJobId: true },
    });
  });

  it('creates an idempotent, bounded probe job for an enrolled target', async () => {
    const { service, prisma, agents } = setup();
    const dto = { requestId: '123e4567-e89b-42d3-a456-426614174000', durationSeconds: 35 };

    await expect(service.createProbe('target-1', 'owner-1', dto)).resolves.toMatchObject({
      kind: 'probe',
      status: 'queued',
    });
    expect(agents.requireTargetAccess).toHaveBeenCalledWith('target-1', 'owner-1', 'admin');
    expect(prisma.agentJob.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: `probe:target-1:${dto.requestId}` },
      update: {},
      create: expect.objectContaining({
        targetId: 'target-1',
        payload: { durationSeconds: 35 },
      }),
    });
  });

  it('does not queue a probe before enrollment', async () => {
    const { service, prisma } = setup();
    prisma.agent.findUnique.mockResolvedValue(null);
    await expect(
      service.createProbe('target-1', 'owner-1', {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        durationSeconds: 35,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentJob.upsert).not.toHaveBeenCalled();
  });

  it('queues an allocation-scoped lifecycle test without executable input or secrets', async () => {
    const { service, prisma, agents } = setup();
    const requestId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(
      service.createLifecycleTest('target-1', 'owner-1', { requestId }),
    ).resolves.toMatchObject({ kind: 'lifecycle-test', status: 'queued' });

    expect(agents.requireTargetAccess).toHaveBeenCalledWith('target-1', 'owner-1', 'admin');
    expect(prisma.targetAllocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_targetId: { workspaceId: 'workspace-1', targetId: 'target-1' } },
        create: expect.objectContaining({
          namespace: 'team-alpha',
          capabilities: 'node,php,static',
        }),
      }),
    );
    const create = prisma.agentJob.upsert.mock.calls.at(-1)?.[0].create as {
      allocationId: string;
      payload: Record<string, unknown>;
    };
    expect(create.allocationId).toBe('allocation-1');
    expect(create.payload).toEqual(
      expect.objectContaining({
        allocationId: 'allocation-1',
        namespace: 'team-alpha',
        environment: `diagnostic-${createHash('sha256')
          .update('allocation-1')
          .digest('hex')
          .slice(0, 12)}`,
        imageRef: expect.stringMatching(/^nginx@sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(create.payload).not.toHaveProperty('command');
    expect(create.payload).not.toHaveProperty('secret');
  });

  it('does not queue lifecycle work for an outdated Agent', async () => {
    const { service, prisma } = setup();
    const enrolled = await prisma.agent.findUnique();
    prisma.agent.findUnique.mockResolvedValue({ ...enrolled!, version: '0.2.0' });

    await expect(
      service.createLifecycleTest('target-1', 'owner-1', {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).rejects.toThrow(/0\.3\.0 or newer/);
    expect(prisma.targetAllocation.upsert).not.toHaveBeenCalled();
  });

  it('queues a fenced read-only gateway preflight for Agent 0.5', async () => {
    const { service, prisma, agents } = setup();
    const enrolled = await prisma.agent.findUnique();
    prisma.agent.findUnique.mockResolvedValue({
      ...enrolled!,
      version: '0.5.0',
      target: {
        ...enrolled!.target,
        routingMode: 'managed-gateway',
        gatewayAdapter: 'caddy',
      },
    });
    const requestId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(
      service.createGatewayPreflight('target-1', 'owner-1', { requestId }),
    ).resolves.toMatchObject({ kind: 'gateway-preflight', status: 'queued' });

    expect(agents.requireTargetAccess).toHaveBeenCalledWith('target-1', 'owner-1', 'admin');
    expect(prisma.agentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey: `gateway-preflight:target-1:${requestId}`,
        kind: 'gateway-preflight',
        payload: { adapter: 'caddy', publicUrl: 'https://apps.example.test' },
      }),
    });
    expect(prisma.target.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'target-1' },
        data: expect.objectContaining({ gatewayPreflightStatus: 'queued' }),
      }),
    );
  });

  it('returns an idempotent gateway retry without moving the current target fence', async () => {
    const { service, prisma } = setup();
    const enrolled = await prisma.agent.findUnique();
    prisma.agent.findUnique.mockResolvedValue({
      ...enrolled!,
      version: '0.5.0',
      target: {
        ...enrolled!.target,
        routingMode: 'managed-gateway',
        gatewayAdapter: 'caddy',
      },
    });
    const existing = job({
      id: 'older-job',
      kind: 'gateway-preflight',
      status: 'succeeded',
      finishedAt: NOW,
    });
    prisma.agentJob.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.2',
      }),
    );
    prisma.agentJob.findUnique.mockResolvedValue(existing);

    await expect(
      service.createGatewayPreflight('target-1', 'owner-1', {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).resolves.toMatchObject({ id: 'older-job', status: 'succeeded' });

    expect(prisma.target.update).not.toHaveBeenCalled();
  });

  it('rejects gateway preflight for an old Agent or a direct-port target', async () => {
    const { service, prisma } = setup();
    await expect(
      service.createGatewayPreflight('target-1', 'owner-1', {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).rejects.toThrow('0.5.0');

    const enrolled = await prisma.agent.findUnique();
    prisma.agent.findUnique.mockResolvedValue({ ...enrolled!, version: '0.5.0' });
    await expect(
      service.createGatewayPreflight('target-1', 'owner-1', {
        requestId: '123e4567-e89b-42d3-a456-426614174001',
      }),
    ).rejects.toThrow('managed-gateway');
  });

  it('publishes a terminal gateway preflight only through the current job fence', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'gateway-preflight',
      status: 'succeeded',
      message: 'Gateway DNS, TLS and Caddy adapter preflight passed',
      resultCode: 'ok',
      leaseExpiresAt: null,
      finishedAt: NOW,
    });
    prisma.agentJob.findUnique
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce({ ...terminal, deploymentOperation: null });
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: terminal.message,
      resultCode: 'ok',
    });

    expect(prisma.target.updateMany).toHaveBeenCalledWith({
      where: { id: 'target-1', gatewayPreflightJobId: 'job-1' },
      data: {
        gatewayPreflightStatus: 'passed',
        gatewayPreflightAt: NOW,
        gatewayPreflightError: null,
      },
    });
  });

  it('publishes a successful gateway route only through its generation and job fences', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'gateway-route',
      status: 'succeeded',
      gatewayRouteId: 'route-1',
      payload: {
        routeId: 'route-1',
        generation: 7,
        desiredState: 'active',
        revision: 'abc123',
      },
      message: 'Gateway route generation 7 reconciled to active',
      resultCode: 'ok',
      leaseExpiresAt: null,
      finishedAt: NOW,
    });
    prisma.agentJob.findUnique
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce({ ...terminal, deploymentOperation: null });
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: terminal.message,
      resultCode: 'ok',
    });

    expect(prisma.gatewayRoute.updateMany).toHaveBeenCalledWith({
      where: { id: 'route-1', generation: 7, reconcileJobId: 'job-1' },
      data: {
        observedState: 'active',
        observedRevision: 'abc123',
        observedGeneration: 7,
        reconcileJobId: null,
        lastError: null,
        reconciledAt: NOW,
      },
    });
  });

  it('records a route failure without discarding the last known-good observation', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'gateway-route',
      status: 'failed',
      gatewayRouteId: 'route-1',
      payload: {
        routeId: 'route-1',
        generation: 8,
        desiredState: 'stopped',
        revision: 'abc123',
      },
      message: 'Caddy configuration changed concurrently',
      resultCode: 'gateway_route_failed',
      leaseExpiresAt: null,
      finishedAt: NOW,
    });
    prisma.agentJob.findUnique
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce({ ...terminal, deploymentOperation: null });
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'failed',
      message: terminal.message,
      resultCode: 'gateway_route_failed',
    });

    const update = prisma.gatewayRoute.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.where).toEqual({ id: 'route-1', generation: 8, reconcileJobId: 'job-1' });
    expect(update.data).toEqual({
      reconcileJobId: null,
      lastError: 'Caddy configuration changed concurrently',
      reconciledAt: NOW,
    });
    expect(update.data).not.toHaveProperty('observedState');
    expect(update.data).not.toHaveProperty('observedRevision');
    expect(update.data).not.toHaveProperty('observedGeneration');
  });

  it('atomically projects only bounded output from a successful logs job', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'logs',
      status: 'succeeded',
      message: 'Workload is stopped and not-running',
      resultCode: 'ok',
      result: { state: 'stopped', revision: 'a'.repeat(40) },
      leaseExpiresAt: null,
      finishedAt: NOW,
    });
    prisma.agentJob.findFirst.mockResolvedValueOnce({ kind: 'logs' });
    prisma.agentJob.findUnique
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce({ ...terminal, deploymentOperation: null });
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: terminal.message,
      resultCode: 'ok',
      result: { state: 'stopped', revision: 'a'.repeat(40) },
      diagnostic: {
        exitCode: 137,
        health: 'not-running',
        logs: 'last 200 lines only',
      },
    });

    expect(prisma.workloadDiagnostic.updateMany).toHaveBeenCalledWith({
      where: { currentJobId: 'job-1', status: { in: ['queued', 'running'] } },
      data: {
        status: 'succeeded',
        runtimeState: 'stopped',
        revision: 'a'.repeat(40),
        exitCode: 137,
        health: 'not-running',
        logs: 'last 200 lines only',
        message: terminal.message,
        observedAt: NOW,
        finishedAt: NOW,
      },
    });
    const jobUpdate = (
      prisma.agentJob.updateMany.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>
    )[0][0];
    expect(JSON.stringify(jobUpdate.data)).not.toContain('last 200 lines only');
  });

  it('atomically claims only a compatible job on the authenticated target', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      leaseTokenHash: null,
    });
    prisma.agentJob.findUniqueOrThrow.mockImplementation(async () => job());

    const result = await service.claim('Bearer credential');

    expect(result.job).toEqual(
      expect.objectContaining({
        id: 'job-1',
        targetId: 'target-1',
        correlationId: '123e4567-e89b-42d3-a456-426614174099',
        leaseToken: expect.stringMatching(/^initpad_lease_/),
      }),
    );
    expect(prisma.agentJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetId: 'target-1',
          protocolVersion: { lte: 1 },
        }),
      }),
    );
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', status: 'queued' }),
        data: expect.objectContaining({
          status: 'leased',
          attempt: { increment: 1 },
          leaseTokenHash: expect.any(String),
        }),
      }),
    );
  });

  it('cannot claim after its credential is revoked between authentication and the claim CAS', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      leaseTokenHash: null,
    });
    prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claim('Bearer credential')).resolves.toEqual({
      job: null,
      nextPollSeconds: 1,
    });

    expect(prisma.agentJob.updateMany).toHaveBeenCalledTimes(3);
    const updateCalls = prisma.agentJob.updateMany.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >;
    for (const [call] of updateCalls) {
      expect(call.where).toEqual(
        expect.objectContaining({
          targetId: AGENT.targetId,
          target: {
            agent: {
              is: {
                id: AGENT.id,
                OR: [
                  { credentialHash: AGENT.credentialHash },
                  { pendingCredentialHash: AGENT.credentialHash },
                ],
                disabledAt: null,
              },
            },
          },
        }),
      );
    }
    expect(prisma.agentJob.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('reclaims an expired lease with a new fencing token and attempt', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findFirst.mockResolvedValue({
      id: 'job-1',
      status: 'leased',
      leaseTokenHash: 'expired-hash',
    });

    await service.claim('Bearer credential');

    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job-1',
          status: 'leased',
          leaseTokenHash: 'expired-hash',
          leaseExpiresAt: { lte: NOW },
        }),
        data: expect.objectContaining({ attempt: { increment: 1 } }),
      }),
    );
  });

  it('recovers an expired attempt and commits exactly one terminal result', async () => {
    const { service, prisma } = setup();
    const row = job({
      status: 'queued',
      attempt: 0,
      leasedByAgentId: null,
      leaseTokenHash: null,
      leaseExpiresAt: null,
      progressSequence: 0,
      progressPercent: 0,
      progressStage: 'queued',
      message: 'Waiting for Agent',
      result: null,
      leasedAt: null,
    });
    let terminalWrites = 0;
    const matches = (where: Record<string, any>): boolean => {
      if (where.id !== undefined && where.id !== row.id) return false;
      if (where.targetId !== undefined && where.targetId !== row.targetId) return false;
      if (typeof where.status === 'string' && where.status !== row.status) return false;
      if (where.leasedByAgentId !== undefined && where.leasedByAgentId !== row.leasedByAgentId)
        return false;
      if (where.leaseTokenHash !== undefined && where.leaseTokenHash !== row.leaseTokenHash)
        return false;
      if (
        where.leaseExpiresAt?.lte &&
        (!row.leaseExpiresAt || row.leaseExpiresAt > where.leaseExpiresAt.lte)
      ) {
        return false;
      }
      if (
        where.leaseExpiresAt?.gt &&
        (!row.leaseExpiresAt || row.leaseExpiresAt <= where.leaseExpiresAt.gt)
      ) {
        return false;
      }
      if (
        where.progressSequence?.lt !== undefined &&
        row.progressSequence >= where.progressSequence.lt
      ) {
        return false;
      }
      if (Array.isArray(where.OR)) {
        const queued = where.OR.some(
          (candidate: Record<string, any>) =>
            candidate.status === 'queued' && row.status === 'queued',
        );
        const expired = where.OR.some(
          (candidate: Record<string, any>) =>
            candidate.status === 'leased' &&
            row.status === 'leased' &&
            row.leaseExpiresAt &&
            row.leaseExpiresAt <= candidate.leaseExpiresAt.lte,
        );
        if (!queued && !expired) return false;
      }
      return true;
    };
    (prisma.agentJob.findFirst as jest.Mock).mockImplementation(async ({ where, select }) => {
      if (!matches(where)) return null;
      if (select?.id && select?.status) {
        return { id: row.id, status: row.status, leaseTokenHash: row.leaseTokenHash };
      }
      if (select?.kind) return { kind: row.kind };
      return { ...row };
    });
    (prisma.agentJob.findUnique as jest.Mock).mockImplementation(async () => ({ ...row }));
    (prisma.agentJob.findUniqueOrThrow as jest.Mock).mockImplementation(async () => ({ ...row }));
    (prisma.agentJob.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
      if (!matches(where)) return { count: 0 };
      const previousStatus = row.status;
      for (const [key, value] of Object.entries(data as Record<string, any>)) {
        if (value === undefined) continue;
        if (value === Prisma.DbNull) {
          (row as Record<string, any>)[key] = null;
        } else if (value && typeof value === 'object' && value.increment !== undefined) {
          (row as Record<string, any>)[key] += value.increment;
        } else {
          (row as Record<string, any>)[key] = value;
        }
      }
      if (previousStatus === 'leased' && ['succeeded', 'failed'].includes(row.status)) {
        terminalWrites += 1;
      }
      return { count: 1 };
    });

    const first = await service.claim('Bearer credential');
    expect(first.job?.attempt).toBe(1);
    const firstLease = first.job!.leaseToken;

    jest.setSystemTime(new Date(NOW.getTime() + 31_000));
    const second = await service.claim('Bearer credential');
    expect(second.job?.attempt).toBe(2);
    expect(second.job?.leaseToken).not.toBe(firstLease);

    await expect(
      service.complete('Bearer credential', row.id, {
        leaseToken: firstLease,
        status: 'succeeded',
        message: 'Stale completion',
        resultCode: 'ok',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const completion = {
      leaseToken: second.job!.leaseToken,
      status: 'succeeded' as const,
      message: 'Recovered completion',
      resultCode: 'ok',
    };
    await expect(service.complete('Bearer credential', row.id, completion)).resolves.toMatchObject({
      status: 'succeeded',
      attempt: 2,
    });
    await expect(service.complete('Bearer credential', row.id, completion)).resolves.toMatchObject({
      status: 'succeeded',
      attempt: 2,
    });

    expect(terminalWrites).toBe(1);
    await expect(service.claim('Bearer credential')).resolves.toEqual({
      job: null,
      nextPollSeconds: 2,
    });
  });

  it('materializes artifact metadata and decrypted config only for the winning deploy lease', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst
      .mockResolvedValueOnce({ id: 'job-1', status: 'queued', leaseTokenHash: null })
      .mockResolvedValueOnce(deliveryBinding());
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(
      job({
        kind: 'deploy',
        allocationId: 'allocation-1',
        deploymentOperationId: 'operation-1',
        payload: {
          allocationId: 'allocation-1',
          projectSlug: 'sample-project',
          environment: 'dev',
        },
      }),
    );

    const result = await service.claim('Bearer credential');

    expect(result.job).toMatchObject({
      kind: 'deploy',
      payload: {
        allocationId: 'allocation-1',
        projectSlug: 'sample-project',
        environment: 'dev',
      },
      delivery: {
        artifact: {
          path: '/api/agent/jobs/job-1/artifact',
          sha256: 'a'.repeat(64),
          sizeBytes: 13,
        },
        envVars: {
          APP_MODE: 'production',
          DATABASE_PASSWORD: 'db-secret',
        },
      },
    });
    expect(result.job?.payload as Record<string, unknown>).not.toHaveProperty('envVars');
    expect(JSON.stringify(prisma.agentJob.updateMany.mock.calls)).not.toContain('db-secret');
    expect(artifactStore.head).toHaveBeenCalledWith('artifacts/ws/project/artifact/a.tar');
    expect(prisma.deploymentOperation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'operation-1',
        status: 'running',
        finishedAt: null,
        phase: { in: ['queued'] },
      },
      data: { phase: 'assigned', message: 'Claimed by Agent' },
    });
  });

  it('fails a claimed deploy instead of delivering config changed after queueing', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst
      .mockResolvedValueOnce({ id: 'job-1', status: 'queued', leaseTokenHash: null })
      .mockResolvedValueOnce(
        deliveryBinding({
          payload: { configFingerprint: 'f'.repeat(64) },
        }),
      )
      .mockResolvedValueOnce(null);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(job({ kind: 'deploy' }));
    prisma.agentJob.findUnique.mockResolvedValue(
      job({
        kind: 'deploy',
        status: 'failed',
        deploymentOperation: null,
      }),
    );

    await expect(service.claim('Bearer credential')).resolves.toEqual({
      job: null,
      nextPollSeconds: 2,
    });
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          resultCode: 'delivery_invalid',
          message: expect.stringContaining('config changed'),
        }),
      }),
    );
    expect(artifactStore.head).not.toHaveBeenCalled();
  });

  it('fails safely before delivery when object storage is unavailable', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst
      .mockResolvedValueOnce({ id: 'job-1', status: 'queued', leaseTokenHash: null })
      .mockResolvedValueOnce(deliveryBinding())
      .mockResolvedValueOnce(null);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(job({ kind: 'deploy' }));
    prisma.agentJob.findUnique.mockResolvedValue(
      job({
        kind: 'deploy',
        status: 'failed',
        deploymentOperation: null,
      }),
    );
    artifactStore.head.mockRejectedValueOnce(new Error('object storage unavailable'));

    await expect(service.claim('Bearer credential')).resolves.toEqual({
      job: null,
      nextPollSeconds: 2,
    });
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          resultCode: 'delivery_invalid',
          message: 'object storage unavailable',
        }),
      }),
    );
    expect(artifactStore.openRead).not.toHaveBeenCalled();
  });

  it('streams a verified artifact only under the current target lease', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst.mockResolvedValue(deliveryBinding());

    const download = await service.openArtifact('Bearer credential', 'job-1', LEASE);

    expect(download).toMatchObject({ sha256: 'a'.repeat(64), sizeBytes: 13 });
    expect(artifactStore.openRead).toHaveBeenCalledWith('artifacts/ws/project/artifact/a.tar');
    expect(
      await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        download.stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        download.stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        download.stream.on('error', reject);
      }),
    ).toBe('archive-bytes');
  });

  it('does not expose an artifact after the lease is lost', async () => {
    const { service, prisma, artifactStore } = setup();
    prisma.agentJob.findFirst.mockResolvedValue(null);

    await expect(service.openArtifact('Bearer credential', 'job-1', LEASE)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(artifactStore.openRead).not.toHaveBeenCalled();
  });

  it('rejects artifact, renew, progress and completion for a job outside the Agent target', async () => {
    const artifact = setup();
    artifact.prisma.agentJob.findFirst.mockResolvedValue(null);
    await expect(
      artifact.service.openArtifact('Bearer credential', 'foreign-job', LEASE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(artifact.artifactStore.openRead).not.toHaveBeenCalled();
    expect(artifact.prisma.agentJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetId: AGENT.targetId, leasedByAgentId: AGENT.id }),
      }),
    );

    const renew = setup();
    renew.prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      renew.service.renew('Bearer credential', 'foreign-job', LEASE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(renew.prisma.agentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetId: AGENT.targetId, leasedByAgentId: AGENT.id }),
      }),
    );

    const progress = setup();
    progress.prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    progress.prisma.agentJob.findFirst.mockResolvedValue(null);
    await expect(
      progress.service.progress('Bearer credential', 'foreign-job', {
        leaseToken: LEASE,
        sequence: 2,
        percent: 40,
        stage: 'working',
        message: 'Foreign progress',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(progress.prisma.deploymentOperation.updateMany).not.toHaveBeenCalled();
    expect(progress.prisma.workloadDiagnostic.updateMany).not.toHaveBeenCalled();

    const completion = setup();
    completion.prisma.agentJob.findFirst.mockResolvedValue(null);
    await expect(
      completion.service.complete('Bearer credential', 'foreign-job', {
        leaseToken: LEASE,
        status: 'succeeded',
        message: 'Foreign completion',
        resultCode: 'ok',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(completion.prisma.$transaction).not.toHaveBeenCalled();
    expect(completion.prisma.agentJob.findUnique).not.toHaveBeenCalled();
  });

  it('renews and advances progress only under the current unexpired lease', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(
      job({
        progressSequence: 2,
        progressPercent: 40,
      }),
    );

    await expect(service.renew('Bearer credential', 'job-1', LEASE)).resolves.toEqual({
      leaseExpiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    });
    await expect(
      service.progress('Bearer credential', 'job-1', {
        leaseToken: LEASE,
        sequence: 2,
        percent: 40,
        stage: 'working',
        message: 'Still running',
      }),
    ).resolves.toMatchObject({ progressSequence: 2, progressPercent: 40 });
    expect(prisma.agentJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leaseTokenHash: hashToken(LEASE),
          leaseExpiresAt: { gt: NOW },
          progressSequence: { lt: 2 },
        }),
      }),
    );
  });

  it('rejects a stale fencing token after the lease has been reassigned', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.agentJob.findUnique.mockResolvedValue(
      job({
        leaseTokenHash: hashToken(`initpad_lease_${'c'.repeat(43)}`),
        attempt: 2,
      }),
    );

    await expect(
      service.progress('Bearer credential', 'job-1', {
        leaseToken: LEASE,
        sequence: 2,
        percent: 40,
        stage: 'working',
        message: 'Stale worker',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not regress mirrored state when an older progress delivery is duplicated', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    prisma.agentJob.findFirst.mockResolvedValue(
      job({
        progressSequence: 3,
        progressPercent: 70,
        progressStage: 'verifying',
        message: 'Verifying current deployment',
        deploymentOperationId: 'operation-1',
      }),
    );

    await expect(
      service.progress('Bearer credential', 'job-1', {
        leaseToken: LEASE,
        sequence: 2,
        percent: 40,
        stage: 'working',
        message: 'Late duplicate',
      }),
    ).resolves.toMatchObject({
      progressSequence: 3,
      progressPercent: 70,
      progressStage: 'verifying',
      message: 'Verifying current deployment',
    });

    expect(prisma.workloadDiagnostic.updateMany).toHaveBeenCalledWith({
      where: { currentJobId: 'job-1', status: { in: ['queued', 'running'] } },
      data: { status: 'running', message: 'Verifying current deployment' },
    });
    expect(JSON.stringify(prisma.deploymentOperation.updateMany.mock.calls)).not.toContain(
      'Late duplicate',
    );
  });

  it('makes an identical completion retry idempotent after a lost response', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    const terminal = job({
      status: 'succeeded',
      leaseExpiresAt: null,
      progressPercent: 100,
      progressStage: 'succeeded',
      message: 'Probe completed',
      resultCode: 'ok',
      finishedAt: NOW,
    });
    prisma.agentJob.findFirst
      .mockResolvedValueOnce({ kind: 'probe' })
      .mockResolvedValueOnce(terminal);
    prisma.agentJob.findUnique.mockResolvedValue(terminal);

    await expect(
      service.complete('Bearer credential', 'job-1', {
        leaseToken: LEASE,
        status: 'succeeded',
        message: 'Probe completed',
        resultCode: 'ok',
      }),
    ).resolves.toMatchObject({ status: 'succeeded', resultCode: 'ok' });
  });

  it('rejects a changed completion replay and a revoke race after binding validation', async () => {
    const changed = setup();
    changed.prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    changed.prisma.agentJob.findFirst
      .mockResolvedValueOnce({ kind: 'probe' })
      .mockResolvedValueOnce(
        job({
          status: 'succeeded',
          leaseExpiresAt: null,
          message: 'Original completion',
          resultCode: 'ok',
          finishedAt: NOW,
        }),
      );

    await expect(
      changed.service.complete('Bearer credential', 'job-1', {
        leaseToken: LEASE,
        status: 'succeeded',
        message: 'Changed replay',
        resultCode: 'ok',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(changed.prisma.deploymentOperation.updateMany).not.toHaveBeenCalled();

    const revoked = setup();
    revoked.prisma.agentJob.updateMany.mockResolvedValue({ count: 0 });
    revoked.prisma.agentJob.findFirst
      .mockResolvedValueOnce({ kind: 'probe' })
      .mockResolvedValueOnce(null);

    await expect(
      revoked.service.complete('Bearer credential', 'job-1', {
        leaseToken: LEASE,
        status: 'succeeded',
        message: 'Probe completed',
        resultCode: 'ok',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(revoked.prisma.deploymentOperation.updateMany).not.toHaveBeenCalled();
  });

  it('mirrors Agent progress into the project operation and live environment', async () => {
    const { service, prisma } = setup();
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(
      job({ deploymentOperationId: 'operation-1' }),
    );
    prisma.agentJob.findUnique.mockResolvedValue(job({ deploymentOperationId: 'operation-1' }));

    await service.progress('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      sequence: 2,
      percent: 40,
      stage: 'working',
      message: 'Loading verified image',
    });

    expect(prisma.deploymentOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'operation-1', status: 'running' },
      data: { message: 'Loading verified image' },
    });
    expect(prisma.deploymentOperation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'operation-1',
        status: 'running',
        finishedAt: null,
        phase: { in: ['queued', 'assigned'] },
      },
      data: { phase: 'running' },
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { activeOperationId: 'operation-1' },
      data: { statusReason: 'Loading verified image' },
    });
  });

  it('publishes a successful Agent deploy from its durable structured result', async () => {
    const { service, prisma, audit } = setup();
    const terminal = job({
      kind: 'deploy',
      status: 'succeeded',
      resultCode: 'ok',
      result: { state: 'running', revision: 'a'.repeat(40), hostPort: 32780 },
      message: 'Deployment healthy',
      deploymentOperationId: 'operation-1',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: {
          target: { publicUrl: 'http://192.0.2.10' },
        },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Deployment healthy',
      resultCode: 'ok',
      result: { state: 'running', revision: 'a'.repeat(40), hostPort: 32780 },
    });

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'running',
        version: 'a'.repeat(40),
        buildArtifactId: 'artifact-1',
        url: 'http://192.0.2.10:32780',
        activeOperationId: null,
      }),
    });
    expect(prisma.deploymentOperation.updateMany).toHaveBeenCalledWith({
      where: { id: 'operation-1', status: 'running', finishedAt: null },
      data: expect.objectContaining({ status: 'succeeded', message: 'Deployment healthy' }),
    });
    expect(audit.recordOperationResult).toHaveBeenCalledWith('deployment', 'operation-1');
  });

  it('fails the project operation when Agent completion has no valid deploy result', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'deploy',
      status: 'succeeded',
      result: null,
      message: 'Done without workload identity',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: { target: { publicUrl: 'https://apps.example.test' } },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Done without workload identity',
      resultCode: 'ok',
    });

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'failed',
        statusReason: 'Agent returned an invalid deployment result',
        activeOperationId: null,
      }),
    });
  });

  it('clears deployment identity only after a successful Agent remove result', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'remove',
      status: 'succeeded',
      result: { state: 'missing' },
      message: 'Managed workload remove completed',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: { target: { publicUrl: 'https://apps.example.test' } },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Managed workload remove completed',
      resultCode: 'ok',
      result: { state: 'missing' },
    });

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'empty',
        version: null,
        buildArtifactId: null,
        url: null,
        deploymentRequired: false,
        activeOperationId: null,
      }),
    });
  });

  it('queues the stable route only after a managed deploy workload succeeds', async () => {
    const { service, prisma, gatewayRoutes } = setup();
    const terminal = job({
      kind: 'deploy',
      operationStep: 1,
      payload: { projectSlug: 'acme-api', containerPort: 8080, healthPath: '/health' },
      status: 'succeeded',
      result: {
        state: 'running',
        revision: 'a'.repeat(40),
        hostPort: 32780,
        workloadSlot: 'a1b2c3d4e5f6',
      },
      message: 'Workload healthy',
      deploymentOperationId: 'operation-1',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        kind: 'redeploy',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: {
          target: { publicUrl: 'https://apps.example.test', routingMode: 'managed-gateway' },
          gatewayRoute: null,
        },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Workload healthy',
      resultCode: 'ok',
      result: {
        state: 'running',
        revision: 'a'.repeat(40),
        hostPort: 32780,
        workloadSlot: 'a1b2c3d4e5f6',
      },
    });

    expect(gatewayRoutes.queueReconcile).toHaveBeenCalledWith('environment-1', {
      requestId: 'operation-1',
      desiredState: 'active',
      revision: 'a'.repeat(40),
      projectSlug: 'acme-api',
      containerPort: 8080,
      healthPath: '/health',
      workloadSlot: 'a1b2c3d4e5f6',
      activation: 'deploy',
      deploymentOperationId: 'operation-1',
      operationStep: 2,
    });
    expect(prisma.environment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeOperationId: null }),
      }),
    );
  });

  it('publishes the reserved HTTPS URL after managed route step 2 succeeds', async () => {
    const { service, prisma } = setup();
    const stableUrl = 'https://acme-api-dev-a1b2c3d4e5f6.apps.example.test';
    const terminal = job({
      kind: 'gateway-route',
      operationStep: 2,
      payload: {
        generation: 3,
        desiredState: 'active',
        revision: 'a'.repeat(40),
      },
      status: 'succeeded',
      result: null,
      message: 'Route published',
      gatewayRouteId: 'route-1',
      deploymentOperationId: 'operation-1',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        kind: 'redeploy',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: {
          target: { publicUrl: 'https://apps.example.test', routingMode: 'managed-gateway' },
          gatewayRoute: {
            publicUrl: stableUrl,
            observedState: 'active',
            observedRevision: 'a'.repeat(40),
            observedGeneration: 3,
          },
        },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Route published',
      resultCode: 'ok',
    });

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'running',
        url: stableUrl,
        activeOperationId: null,
      }),
    });
  });

  it('keeps the previous revision running when the managed public HTTPS gate fails', async () => {
    const { service, prisma } = setup();
    const stableUrl = 'https://acme-api-dev-a1b2c3d4e5f6.apps.example.test';
    const previousRevision = 'b'.repeat(40);
    const requestedRevision = 'a'.repeat(40);
    const terminal = job({
      kind: 'gateway-route',
      operationStep: 2,
      payload: {
        generation: 4,
        desiredState: 'active',
        revision: requestedRevision,
      },
      status: 'failed',
      result: null,
      message: 'Public HTTPS health check failed; previous serving route restored',
      gatewayRouteId: 'route-1',
      deploymentOperationId: 'operation-1',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-new',
        kind: 'redeploy',
        status: 'running',
        finishedAt: null,
        version: requestedRevision,
        environment: {
          version: previousRevision,
          url: stableUrl,
          target: { publicUrl: 'https://apps.example.test', routingMode: 'managed-gateway' },
          gatewayRoute: {
            publicUrl: stableUrl,
            observedState: 'active',
            observedRevision: previousRevision,
            observedGeneration: 3,
          },
        },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'failed',
      message: terminal.message,
      resultCode: 'gateway_route_failed',
    });

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'running',
        url: stableUrl,
        deploymentRequired: true,
        activeOperationId: null,
        statusReason: expect.stringContaining('remains online'),
      }),
    });
    expect(prisma.environment.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: requestedRevision }),
      }),
    );

    prisma.environment.updateMany.mockClear();
    terminal.message =
      'Public HTTPS health check failed; rollback incomplete: route restore failed';
    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'failed',
      message: terminal.message,
      resultCode: 'gateway_route_failed',
    });
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: {
        status: 'failed',
        statusReason: terminal.message,
        deploymentRequired: true,
        activeOperationId: null,
      },
    });
  });

  it('unblocks managed stop workload only after route step 1 succeeds', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'gateway-route',
      operationStep: 1,
      payload: { generation: 2, desiredState: 'stopped', revision: 'a'.repeat(40) },
      status: 'succeeded',
      result: null,
      message: 'Route stopped',
      gatewayRouteId: 'route-1',
      deploymentOperationId: 'operation-1',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        kind: 'stop',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: {
          target: { publicUrl: 'https://apps.example.test', routingMode: 'managed-gateway' },
          gatewayRoute: {
            publicUrl: 'https://acme-api-dev.apps.example.test',
            observedState: 'stopped',
            observedRevision: 'a'.repeat(40),
            observedGeneration: 2,
          },
        },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Route stopped',
      resultCode: 'ok',
    });

    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith({
      where: {
        deploymentOperationId: 'operation-1',
        operationStep: 2,
        status: 'blocked',
      },
      data: {
        status: 'queued',
        progressStage: 'queued',
        message: 'Gateway route updated; waiting for Agent workload cleanup',
      },
    });
  });

  it('finishes managed remove only after workload step 2 reports missing', async () => {
    const { service, prisma } = setup();
    const terminal = job({
      kind: 'remove',
      operationStep: 2,
      status: 'succeeded',
      result: { state: 'missing' },
      message: 'Workload removed',
      deploymentOperationId: 'operation-1',
      deploymentOperation: {
        id: 'operation-1',
        environmentId: 'environment-1',
        buildArtifactId: 'artifact-1',
        kind: 'remove',
        status: 'running',
        finishedAt: null,
        version: 'a'.repeat(40),
        environment: {
          target: { publicUrl: 'https://apps.example.test', routingMode: 'managed-gateway' },
          gatewayRoute: {
            publicUrl: 'https://acme-api-dev.apps.example.test',
            observedState: 'absent',
            observedRevision: null,
            observedGeneration: 2,
          },
        },
      },
    });
    prisma.agentJob.findUnique.mockResolvedValue(terminal);
    prisma.agentJob.findUniqueOrThrow.mockResolvedValue(terminal);

    await service.complete('Bearer credential', 'job-1', {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Workload removed',
      resultCode: 'ok',
      result: { state: 'missing' },
    });

    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({
        status: 'empty',
        version: null,
        url: null,
        activeOperationId: null,
      }),
    });
  });
});
