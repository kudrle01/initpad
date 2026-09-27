import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

function environment(name: 'dev' | 'test' | 'prod', overrides: Record<string, unknown> = {}) {
  return {
    id: `env-${name}`,
    projectId: 'project-1',
    name,
    order: name === 'dev' ? 0 : name === 'test' ? 1 : 2,
    provider: 'docker',
    status: 'empty',
    version: null,
    url: null,
    buildArtifactId: null,
    statusReason: null,
    activeOperationId: null,
    ...overrides,
  };
}

function harness(
  overrides: {
    roleError?: Error;
    operation?: { id: string } | null;
    pendingRequest?: { id: string } | null;
    environments?: ReturnType<typeof environment>[];
    preset?: 'dev-test-prod' | 'dev-prod' | 'prod-only';
  } = {},
) {
  const rows = overrides.environments ?? [
    environment('dev'),
    environment('test'),
    environment('prod'),
  ];
  const project = {
    id: 'project-1',
    name: 'api',
    workspaceId: 'workspace-1',
    templateId: 'node-api',
    pipelinePreset: overrides.preset ?? 'dev-test-prod',
    environments: rows,
  };
  const prisma: Record<string, any> = {
    project: {
      findUnique: jest.fn(async () => project),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    environment: {
      deleteMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => undefined),
      create: jest.fn(async () => undefined),
    },
    deploymentOperation: {
      findFirst: jest.fn(async () => overrides.operation ?? null),
    },
    productionDeploymentRequest: {
      findFirst: jest.fn(async () => overrides.pendingRequest ?? null),
    },
  };
  prisma.$transaction = jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback(prisma),
  );
  const workspaces = {
    requireProject: jest.fn(async () => {
      if (overrides.roleError) throw overrides.roleError;
      return { workspaceId: 'workspace-1', role: 'maintainer' };
    }),
  };
  const audit = { record: jest.fn(async () => undefined), recordOperationResult: jest.fn() };
  const service = new ProjectsService(
    prisma as never,
    { get: jest.fn(() => ({ id: 'node-api', runtime: 'node' })) } as never,
    {} as never,
    {} as never,
    { listEntities: jest.fn(async () => []) } as never,
    {} as never,
    workspaces as never,
    {} as never,
    {} as never,
    audit,
  );
  jest.spyOn(service, 'get').mockResolvedValue({ id: 'project-1' } as never);
  return { service, prisma, audit, project };
}

describe('ProjectsService pipeline preset changes', () => {
  it('requires maintain permission', async () => {
    const h = harness({ roleError: new ForbiddenException() });

    await expect(
      h.service.updatePipelinePreset('project-1', 'dev-prod', 'member'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a running operation or pending production request', async () => {
    const running = harness({ operation: { id: 'operation-1' } });
    await expect(
      running.service.updatePipelinePreset('project-1', 'dev-prod', 'maintainer'),
    ).rejects.toBeInstanceOf(ConflictException);

    const pending = harness({ pendingRequest: { id: 'request-1' } });
    await expect(
      pending.service.updatePipelinePreset('project-1', 'dev-prod', 'maintainer'),
    ).rejects.toThrow(/pending production request/i);
  });

  it('rechecks operation state inside the serializable mutation transaction', async () => {
    const h = harness();
    h.prisma.deploymentOperation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'operation-started-concurrently' });

    await expect(
      h.service.updatePipelinePreset('project-1', 'dev-prod', 'maintainer'),
    ).rejects.toThrow(/operation is running/i);
    expect(h.prisma.environment.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects removal until the stage workload and cleanup debt are empty', async () => {
    const h = harness({
      environments: [
        environment('dev'),
        environment('test', { status: 'running', version: 'a'.repeat(40) }),
        environment('prod'),
      ],
    });

    await expect(
      h.service.updatePipelinePreset('project-1', 'dev-prod', 'maintainer'),
    ).rejects.toThrow("Environment 'test' is not empty");
    expect(h.prisma.environment.deleteMany).not.toHaveBeenCalled();
  });

  it('removes an empty stage, reorders the remainder and records the change', async () => {
    const h = harness();

    await h.service.updatePipelinePreset('project-1', 'dev-prod', 'maintainer');

    expect(h.prisma.environment.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', name: { in: ['test'] } },
    });
    expect(h.prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'project-1', pipelinePreset: 'dev-test-prod' },
      data: { pipelinePreset: 'dev-prod' },
    });
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project.pipeline_preset_changed',
        details: { previousPreset: 'dev-test-prod', pipelinePreset: 'dev-prod' },
      }),
    );
  });

  it('adds a stage as an empty environment on its resolved target', async () => {
    const h = harness({
      preset: 'dev-prod',
      environments: [environment('dev'), environment('prod', { order: 1 })],
    });
    const targets = (h.service as any).environmentTargets;
    jest.spyOn(targets, 'resolveTarget').mockReturnValue({ id: 'target-test', kind: 'docker' });
    jest.spyOn(targets, 'prepareAllocations').mockResolvedValue([
      {
        name: 'test',
        target: { id: 'target-test', kind: 'docker' },
        allocationId: 'allocation-test',
      },
    ]);

    await h.service.updatePipelinePreset('project-1', 'dev-test-prod', 'maintainer');

    expect(h.prisma.environment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'project-1',
        name: 'test',
        order: 1,
        status: 'empty',
        targetId: 'target-test',
        allocationId: 'allocation-test',
      }),
    });
  });
});
