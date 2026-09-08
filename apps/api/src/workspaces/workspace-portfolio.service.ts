import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from './workspaces.service';

type PortfolioHealth = 'attention' | 'deploying' | 'healthy' | 'idle';

@Injectable()
export class WorkspacePortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async get(userId: string, workspaceId: string) {
    const role = await this.workspaces.roleFor(userId, workspaceId);
    if (!role) throw new NotFoundException('Workspace not found');

    const [projects, activeAllocations, pendingApprovals, cleanupEnvironments, cleanupSetups] =
      await this.prisma.$transaction([
        this.prisma.project.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            templateId: true,
            createdAt: true,
            environments: {
              orderBy: { order: 'asc' },
              select: {
                name: true,
                status: true,
                version: true,
                statusReason: true,
                activeOperationId: true,
                expiresAt: true,
                target: { select: { managementState: true } },
                operations: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { kind: true, status: true, phase: true, createdAt: true },
                },
              },
            },
            buildArtifacts: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { status: true, providerRunId: true, commitSha: true, createdAt: true },
            },
            productionRequests: {
              where: { status: { in: ['pending', 'approving'] } },
              select: { id: true },
            },
          },
        }),
        this.prisma.targetAllocation.count({ where: { workspaceId, status: 'active' } }),
        this.prisma.productionDeploymentRequest.count({
          where: { workspaceId, status: { in: ['pending', 'approving'] } },
        }),
        this.prisma.environment.count({
          where: {
            project: { workspaceId },
            statusReason: { startsWith: 'Cleanup pending:' },
          },
        }),
        this.prisma.provisioningOperation.count({
          where: {
            workspaceId,
            effects: { some: { status: { in: ['compensation_failed', 'reconciliation_required'] } } },
          },
        }),
      ]);

    const items = projects.map((project) => {
      const cleanupDebt = project.environments.filter(
        (environment) => environment.statusReason?.startsWith('Cleanup pending:'),
      ).length;
      const failed = project.environments.filter((environment) =>
        environment.status === 'failed'
        || (environment.target?.managementState ?? 'active') !== 'active',
      ).length;
      const deploying = project.environments.some(
        (environment) => environment.status === 'deploying' || environment.activeOperationId,
      );
      const running = project.environments.filter((environment) => environment.status === 'running').length;
      const health: PortfolioHealth = failed > 0 || cleanupDebt > 0
        ? 'attention'
        : deploying
          ? 'deploying'
          : running > 0
            ? 'healthy'
            : 'idle';
      const lastBuild = project.buildArtifacts[0];
      const lastDeployment = project.environments
        .flatMap((environment) => environment.operations.map((operation) => ({
          ...operation,
          environment: environment.name,
        })))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
      return {
        id: project.id,
        name: project.name,
        templateId: project.templateId,
        createdAt: project.createdAt.toISOString(),
        health,
        runningEnvironments: running,
        failedEnvironments: failed,
        cleanupDebt,
        pendingApprovals: project.productionRequests.length,
        environments: project.environments.map((environment) => ({
          name: environment.name,
          status: environment.status,
          version: environment.version,
          expiresAt: environment.expiresAt?.toISOString() ?? null,
        })),
        lastBuild: lastBuild
          ? {
              status: lastBuild.status,
              runId: lastBuild.providerRunId,
              commitSha: lastBuild.commitSha,
              createdAt: lastBuild.createdAt.toISOString(),
            }
          : null,
        lastDeployment: lastDeployment
          ? {
              environment: lastDeployment.environment,
              kind: lastDeployment.kind,
              status: lastDeployment.status,
              phase: lastDeployment.phase,
              createdAt: lastDeployment.createdAt.toISOString(),
            }
          : null,
      };
    });

    return {
      stats: {
        projects: items.length,
        environments: items.reduce((sum, project) => sum + project.environments.length, 0),
        runningEnvironments: items.reduce((sum, project) => sum + project.runningEnvironments, 0),
        attentionProjects: items.filter((project) => project.health === 'attention').length,
        activeAllocations,
        pendingApprovals,
        cleanupDebt: cleanupEnvironments + cleanupSetups,
      },
      projects: items,
    };
  }
}
