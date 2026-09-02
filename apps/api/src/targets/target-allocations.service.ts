import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateTargetAllocationDto } from './dto/create-target-allocation.dto';
import { UpdateTargetAllocationDto } from './dto/update-target-allocation.dto';
import { allocationUsageDefaults } from './target-allocation-defaults';
import {
  agentVersionAtLeast,
  MIN_GATEWAY_ROUTE_AGENT_VERSION,
  supportsProjectAgent,
} from '../agents/agent-version';
import { artifactStoreConfigured } from '../config';
import { AuditEventsService } from '../audit/audit-events.service';

function changedAllocationFields(
  dto: UpdateTargetAllocationDto,
  row: {
    capabilities: string;
    publicUrl: string | null;
    status: string;
    maxEnvironments: number;
  },
  capabilities: string | undefined,
): string {
  const labels: Partial<Record<keyof UpdateTargetAllocationDto, string>> = {
    capabilities: 'capabilities',
    publicUrl: 'publicUrl',
    status: 'status',
    maxEnvironments: 'maxEnvironments',
  };
  const isChanged = (key: keyof UpdateTargetAllocationDto): boolean => {
    switch (key) {
      case 'capabilities': return capabilities !== row.capabilities;
      case 'publicUrl': return dto.publicUrl !== row.publicUrl;
      case 'status': return dto.status !== row.status;
      case 'maxEnvironments': return dto.maxEnvironments !== row.maxEnvironments;
    }
  };
  return (Object.keys(dto) as (keyof UpdateTargetAllocationDto)[])
    .filter(isChanged)
    .map((key) => labels[key as keyof UpdateTargetAllocationDto])
    .filter((key): key is string => key !== undefined)
    .sort()
    .join(',');
}

export interface TargetAllocationSummary {
  id: string;
  targetId: string;
  targetName: string;
  workspaceId: string;
  namespace: string;
  rootPath: string | null;
  publicUrl: string | null;
  capabilities: string[];
  status: string;
  maxEnvironments: number;
  inUse: number;
}

/**
 * Workspace-scoped management of TargetAllocations (ADR-060 §4).
 *
 * Owner/admin manage; any member reads. Access to an allocation in another
 * workspace returns 404 (its existence is never revealed); an insufficient role
 * inside the caller's own workspace returns 403. Credentials are never touched —
 * they live on the physical Target.
 */
