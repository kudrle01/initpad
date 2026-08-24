import { BadRequestException } from '@nestjs/common';
import { ProjectAgentDelivery } from './project-agent-delivery';

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'operation-1',
    status: 'running',
    finishedAt: null,
    version: 'a'.repeat(40),
    buildArtifact: {
      id: 'artifact-1',
      projectId: 'project-1',
      status: 'available',
      storageKind: 'object-store',
      storageRef: 'artifacts/workspace-1/project-1/artifact-1/a.tar',
    },
    environment: {
      id: 'environment-1',
      name: 'dev',
      projectId: 'project-1',
      targetId: 'target-1',
      allocationId: 'allocation-1',
      project: { workspaceId: 'workspace-1' },
      target: {
        id: 'target-1',
        kind: 'docker',
        scope: 'user',
        workspaceId: 'workspace-1',
        routingMode: 'direct-port',
        agent: {
          credentialHash: 'hash',
          disabledAt: null,
          version: '0.4.0',
        },
      },
      allocation: {
        id: 'allocation-1',
        targetId: 'target-1',
        workspaceId: 'workspace-1',
        namespace: 'team-alpha',
      },
      configVars: [
        { key: 'APP_ENV', value: 'production', isSecret: false },
        { key: 'DATABASE_PASSWORD', value: 'enc:v1:opaque', isSecret: true },
      ],
    },
    ...overrides,
  };
}

function setup(row = operation(), durable = true) {
  const prisma = {
    deploymentOperation: {
      findUnique: jest.fn(async () => row),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    environment: { updateMany: jest.fn(async () => ({ count: 1 })) },
    agentJob: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
        ...create,
        id: 'job-1',
      })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  const gatewayRoutes = { queueReconcile: jest.fn(async () => ({ status: 'queued' })) };
  return {
    prisma,
    gatewayRoutes,
    service: new ProjectAgentDelivery(
      prisma as never,
      { durable } as never,
      gatewayRoutes as never,
    ),
  };
}

describe('ProjectAgentDelivery', () => {
  const intent = {
    projectSlug: 'alice-api',
    imageRef: `registry.test/alice/api:${'a'.repeat(40)}`,
    containerPort: 3000,
    healthPath: '/health',
  };

  it('creates an idempotent non-secret job bound to operation, target and allocation', async () => {
    const { service, prisma } = setup();

    await service.queueDeployment('operation-1', intent);

    expect(prisma.agentJob.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: 'deployment:operation-1' },
      update: {},
      create: expect.objectContaining({
        targetId: 'target-1',
        allocationId: 'allocation-1',
        deploymentOperationId: 'operation-1',
        operationStep: 1,
        kind: 'deploy',
        payload: {
          allocationId: 'allocation-1',
          namespace: 'team-alpha',
          projectSlug: 'alice-api',
          environment: 'dev',
          revision: 'a'.repeat(40),
          imageRef: `registry.test/alice/api:${'a'.repeat(40)}`,
          containerPort: 3000,
          healthPath: '/health',
          routingMode: 'direct-port',
          configFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }),
    });
    const serialized = JSON.stringify(prisma.agentJob.upsert.mock.calls[0]);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('password');
    expect(prisma.environment.updateMany).toHaveBeenCalledWith({
      where: { id: 'environment-1', activeOperationId: 'operation-1' },
      data: expect.objectContaining({ statusReason: 'Waiting for Agent' }),
    });
  });

  it('requires durable storage and Agent 0.4 before creating a job', async () => {
    const noStore = setup(operation(), false);
    await expect(noStore.service.queueDeployment('operation-1', intent))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(noStore.prisma.agentJob.upsert).not.toHaveBeenCalled();

    const oldAgent = setup(operation({
      environment: {
        ...operation().environment,
        target: {
          ...operation().environment.target,
          agent: { credentialHash: 'hash', disabledAt: null, version: '0.3.0' },
        },
      },
    }));
    await expect(oldAgent.service.queueDeployment('operation-1', intent))
      .rejects.toThrow(/0\.4\.0 or newer/);
    expect(oldAgent.prisma.agentJob.upsert).not.toHaveBeenCalled();
  });

  it('queues stop/start/remove without attaching artifact bytes or secrets', async () => {
    for (const kind of ['start', 'stop', 'remove'] as const) {
      const { service, prisma } = setup();
      await service.queueLifecycle('operation-1', kind, intent);
      const create = prisma.agentJob.upsert.mock.calls[0][0].create as Record<string, unknown>;
      expect(create.kind).toBe(kind);
      expect(create.deploymentOperationId).toBe('operation-1');
      expect(create.operationStep).toBe(1);
      expect(create.payload).toEqual(expect.objectContaining({
        imageRef: intent.imageRef,
        routingMode: 'direct-port',
        configFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }));
      expect(JSON.stringify(create)).not.toContain('DATABASE_PASSWORD');
      expect(JSON.stringify(create)).not.toContain('enc:v1:opaque');
      expect(prisma.environment.updateMany).toHaveBeenCalledWith({
        where: { id: 'environment-1', activeOperationId: 'operation-1' },
        data: expect.objectContaining({
          status: 'deploying',
          ...(kind === 'remove' ? { deploymentRequired: false } : {}),
        }),
      });
    }
  });

  it('orders managed stop as route step 1 followed by a blocked workload step', async () => {
    const row = operation({
      environment: {
        ...operation().environment,
        target: {
          ...operation().environment.target,
          routingMode: 'managed-gateway',
          gatewayAdapter: 'caddy',
          gatewayPreflightStatus: 'passed',
          publicUrl: 'https://apps.example.test',
          agent: { credentialHash: 'hash', disabledAt: null, version: '0.8.0' },
        },
      },
    });
    const prisma = {
      deploymentOperation: {
        findUnique: jest.fn(async () => row),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      environment: { updateMany: jest.fn(async () => ({ count: 1 })) },
      agentJob: {
        upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => ({
          ...create,
          id: 'job-workload',
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const gatewayRoutes = { queueReconcile: jest.fn(async () => ({ status: 'queued' })) };
    const service = new ProjectAgentDelivery(
      prisma as never,
      { durable: true } as never,
      gatewayRoutes as never,
    );

    await service.queueLifecycle('operation-1', 'stop', intent);

    expect(prisma.agentJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        operationStep: 2,
        status: 'blocked',
        progressStage: 'blocked',
      }),
    }));
    expect(gatewayRoutes.queueReconcile).toHaveBeenCalledWith('environment-1', {
      requestId: 'operation-1',
      desiredState: 'stopped',
      revision: 'a'.repeat(40),
      projectSlug: intent.projectSlug,
      containerPort: intent.containerPort,
      healthPath: intent.healthPath,
      workloadSlot: null,
      activation: null,
      deploymentOperationId: 'operation-1',
      operationStep: 1,
    });
  });

  it('rejects a cross-workspace allocation before queuing side effects', async () => {
    const row = operation({
      environment: {
        ...operation().environment,
        allocation: { ...operation().environment.allocation, workspaceId: 'workspace-2' },
      },
    });
    const { service, prisma } = setup(row);

    await expect(service.queueDeployment('operation-1', intent))
      .rejects.toThrow(/workspace Agent allocation/);
    expect(prisma.agentJob.upsert).not.toHaveBeenCalled();
  });
});
