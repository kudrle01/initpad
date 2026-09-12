import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service';
import { AuditEventsService } from '../audit/audit-events.service';
import { AppConfigService } from '../projects/app-config.service';
import { ProjectsController } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { TargetAllocationsService } from '../targets/target-allocations.service';
import { TargetsService, type TargetRow } from '../targets/targets.service';
import { WorkspaceMetricsService } from './workspace-metrics.service';
import { WorkspacePortfolioService } from './workspace-portfolio.service';
import { WorkspacesService } from './workspaces.service';

const WORKSPACE_A = 'workspace-a';
const WORKSPACE_B = 'workspace-b';
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

const memberships = new Map([
  [`${WORKSPACE_A}:alice`, 'owner'],
  [`${WORKSPACE_A}:bob`, 'viewer'],
  [`${WORKSPACE_B}:bob`, 'owner'],
]);

function workspaceBoundary() {
  const prisma = {
    workspaceMember: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { workspaceId_userId: { workspaceId: string; userId: string } };
        }) => {
          const key = `${where.workspaceId_userId.workspaceId}:${where.workspaceId_userId.userId}`;
          const role = memberships.get(key);
          return role ? { role } : null;
        },
      ),
    },
    project: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === PROJECT_A) return { workspaceId: WORKSPACE_A };
        if (where.id === PROJECT_B) return { workspaceId: WORKSPACE_B };
        return null;
      }),
    },
  };
  return new WorkspacesService(prisma as never, {} as never);
}

const target = (id: string, workspaceId: string): TargetRow => ({
  id,
  name: id,
  kind: 'docker',
  scope: 'user',
  capabilities: 'static,node',
  host: null,
  port: null,
  username: null,
  auth: null,
  secret: null,
  remotePath: null,
  publicUrl: 'https://apps.example.test',
  routingMode: 'direct-port',
  gatewayAdapter: null,
  managementState: 'active',
  managementStateChangedAt: new Date(),
  gatewayPreflightStatus: 'not-run',
  gatewayPreflightJobId: null,
  gatewayPreflightAt: null,
  gatewayPreflightError: null,
  verifiedAt: null,
  ownerId: null,
  workspaceId,
  createdAt: new Date(),
});

const allocation = (id: string, workspaceId: string, targetId: string) => ({
  id,
  targetId,
  workspaceId,
  namespace: workspaceId,
  rootPath: null,
  publicUrl: null,
  capabilities: 'static,node',
  status: 'enabled',
  maxEnvironments: 10,
  cpuLimitMillicores: 1000,
  memoryLimitMb: 512,
  pidsLimit: 256,
  devTtlHours: null,
  testTtlHours: null,
  target: { name: targetId, managementState: 'active' },
  environments: [],
  _count: { environments: 0 },
});

