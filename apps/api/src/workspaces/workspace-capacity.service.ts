import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type WorkspaceCapacityResource =
  'projects' | 'members' | 'targets' | 'concurrentOperations' | 'artifactBytes';

type CapacityDatabase = Prisma.TransactionClient | PrismaService;

const ACTIVE_PROVISIONING_STATUSES = ['running', 'retrying', 'cleaning'];
const RESERVED_ARTIFACT_STATUSES = ['accepted', 'ingesting', 'available'];
const SERIALIZABLE_RETRIES = 3;

const RESOURCE_LABELS: Record<WorkspaceCapacityResource, string> = {
  projects: 'project',
  members: 'member',
  targets: 'deployment server',
  concurrentOperations: 'concurrent operation',
  artifactBytes: 'artifact storage',
};

export interface WorkspaceCapacitySnapshot {
  workspaceId: string;
  workspaceName: string;
  limits: {
    projects: number;
    members: number;
    targets: number;
    concurrentOperations: number;
    artifactBytes: string;
  };
  usage: {
    projects: number;
    members: number;
    targets: number;
    concurrentOperations: number;
    artifactBytes: string;
  };
  remaining: {
    projects: number;
    members: number;
    targets: number;
    concurrentOperations: number;
    artifactBytes: string;
  };
}

export interface WorkspaceCapacityUpdate {
  maxProjects: number;
  maxMembers: number;
  maxTargets: number;
  maxConcurrentOperations: number;
  maxArtifactStorageGiB: number;
}

function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

/**
 * Runs a read-check-write capacity claim without allowing two API replicas to
 * both observe the last free slot. PostgreSQL may abort one serializable
 * transaction; bounded retry turns that race into a deterministic quota check.
 */
export async function serializableCapacityTransaction<T>(
  prisma: PrismaService,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === SERIALIZABLE_RETRIES) throw error;
    }
  }
  throw new Error('Capacity transaction retry exhausted');
}

@Injectable()
export class WorkspaceCapacityService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(workspaceId: string, database: CapacityDatabase = this.prisma) {
    const workspace = await database.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        maxProjects: true,
        maxMembers: true,
        maxTargets: true,
        maxConcurrentOperations: true,
        maxArtifactBytes: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const [projects, members, targets, deploymentOperations, provisioningOperations, artifacts] =
      await Promise.all([
        database.project.count({ where: { workspaceId } }),
        database.workspaceMember.count({ where: { workspaceId } }),
        database.targetAllocation.count({ where: { workspaceId } }),
        database.deploymentOperation.count({
          where: { status: 'running', environment: { project: { workspaceId } } },
        }),
        database.provisioningOperation.count({
          where: { workspaceId, status: { in: ACTIVE_PROVISIONING_STATUSES } },
        }),
        database.buildArtifact.aggregate({
          where: {
            project: { workspaceId },
            status: { in: RESERVED_ARTIFACT_STATUSES },
          },
          _sum: { sizeBytes: true },
        }),
      ]);
    const artifactBytes = artifacts._sum.sizeBytes ?? 0n;
    const concurrentOperations = deploymentOperations + provisioningOperations;

