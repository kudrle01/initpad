import { BadRequestException } from '@nestjs/common';
import { ProjectWorkloadDiagnostics } from './project-workload-diagnostics';

const NOW = new Date('2026-08-31T14:30:00.000Z');
const VERSION = 'a'.repeat(40);

function environment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'environment-1',
    name: 'dev',
    provider: 'docker',
    status: 'running',
    version: VERSION,
    activeOperationId: null,
    project: {
      id: 'project-1',
      workspaceId: 'workspace-1',
      templateId: 'node',
      scmProvider: 'gitea',
      scmRepositoryId: '42',
      scmOwner: 'alice',
      scmRepositoryName: 'api',
      scmFullName: 'alice/api',
      scmDefaultBranch: 'main',
      scmInstallationId: null,
      repoUrl: 'https://git.example/alice/api',
    },
    target: {
      id: 'target-1',
      name: 'Team Agent',
      kind: 'docker',
      scope: 'user',
      workspaceId: 'workspace-1',
      routingMode: 'managed-gateway',
      agent: {
        credentialHash: 'hash',
        disabledAt: null,
        version: '0.9.0',
        lastSeenAt: NOW,
      },
    },
    allocation: {
      id: 'allocation-1',
      targetId: 'target-1',
      workspaceId: 'workspace-1',
      namespace: 'team-alpha',
    },
    diagnostic: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    environment: {
      findUniqueOrThrow: jest.fn(),
    },
    workloadDiagnostic: {
      findUnique: jest.fn(),
      upsert: jest.fn(async () => ({ id: 'diagnostic-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({ id: 'diagnostic-1' })),
    },
    agentJob: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'job-1' })),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma));
  const templates = {
    get: jest.fn(() => ({ id: 'node', port: 3000, healthPath: '/health' })),
  };
  return {
    diagnostics: new ProjectWorkloadDiagnostics(prisma as never, templates as never),
    prisma,
  };
}

describe('ProjectWorkloadDiagnostics', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('queues one allocation-scoped logs job without executable or secret input', async () => {
    const { diagnostics, prisma } = setup();
    prisma.environment.findUniqueOrThrow
      .mockResolvedValueOnce(environment())
      .mockResolvedValueOnce(environment({
        diagnostic: {
          status: 'queued',
          runtimeState: null,
          revision: null,
          exitCode: null,
          health: null,
          logs: '',
          message: 'Waiting for Agent',
          requestedAt: NOW,
          observedAt: null,
          finishedAt: null,
          currentJob: { progressPercent: 0 },
        },
      }));

    await expect(diagnostics.request(
      'project-1',
      'dev',
      'user-1',
      '123e4567-e89b-42d3-a456-426614174000',
    )).resolves.toMatchObject({
      environment: 'dev',
      status: 'queued',
      agentOnline: true,
    });

    const createCall = (prisma.agentJob.create.mock.calls as unknown as Array<[
      { data: { kind: string; payload: Record<string, unknown> } },
    ]>)[0][0];
    const create = createCall.data as {
      kind: string;
      payload: Record<string, unknown>;
    };
    expect(create.kind).toBe('logs');
    expect(create.payload).toEqual({
      allocationId: 'allocation-1',
      namespace: 'team-alpha',
      projectSlug: 'alice-api',
      environment: 'dev',
      revision: VERSION,
      containerPort: 3000,
      healthPath: '/health',
      routingMode: 'managed-gateway',
    });
    expect(create.payload).not.toHaveProperty('command');
    expect(create.payload).not.toHaveProperty('imageRef');
    expect(create.payload).not.toHaveProperty('config');
  });

  it('keeps the previous bounded snapshot visible when a refresh fails', async () => {
    const { diagnostics, prisma } = setup();
    prisma.environment.findUniqueOrThrow.mockResolvedValue(environment({
      diagnostic: {
        status: 'failed',
        runtimeState: 'running',
        revision: VERSION,
        exitCode: null,
        health: 'healthy',
        logs: 'previous bounded tail',
        message: 'Agent went offline',
        requestedAt: NOW,
        observedAt: new Date(NOW.getTime() - 60_000),
        finishedAt: NOW,
        currentJob: { progressPercent: 20 },
      },
    }));

    await expect(diagnostics.get('project-1', 'dev')).resolves.toMatchObject({
      status: 'failed',
      runtimeState: 'running',
      health: 'healthy',
      logs: 'previous bounded tail',
      observedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
  });

  it('rejects an outdated Agent and concurrent diagnostic refreshes', async () => {
    const first = setup();
    first.prisma.environment.findUniqueOrThrow.mockResolvedValue(environment({
      target: {
        ...environment().target,
        agent: { ...environment().target.agent, version: '0.8.1' },
      },
    }));
    await expect(first.diagnostics.request(
      'project-1', 'dev', 'user-1', '123e4567-e89b-42d3-a456-426614174000',
    )).rejects.toThrow(/0\.9\.0 or newer/);

    const second = setup();
    second.prisma.environment.findUniqueOrThrow.mockResolvedValue(environment());
    second.prisma.workloadDiagnostic.updateMany.mockResolvedValue({ count: 0 });
    await expect(second.diagnostics.request(
      'project-1', 'dev', 'user-1', '123e4567-e89b-42d3-a456-426614174001',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(second.prisma.agentJob.create).not.toHaveBeenCalled();
  });
});