describe('two-workspace tenant boundary matrix', () => {
  it('distinguishes a foreign tenant (404) from an insufficient local role (403)', async () => {
    const workspaces = workspaceBoundary();

    await expect(workspaces.require('alice', WORKSPACE_B, 'read')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(workspaces.requireProject('alice', PROJECT_B, 'read')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(workspaces.requireProject('bob', PROJECT_A, 'read')).resolves.toEqual({
      workspaceId: WORKSPACE_A,
      role: 'viewer',
    });
    await expect(workspaces.requireProject('bob', PROJECT_A, 'write')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not query project history or diagnostics after a foreign project id is rejected', async () => {
    const workspaces = workspaceBoundary();
    const projects = {
      assertAccess: jest.fn((id: string, userId: string, permission: 'read' | 'write') =>
        workspaces.requireProject(userId, id, permission),
      ),
      deploymentHistory: jest.fn(),
      workloadDiagnostic: jest.fn(),
    };
    const controller = new ProjectsController(projects as never);

    await expect(controller.deployments(PROJECT_B, 'alice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.workloadDiagnostic(PROJECT_B, 'dev', 'alice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(projects.deploymentHistory).not.toHaveBeenCalled();
    expect(projects.workloadDiagnostic).not.toHaveBeenCalled();
  });

  it('blocks config reads and writes before touching a foreign project environment', async () => {
    const workspaces = workspaceBoundary();
    const prisma = {
      environment: { findUnique: jest.fn(), updateMany: jest.fn() },
      appConfigVar: { findMany: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn(),
    };
    const config = new AppConfigService(prisma as never, workspaces);

    await expect(config.list('alice', PROJECT_B, 'dev')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      config.upsert('bob', PROJECT_A, 'dev', 'SAFE_KEY', { value: 'value' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.environment.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents foreign and viewer target mutations before any infrastructure change', async () => {
    const workspaces = workspaceBoundary();
    const targetsById = new Map([
      ['target-a', target('target-a', WORKSPACE_A)],
      ['target-b', target('target-b', WORKSPACE_B)],
    ]);
    const prisma = {
      target: {
        findUnique: jest.fn(
          async ({ where }: { where: { id: string } }) => targetsById.get(where.id) ?? null,
        ),
        update: jest.fn(),
        delete: jest.fn(),
      },
      environment: { count: jest.fn() },
    };
    const targets = new TargetsService(prisma as never, {} as never, workspaces);

    await expect(targets.update('target-b', 'alice', { name: 'changed' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(targets.update('target-a', 'bob', { name: 'changed' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.environment.count).not.toHaveBeenCalled();
    expect(prisma.target.update).not.toHaveBeenCalled();
  });

  it('isolates allocation reads and reserves local allocation changes for admins', async () => {
    const workspaces = workspaceBoundary();
    const rows = new Map([
      ['allocation-a', allocation('allocation-a', WORKSPACE_A, 'target-a')],
      ['allocation-b', allocation('allocation-b', WORKSPACE_B, 'target-b')],
    ]);
    const prisma = {
      targetAllocation: {
        findUnique: jest.fn(
          async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
        ),
        update: jest.fn(),
      },
      environment: { count: jest.fn() },
    };
    const allocations = new TargetAllocationsService(prisma as never, workspaces);

    await expect(allocations.get('allocation-b', 'alice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(allocations.get('allocation-a', 'bob')).resolves.toMatchObject({
      id: 'allocation-a',
      workspaceId: WORKSPACE_A,
    });
    await expect(
      allocations.update('allocation-a', 'bob', { status: 'disabled' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.environment.count).not.toHaveBeenCalled();
    expect(prisma.targetAllocation.update).not.toHaveBeenCalled();
  });

  it('hides Agent management for a foreign target before reading Agent state', async () => {
    const workspaces = workspaceBoundary();
    const prisma = {
      target: {
        findUnique: jest.fn(async () => ({
          kind: 'docker',
          scope: 'user',
          workspaceId: WORKSPACE_B,
          name: 'Target B',
          managementState: 'active',
        })),
      },
      agent: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    const agents = new AgentsService(prisma as never, workspaces, {} as never);

    await expect(agents.getForTarget('target-b', 'alice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.agent.findUnique).not.toHaveBeenCalled();
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('rejects foreign audit, portfolio and metrics requests before their data queries', async () => {
    const workspaces = workspaceBoundary();
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: { workspaceId_userId: { workspaceId: string; userId: string } };
          }) => {
            const { workspaceId, userId } = where.workspaceId_userId;
            return memberships.has(`${workspaceId}:${userId}`) ? { workspaceId } : null;
          },
        ),
      },
      auditEvent: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const audit = new AuditEventsService(prisma as never);
    const portfolio = new WorkspacePortfolioService(prisma as never, workspaces);
    const metrics = new WorkspaceMetricsService(prisma as never, workspaces);

    await expect(audit.list('alice', WORKSPACE_B, { limit: 30 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(portfolio.get('alice', WORKSPACE_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(metrics.export('alice', WORKSPACE_B, { format: 'json' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(metrics.export('bob', WORKSPACE_A, { format: 'json' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cannot retry a provisioning operation by guessing an id from another workspace', async () => {
    const workspaces = workspaceBoundary();
    const provisioning = {
      record: jest.fn(async () => ({
        id: 'operation-b',
        workspaceId: WORKSPACE_B,
        kind: 'create',
        status: 'failed',
        request: { name: 'foreign-project' },
        attempt: 1,
      })),
      isRetryable: jest.fn(() => true),
      claimRetry: jest.fn(),
    };
    const projects = new ProjectsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workspaces,
      provisioning as never,
      {} as never,
    );

    await expect(projects.retryProvisioning('operation-b', 'alice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(provisioning.isRetryable).not.toHaveBeenCalled();
    expect(provisioning.claimRetry).not.toHaveBeenCalled();
  });
});