    return this.toSnapshot(workspace, {
      projects,
      members,
      targets,
      concurrentOperations,
      artifactBytes,
    });
  }

  async list(): Promise<WorkspaceCapacitySnapshot[]> {
    const workspaces = await this.prisma.workspace.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(workspaces.map(({ id }) => this.snapshot(id)));
  }

  async update(workspaceId: string, values: WorkspaceCapacityUpdate) {
    const maxArtifactBytes = BigInt(values.maxArtifactStorageGiB) * 1024n * 1024n * 1024n;
    const updated = await this.prisma.workspace.updateMany({
      where: { id: workspaceId },
      data: {
        maxProjects: values.maxProjects,
        maxMembers: values.maxMembers,
        maxTargets: values.maxTargets,
        maxConcurrentOperations: values.maxConcurrentOperations,
        maxArtifactBytes,
      },
    });
    if (updated.count !== 1) throw new NotFoundException('Workspace not found');
    return this.snapshot(workspaceId);
  }

  async assertAvailable(
    workspaceId: string,
    resource: WorkspaceCapacityResource,
    additional: number | bigint = 1,
    database: CapacityDatabase = this.prisma,
    excludedProvisioningId?: string,
  ): Promise<void> {
    const workspace = await database.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        maxProjects: true,
        maxMembers: true,
        maxTargets: true,
        maxConcurrentOperations: true,
        maxArtifactBytes: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    let used: number | bigint;
    let limit: number | bigint;
    switch (resource) {
      case 'projects':
        used = await database.project.count({ where: { workspaceId } });
        limit = workspace.maxProjects;
        break;
      case 'members':
        used = await database.workspaceMember.count({ where: { workspaceId } });
        limit = workspace.maxMembers;
        break;
      case 'targets':
        used = await database.targetAllocation.count({ where: { workspaceId } });
        limit = workspace.maxTargets;
        break;
      case 'concurrentOperations': {
        const [deployments, provisioning] = await Promise.all([
          database.deploymentOperation.count({
            where: { status: 'running', environment: { project: { workspaceId } } },
          }),
          database.provisioningOperation.count({
            where: {
              workspaceId,
              status: { in: ACTIVE_PROVISIONING_STATUSES },
              ...(excludedProvisioningId ? { id: { not: excludedProvisioningId } } : {}),
            },
          }),
        ]);
        used = deployments + provisioning;
        limit = workspace.maxConcurrentOperations;
        break;
      }
      case 'artifactBytes': {
        const aggregate = await database.buildArtifact.aggregate({
          where: {
            project: { workspaceId },
            status: { in: RESERVED_ARTIFACT_STATUSES },
          },
          _sum: { sizeBytes: true },
        });
        used = aggregate._sum.sizeBytes ?? 0n;
        limit = workspace.maxArtifactBytes;
        break;
      }
    }

    const exceeded =
      typeof used === 'bigint'
        ? used + BigInt(additional) > (limit as bigint)
        : used + Number(additional) > (limit as number);
    if (exceeded) {
      const label = RESOURCE_LABELS[resource];
      throw new ConflictException(
        resource === 'artifactBytes'
          ? `Workspace ${label} quota exceeded (${used.toString()} of ${limit.toString()} bytes used)`
          : `Workspace ${label} quota reached (max ${limit.toString()})`,
      );
    }
  }

  private toSnapshot(
    workspace: {
      id: string;
      name: string;
      maxProjects: number;
      maxMembers: number;
      maxTargets: number;
      maxConcurrentOperations: number;
      maxArtifactBytes: bigint;
    },
    usage: {
      projects: number;
      members: number;
      targets: number;
      concurrentOperations: number;
      artifactBytes: bigint;
    },
  ): WorkspaceCapacitySnapshot {
    const remaining = (limit: number, used: number) => Math.max(0, limit - used);
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      limits: {
        projects: workspace.maxProjects,
        members: workspace.maxMembers,
        targets: workspace.maxTargets,
        concurrentOperations: workspace.maxConcurrentOperations,
        artifactBytes: workspace.maxArtifactBytes.toString(),
      },
      usage: { ...usage, artifactBytes: usage.artifactBytes.toString() },
      remaining: {
        projects: remaining(workspace.maxProjects, usage.projects),
        members: remaining(workspace.maxMembers, usage.members),
        targets: remaining(workspace.maxTargets, usage.targets),
        concurrentOperations: remaining(
          workspace.maxConcurrentOperations,
          usage.concurrentOperations,
        ),
        artifactBytes: (workspace.maxArtifactBytes > usage.artifactBytes
          ? workspace.maxArtifactBytes - usage.artifactBytes
          : 0n
        ).toString(),
      },
    };
  }
}
