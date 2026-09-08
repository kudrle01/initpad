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
        name: 'dev', status: 'running', version: 'a'.repeat(40), statusReason: null,
        activeOperationId: null, expiresAt: null, target: { managementState: 'active' },
        operations: [{ kind: 'deploy', status: 'succeeded', phase: 'succeeded', createdAt: new Date('2026-09-03T00:00:00Z') }],
      },
      {
        name: 'test', status: 'failed', version: null, statusReason: 'Health check failed',
        activeOperationId: null, expiresAt: null, target: { managementState: 'active' },
        operations: [],
      },
      {
        name: 'prod', status: 'empty', version: null, statusReason: null,
        activeOperationId: null, expiresAt: null, target: { managementState: 'active' },
        operations: [],
      },
    ],
    buildArtifacts: [{
      status: 'available', providerRunId: '42', commitSha: 'a'.repeat(40),
      createdAt: new Date('2026-09-02T00:00:00Z'),
    }],
    productionRequests: [{ id: 'request-1' }],
  };

  it('returns one DB-only workspace projection without SCM or Docker reads', async () => {
    const transaction = jest.fn(async () => [[project], 2, 1, 0, 1]);
    const prisma = {
      $transaction: transaction,
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
      id: 'project-1', health: 'attention', failedEnvironments: 1, pendingApprovals: 1,
      lastDeployment: { environment: 'dev', kind: 'deploy', status: 'succeeded' },
    });
  });

  it('hides another workspace as 404', async () => {
    const service = new WorkspacePortfolioService({} as never, {
      roleFor: jest.fn(async () => null),
    } as never);
    await expect(service.get('stranger', 'workspace-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