@Injectable()
export class TargetAllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: async () => undefined,
    },
  ) {}

  async list(userId: string, requestedWorkspaceId?: string): Promise<TargetAllocationSummary[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    const rows = await this.prisma.targetAllocation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      include: { target: { select: { name: true } }, _count: { select: { environments: true } } },
    });
    return rows.map((row) => this.toSummary(row));
  }

  async get(id: string, userId: string): Promise<TargetAllocationSummary> {
    const { row } = await this.authorize(id, userId, 'read');
    return this.toSummary(row);
  }

  async create(
    userId: string,
    dto: CreateTargetAllocationDto,
    requestedWorkspaceId?: string,
  ): Promise<TargetAllocationSummary> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.requireManage(userId, workspaceId);

    // The target must be usable by this workspace: a shared built-in or one the
    // workspace owns. A target owned by another workspace is treated as absent.
    const target = await this.prisma.target.findUnique({
      where: { id: dto.targetId },
      include: {
        agent: { select: { credentialHash: true, disabledAt: true, version: true } },
      },
    });
    if (!target || (target.scope !== 'builtin' && target.workspaceId !== workspaceId)) {
      throw new NotFoundException(`Target '${dto.targetId}' not found`);
    }
    if (target.scope === 'user' && target.kind === 'docker') {
      if (
        !artifactStoreConfigured()
        || !target.agent?.credentialHash
        || target.agent.disabledAt
        || !supportsProjectAgent(target.agent.version)
      ) {
        throw new BadRequestException(
          'Enroll and enable InitPad Agent 0.4.0 or newer before allocating this Docker target',
        );
      }
      if ((target.routingMode ?? 'direct-port') === 'managed-gateway') {
        if (
          target.gatewayAdapter !== 'caddy'
          || target.gatewayPreflightStatus !== 'passed'
          || !target.publicUrl
          || !agentVersionAtLeast(target.agent.version, MIN_GATEWAY_ROUTE_AGENT_VERSION)
        ) {
          throw new BadRequestException(
            `Managed gateway allocation requires a passed Caddy preflight and InitPad Agent ${MIN_GATEWAY_ROUTE_AGENT_VERSION.join('.')} or newer`,
          );
        }
      }
    }
    if (await this.prisma.targetAllocation.findUnique({
      where: { workspaceId_targetId: { workspaceId, targetId: dto.targetId } },
    })) {
      throw new BadRequestException('This workspace already has an allocation for that target');
    }

    const capabilities = this.resolveCapabilities(dto.capabilities, target.capabilities);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { slug: true },
    });
    const usage = allocationUsageDefaults(target, workspace.slug);
    const row = await this.prisma.targetAllocation.create({
      data: {
        workspaceId,
        targetId: dto.targetId,
        namespace: workspace.slug,
        rootPath: usage.rootPath,
        publicUrl: dto.publicUrl ?? usage.publicUrl,
        capabilities,
        maxEnvironments: dto.maxEnvironments ?? 50,
      },
      include: { target: { select: { name: true } }, _count: { select: { environments: true } } },
    });
    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'allocation.created',
      resourceType: 'allocation',
      resourceId: row.id,
      resourceName: row.target.name,
      details: {
        targetId: row.targetId,
        capabilities: row.capabilities,
        maxEnvironments: row.maxEnvironments,
      },
    });
    return this.toSummary(row);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateTargetAllocationDto,
  ): Promise<TargetAllocationSummary> {
    const { row } = await this.authorize(id, userId, 'manage');
    const capabilities =
      dto.capabilities !== undefined
        ? this.resolveCapabilities(dto.capabilities, row.target.capabilities)
        : undefined;
    const updated = await this.prisma.targetAllocation.update({
      where: { id: row.id },
      data: {
        ...(capabilities !== undefined ? { capabilities } : {}),
        ...(dto.publicUrl !== undefined ? { publicUrl: dto.publicUrl } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.maxEnvironments !== undefined ? { maxEnvironments: dto.maxEnvironments } : {}),
      },
      include: { target: { select: { name: true } }, _count: { select: { environments: true } } },
    });
    const changedFields = changedAllocationFields(dto, row, capabilities);
    if (changedFields) {
      await this.auditEvents.record({
        workspaceId: row.workspaceId,
        actorUserId: userId,
        action: 'allocation.updated',
        resourceType: 'allocation',
        resourceId: updated.id,
        resourceName: updated.target.name,
        details: { changedFields },
      });
    }
    return this.toSummary(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const { row } = await this.authorize(id, userId, 'manage');
    const inUse = await this.prisma.environment.count({ where: { allocationId: row.id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `This allocation is used by ${inUse} environment(s). Move them first.`,
      );
    }
    await this.prisma.targetAllocation.delete({ where: { id: row.id } });
    await this.auditEvents.record({
      workspaceId: row.workspaceId,
      actorUserId: userId,
      action: 'allocation.deleted',
      resourceType: 'allocation',
      resourceId: row.id,
      resourceName: row.target.name,
      details: { targetId: row.targetId },
    });
  }

  // Loads an allocation and enforces tenant + role rules. A missing allocation
  // or one in a workspace the caller does not belong to is 404 (existence
  // hidden); a member without the manage role is 403.
  private async authorize(id: string, userId: string, need: 'read' | 'manage') {
    const row = await this.prisma.targetAllocation.findUnique({
      where: { id },
      include: { target: { select: { name: true, capabilities: true } }, _count: { select: { environments: true } } },
    });
    if (!row) throw new NotFoundException(`Allocation '${id}' not found`);
    const role = await this.workspaces.roleFor(userId, row.workspaceId);
    if (!role) throw new NotFoundException(`Allocation '${id}' not found`);
    if (need === 'manage' && !this.workspaces.can(role, 'admin')) {
      throw new ForbiddenException('Workspace admin access required to manage allocations');
    }
    return { row, role };
  }

  private async requireManage(userId: string, workspaceId: string): Promise<void> {
    const role = await this.workspaces.roleFor(userId, workspaceId);
    if (!role) throw new NotFoundException('Workspace not found');
    if (!this.workspaces.can(role, 'admin')) {
      throw new ForbiddenException('Workspace admin access required to manage allocations');
    }
  }

  // The allocation's capabilities must be a subset of the target's.
  private resolveCapabilities(requested: string[] | undefined, targetCsv: string): string {
    const targetCaps = this.parse(targetCsv);
    if (!requested || requested.length === 0) return this.csv(targetCaps);
    const invalid = requested.filter((c) => !targetCaps.includes(c));
    if (invalid.length) {
      throw new BadRequestException(
        `Capabilities not offered by the target: ${invalid.join(', ')}`,
      );
    }
    return this.csv(requested);
  }

  private parse(csv: string): string[] {
    return csv.split(',').map((s) => s.trim()).filter(Boolean);
  }

  private csv(caps: string[]): string {
    return [...new Set(caps)].sort().join(',');
  }

  private toSummary(row: {
    id: string;
    targetId: string;
    workspaceId: string;
    namespace: string;
    rootPath: string | null;
    publicUrl: string | null;
    capabilities: string;
    status: string;
    maxEnvironments: number;
    target: { name: string };
    _count: { environments: number };
  }): TargetAllocationSummary {
    return {
      id: row.id,
      targetId: row.targetId,
      targetName: row.target.name,
      workspaceId: row.workspaceId,
      namespace: row.namespace,
      rootPath: row.rootPath,
      publicUrl: row.publicUrl,
      capabilities: this.parse(row.capabilities),
      status: row.status,
      maxEnvironments: row.maxEnvironments,
      inUse: row._count.environments,
    };
  }
}
