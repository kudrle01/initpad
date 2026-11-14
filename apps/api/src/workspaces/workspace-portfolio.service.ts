import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from './workspaces.service';

type PortfolioHealth = 'attention' | 'deploying' | 'healthy' | 'idle';

interface LastDeploymentRow {
  projectId: string;
  environment: string;
  kind: string;
  status: string;
  phase: string;
  createdAt: Date;
}

interface LastBuildRow {
  projectId: string;
  status: string;
  providerRunId: string;
  commitSha: string;
  createdAt: Date;
}

@Injectable()
export class WorkspacePortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async get(userId: string, workspaceId: string) {
    const role = await this.workspaces.roleFor(userId, workspaceId);
    if (!role) throw new NotFoundException('Workspace not found');

    // The latest operation and build per project come from DISTINCT ON
    // queries: a nested `take: 1` makes Prisma load every operation and build
    // of the workspace and trim them in memory.
    const [
      projects,
      activeAllocations,
      pendingApprovals,
      cleanupEnvironments,
      cleanupSetups,
      lastDeployments,
      lastBuilds,
    ] = await this.prisma.$transaction([
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
            },
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
          dismissedAt: null,
          effects: {
            some: { status: { in: ['compensation_failed', 'reconciliation_required'] } },
          },
        },
      }),
      this.prisma.$queryRaw<LastDeploymentRow[]>(Prisma.sql`
          SELECT DISTINCT ON (e."projectId")
            e."projectId", e."name" AS "environment",
            o."kind", o."status", o."phase", o."createdAt"
          FROM "DeploymentOperation" o
          JOIN "Environment" e ON e."id" = o."environmentId"
          JOIN "Project" p ON p."id" = e."projectId"
          WHERE p."workspaceId" = ${workspaceId}
          ORDER BY e."projectId", o."createdAt" DESC
        `),
      this.prisma.$queryRaw<LastBuildRow[]>(Prisma.sql`
          SELECT DISTINCT ON (a."projectId")
            a."projectId", a."status", a."providerRunId", a."commitSha", a."createdAt"
          FROM "BuildArtifact" a
          JOIN "Project" p ON p."id" = a."projectId"
          WHERE p."workspaceId" = ${workspaceId}
          ORDER BY a."projectId", a."createdAt" DESC
        `),
    ]);
    const lastDeploymentByProject = new Map(lastDeployments.map((row) => [row.projectId, row]));
    const lastBuildByProject = new Map(lastBuilds.map((row) => [row.projectId, row]));

    const items = projects.map((project) => {
      const cleanupDebt = project.environments.filter((environment) =>
        environment.statusReason?.startsWith('Cleanup pending:'),
      ).length;
      const failed = project.environments.filter(
        (environment) =>
          environment.status === 'failed' ||
          (environment.target?.managementState ?? 'active') !== 'active',
      ).length;
      const deploying = project.environments.some(
        (environment) => environment.status === 'deploying' || environment.activeOperationId,
      );
      const running = project.environments.filter(
        (environment) => environment.status === 'running',
      ).length;
      const health: PortfolioHealth =
        failed > 0 || cleanupDebt > 0
          ? 'attention'
          : deploying
            ? 'deploying'
            : running > 0
              ? 'healthy'
              : 'idle';
      const lastBuild = lastBuildByProject.get(project.id);
      const lastDeployment = lastDeploymentByProject.get(project.id);
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
