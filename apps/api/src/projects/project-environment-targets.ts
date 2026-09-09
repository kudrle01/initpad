import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { targetCanRun, templateRuntime } from '../domain/capability';
import {
  EnvName,
  ProviderKind,
  RuntimeKind,
  TemplateManifest,
} from '../domain/types';
import type {
  DeploymentAllocation,
  ProviderConnection,
} from '../deployment/deployment-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { artifactStoreConfigured, config } from '../config';
import {
  agentVersionAtLeast,
  MIN_GATEWAY_ROUTE_AGENT_VERSION,
  MIN_PROJECT_AGENT_VERSION,
  supportsProjectAgent,
} from '../agents/agent-version';
import { allocationUsageDefaults } from '../targets/target-allocation-defaults';
import { BUILTIN_DOCKER, TargetRow, TargetsService } from '../targets/targets.service';

export interface ResolvedEnvironmentTarget {
  name: EnvName;
  target: TargetRow;
  allocationId: string;
}

/** Workspace isolation and capability policy at the environment-target boundary. */
export class ProjectEnvironmentTargets {
  private readonly logger = new Logger('ProjectEnvironmentTargets');

  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: TargetsService,
  ) {}

  connection(env: { target?: TargetRow | null }): ProviderConnection | undefined {
    return env.target ? this.targets.connectionForTarget(env.target) : undefined;
  }

  allocation(env: {
    targetId?: string | null;
    allocation?: DeploymentAllocation | null;
  }): DeploymentAllocation | undefined {
    if (!env.allocation || env.allocation.targetId !== env.targetId) return undefined;
    return env.allocation;
  }

  // Idempotent ADR-060 backfill. Existing target paths and URLs are preserved
  // while legacy environments gain a workspace-scoped allocation identity.
  async reconcileAllocations(): Promise<void> {
    const pending = await this.prisma.environment.findMany({
      where: { allocationId: null, targetId: { not: null } },
      select: { id: true, targetId: true, project: { select: { workspaceId: true } } },
    });
    if (!pending.length) return;
    let linked = 0;
    for (const environment of pending) {
      if (!environment.targetId) continue;
      const allocation = await this.ensureAllocation(
        environment.project.workspaceId,
        environment.targetId,
        true,
      );
      const result = await this.prisma.environment.updateMany({
        where: { id: environment.id, allocationId: null },
        data: { allocationId: allocation.id },
      });
      linked += result.count;
    }
    if (linked) this.logger.log(`Backfilled ${linked} environment(s) onto a target allocation`);
  }

  async ensureAllocation(
    workspaceId: string,
    targetId: string,
    preserveLegacy = false,
  ): Promise<DeploymentAllocation & {
    capabilities: string;
    status: string;
    maxEnvironments: number;
  }> {
    const selection = {
      id: true,
      targetId: true,
      namespace: true,
      rootPath: true,
      publicUrl: true,
      capabilities: true,
      status: true,
      maxEnvironments: true,
      cpuLimitMillicores: true,
      memoryLimitMb: true,
      pidsLimit: true,
      devTtlHours: true,
      testTtlHours: true,
    } as const;
    const existing = await this.prisma.targetAllocation.findUnique({
      where: { workspaceId_targetId: { workspaceId, targetId } },
      select: selection,
    });
    if (existing) return existing;
    const target = await this.prisma.target.findUniqueOrThrow({ where: { id: targetId } });
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { slug: true },
    });
    const usage = allocationUsageDefaults(target, workspace.slug, preserveLegacy);
    try {
      return await this.prisma.targetAllocation.create({
        data: {
          workspaceId,
          targetId,
          namespace: workspace.slug,
          rootPath: usage.rootPath,
          publicUrl: usage.publicUrl,
          capabilities: target.capabilities,
        },
        select: selection,
      });
    } catch (error) {
      // Concurrent project creation may lose the unique-key race. Reuse the
      // winner instead of turning safe concurrency into a provisioning error.
      const winner = await this.prisma.targetAllocation.findUnique({
        where: { workspaceId_targetId: { workspaceId, targetId } },
        select: selection,
      });
      if (winner) return winner;
      throw error;
    }
  }

  async prepareAllocations(
    workspaceId: string,
    environments: Array<{ name: EnvName; target: TargetRow }>,
    requiredRuntime: RuntimeKind,
  ): Promise<ResolvedEnvironmentTarget[]> {
    const grouped = new Map<string, Array<{ name: EnvName; target: TargetRow }>>();
    for (const environment of environments) {
      const group = grouped.get(environment.target.id) ?? [];
      group.push(environment);
      grouped.set(environment.target.id, group);
    }

    const allocationIds = new Map<string, string>();
    for (const [targetId, planned] of grouped) {
      const allocation = await this.ensureAllocation(workspaceId, targetId);
      if (allocation.status !== 'active') {
        throw new BadRequestException(
          `Workspace access to '${planned[0].target.name}' is paused.`,
        );
      }
      const capabilities = this.targets.parseCaps(allocation.capabilities);
      if (!capabilities.includes(requiredRuntime)) {
        throw new BadRequestException(
          `Workspace access to '${planned[0].target.name}' does not allow ${requiredRuntime} applications.`,
        );
      }
      const currentCount = await this.prisma.environment.count({
        where: { allocationId: allocation.id },
      });
      if (currentCount + planned.length > allocation.maxEnvironments) {
        throw new BadRequestException(
          `Workspace access quota for '${planned[0].target.name}' would be exceeded ` +
            `(using ${currentCount} of ${allocation.maxEnvironments}, project needs ${planned.length}).`,
        );
      }
      allocationIds.set(targetId, allocation.id);
    }

    return environments.map(({ name, target }) => ({
      name,
      target,
      allocationId: allocationIds.get(target.id)!,
    }));
  }

  async assertAcceptsDeploy(
    allocationId: string,
    environmentId: string,
    requiredRuntime?: RuntimeKind,
  ): Promise<void> {
    const allocation = await this.prisma.targetAllocation.findUnique({
      where: { id: allocationId },
      include: {
        target: { select: { name: true, scope: true, managementState: true } },
        _count: { select: { environments: true } },
      },
    });
    if (!allocation) return;
    if (allocation.target?.scope === 'user' && allocation.target.managementState !== 'active') {
      throw new BadRequestException(
        `Server '${allocation.target.name}' is ${allocation.target.managementState}; reconnect it before deploying.`,
      );
    }
    if (allocation.status !== 'active') {
      throw new BadRequestException(
        'Workspace access to this server is paused; new deployments are disabled.',
      );
    }
    const capabilities = this.targets.parseCaps(allocation.capabilities);
    if (requiredRuntime && !capabilities.includes(requiredRuntime)) {
      throw new BadRequestException(
        `Workspace access to this server does not allow ${requiredRuntime} applications.`,
      );
    }
    const alreadyBound = await this.prisma.environment.count({
      where: { id: environmentId, allocationId },
    });
    if (!alreadyBound && allocation._count.environments >= allocation.maxEnvironments) {
      throw new BadRequestException(
        `Workspace access quota reached (max ${allocation.maxEnvironments} environments).`,
      );
    }
  }

  assertUsable(target: TargetRow, template: TemplateManifest): void {
    if (target.kind === 'ssh') {
      throw new BadRequestException(
        `Target '${target.name}' uses the legacy SSH runtime and cannot receive new environment assignments. Use an InitPad Agent target instead.`,
      );
    }
    const managementState = target.managementState ?? 'active';
    if (target.scope === 'user' && managementState !== 'active') {
      throw new BadRequestException(
        `Target '${target.name}' is ${managementState}; reconnect it before assigning an environment.`,
      );
    }
    if (target.scope === 'user' && target.kind === 'docker') {
      if (!artifactStoreConfigured()) {
        throw new BadRequestException(
          `Agent-backed target '${target.name}' requires durable S3/MinIO artifact storage.`,
        );
      }
      if (!target.agent?.credentialHash || target.agent.disabledAt) {
        throw new BadRequestException(
          `Enroll and enable the Agent for target '${target.name}' before using it.`,
        );
      }
      if (!supportsProjectAgent(target.agent.version)) {
        throw new BadRequestException(
          `Target '${target.name}' requires InitPad Agent ${MIN_PROJECT_AGENT_VERSION.join('.')} or newer.`,
        );
      }
      if ((target.routingMode ?? 'direct-port') === 'managed-gateway') {
        if (
          target.gatewayAdapter !== 'caddy'
          || target.gatewayPreflightStatus !== 'passed'
          || !target.publicUrl
        ) {
          throw new BadRequestException(
            `Managed gateway target '${target.name}' must pass its Caddy gateway preflight before use.`,
          );
        }
        if (!agentVersionAtLeast(target.agent.version, MIN_GATEWAY_ROUTE_AGENT_VERSION)) {
          throw new BadRequestException(
            `Managed gateway target '${target.name}' requires InitPad Agent ${MIN_GATEWAY_ROUTE_AGENT_VERSION.join('.')} or newer.`,
          );
        }
      }
    }
    const capabilities = this.targets.parseCaps(target.capabilities);
    if (targetCanRun(template, { kind: target.kind as ProviderKind, capabilities })) {
      if (target.scope === 'user' && target.kind !== 'docker' && !target.verifiedAt) {
        throw new BadRequestException(
          `Target '${target.name}' must pass Test connection before it can host an environment.`,
        );
      }
      return;
    }
    if (!template.compatibleProviders.includes(target.kind as ProviderKind)) {
      throw new BadRequestException(`Template '${template.id}' cannot deploy over ${target.kind}.`);
    }
    throw new BadRequestException(
      `Target '${target.name}' cannot run ${templateRuntime(template)} apps (its capabilities: ${target.capabilities}).`,
    );
  }

  resolveTarget(
    name: EnvName,
    template: TemplateManifest,
    targetId: string | undefined,
    entities: TargetRow[],
  ): TargetRow {
    const runtime = templateRuntime(template);
    if (config.edition === 'saas' && !targetId) {
      throw new BadRequestException(
        `Choose a verified workspace target for the ${name} environment. Public SaaS has no local built-in deployment target.`,
      );
    }
    if (targetId) {
      const target = entities.find((candidate) => candidate.id === targetId);
      if (!target) throw new NotFoundException(`Target '${targetId}' not found`);
      this.assertUsable(target, template);
      return target;
    }
    if (name === 'prod') {
      const kind = this.defaultKind(template);
      const candidates = entities.filter(
        (candidate) =>
          candidate.kind === kind &&
          template.compatibleProviders.includes(candidate.kind as ProviderKind) &&
          this.targets.parseCaps(candidate.capabilities).includes(runtime),
      );
      const natural =
        candidates.find((candidate) => candidate.scope === 'builtin') ??
        candidates.find((candidate) =>
          candidate.scope === 'user'
          && (candidate.managementState ?? 'active') === 'active'
          && candidate.verifiedAt
        );
      if (natural) return natural;
    }
    const docker = entities.find((candidate) => candidate.id === BUILTIN_DOCKER);
    if (!docker) {
      throw new BadRequestException(
        'Built-in Docker target is missing — the platform has not seeded its infrastructure yet.',
      );
    }
    return docker;
  }

  private defaultKind(template: TemplateManifest): ProviderKind {
    const runtime = templateRuntime(template);
    if (runtime === 'static') return 'sftp';
    if (runtime === 'php') return 'sftp';
    return 'docker';
  }
}
