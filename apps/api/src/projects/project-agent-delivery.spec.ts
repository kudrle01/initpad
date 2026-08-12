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
    },
    $transaction: jest.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  return {
    prisma,
    service: new ProjectAgentDelivery(prisma as never, { durable } as never),
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
