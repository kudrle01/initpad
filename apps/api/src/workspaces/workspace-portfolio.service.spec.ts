import { NotFoundException } from '@nestjs/common';
import { WorkspacePortfolioService } from './workspace-portfolio.service';

describe('WorkspacePortfolioService', () => {
  const project = {
    id: 'project-1',
    name: 'api',
    templateId: 'nestjs',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    environments: [
      {
        name: 'dev',
        status: 'running',
        version: 'a'.repeat(40),
        statusReason: null,
        activeOperationId: null,
        expiresAt: null,
        target: { managementState: 'active' },
      },
      {
        name: 'test',
        status: 'failed',
        version: null,
        statusReason: 'Health check failed',
        activeOperationId: null,
        expiresAt: null,
        target: { managementState: 'active' },
      },
      {
        name: 'prod',
        status: 'empty',
        version: null,
        statusReason: null,
        activeOperationId: null,
        expiresAt: null,
        target: { managementState: 'active' },
      },
    ],
    productionRequests: [{ id: 'request-1' }],
  };

  it('returns one DB-only workspace projection without SCM or Docker reads', async () => {
    const lastDeployment = {
      projectId: 'project-1',
      environment: 'dev',
      kind: 'deploy',
      status: 'succeeded',
      phase: 'succeeded',
      createdAt: new Date('2026-09-03T00:00:00Z'),
    };
    const lastBuild = {
      projectId: 'project-1',
      status: 'available',
      providerRunId: '42',
      commitSha: 'a'.repeat(40),
      createdAt: new Date('2026-09-02T00:00:00Z'),
    };
    const transaction = jest.fn(async () => [[project], 2, 1, 0, 1, [lastDeployment], [lastBuild]]);
    const queryRaw = jest.fn((query: { sql: string }) => query.sql);
    const prisma = {
      $transaction: transaction,
      $queryRaw: queryRaw,
      project: { findMany: jest.fn(() => 'projects') },
      targetAllocation: { count: jest.fn(() => 'allocations') },
      productionDeploymentRequest: { count: jest.fn(() => 'approvals') },
      environment: { count: jest.fn(() => 'cleanup-envs') },
      provisioningOperation: { count: jest.fn(() => 'cleanup-setups') },
    };
    const workspaces = { roleFor: jest.fn(async () => 'viewer') };
    const service = new WorkspacePortfolioService(prisma as never, workspaces as never);

    const result = await service.get('user-1', 'workspace-1');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.stats).toEqual({
      projects: 1,
      environments: 3,
      runningEnvironments: 1,
      attentionProjects: 1,
      activeAllocations: 2,
      pendingApprovals: 1,
      cleanupDebt: 1,
    });
    expect(result.projects[0]).toMatchObject({
      id: 'project-1',
      health: 'attention',
      failedEnvironments: 1,
      pendingApprovals: 1,
      lastDeployment: { environment: 'dev', kind: 'deploy', status: 'succeeded' },
      lastBuild: { status: 'available', runId: '42' },
    });
  });

  it('reads only the latest operation and build per project (audit P2)', async () => {
    const queryRaw = jest.fn((query: { sql: string }) => query.sql);
    const findMany = jest.fn(() => 'projects');
    const prisma = {
      $transaction: jest.fn(async () => [[], 0, 0, 0, 0, [], []]),
      $queryRaw: queryRaw,
      project: { findMany },
      targetAllocation: { count: jest.fn() },
      productionDeploymentRequest: { count: jest.fn() },
      environment: { count: jest.fn() },
      provisioningOperation: { count: jest.fn() },
    };
    const service = new WorkspacePortfolioService(
      prisma as never,
      {
        roleFor: jest.fn(async () => 'viewer'),
      } as never,
    );

    await service.get('user-1', 'workspace-1');

    const select = (findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0]
      .select;
    expect(select).not.toHaveProperty('buildArtifacts');
    expect(JSON.stringify(select)).not.toContain('operations');
    const statements = queryRaw.mock.results.map((result) => String(result.value));
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/DISTINCT ON \(e\."projectId"\)[\s\S]*"DeploymentOperation"/);
    expect(statements[1]).toMatch(/DISTINCT ON \(a\."projectId"\)[\s\S]*"BuildArtifact"/);
  });

  it('hides another workspace as 404', async () => {
    const service = new WorkspacePortfolioService(
      {} as never,
      {
        roleFor: jest.fn(async () => null),
      } as never,
    );
    await expect(service.get('stranger', 'workspace-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
