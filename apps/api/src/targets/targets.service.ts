import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeploymentService } from '../deployment/deployment.service';
import { artifactStoreConfigured, config } from '../config';
import { decryptSecret, encryptSecret } from '../common/secret';
import {
  GatewayPreflightStatus,
  ProviderKind,
  RuntimeKind,
  Target,
  TargetManagementState,
  TargetRoutingMode,
  TargetScope,
  TargetUsage,
} from '../domain/types';
import type { ProviderConnection, VerifyResult } from '../deployment/deployment-provider.interface';
import { normalizeManagedGatewayOrigin } from './managed-gateway';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  agentVersionAtLeast,
  MIN_GATEWAY_ROUTE_AGENT_VERSION,
  supportsProjectAgent,
} from '../agents/agent-version';
import { AuditEventsService } from '../audit/audit-events.service';

const TARGET_FIELD_LABELS: Partial<Record<keyof UpdateTargetDto, string>> = {
  name: 'name',
  capabilities: 'capabilities',
  host: 'host',
  port: 'port',
  username: 'username',
  auth: 'authenticationMethod',
  secret: 'authenticationCredentials',
  remotePath: 'remotePath',
  publicUrl: 'publicUrl',
  routingMode: 'routingMode',
};

function changedTargetFields(
  dto: UpdateTargetDto,
  row: TargetRow,
  publicUrl: string,
  routingMode: TargetRoutingMode,
): string {
  const changed = (key: keyof UpdateTargetDto): boolean => {
    switch (key) {
      case 'name': return dto.name !== row.name;
      case 'capabilities':
        return [...new Set(dto.capabilities)].sort().join(',') !== row.capabilities;
      case 'host': return dto.host !== row.host;
      case 'port': return dto.port !== row.port;
      case 'username': return dto.username !== row.username;
      case 'auth': return dto.auth !== row.auth;
      case 'secret': return Boolean(dto.secret);
      case 'remotePath': return dto.remotePath !== row.remotePath;
      case 'publicUrl': return publicUrl !== row.publicUrl;
      case 'routingMode': return routingMode !== (row.routingMode ?? 'direct-port');
      case 'kind': return false;
    }
  };
  return (Object.keys(dto) as (keyof UpdateTargetDto)[])
    .filter(changed)
    .map((key) => TARGET_FIELD_LABELS[key])
    .filter((label): label is string => label !== undefined)
    .sort()
    .join(',');
}

// Stable ids for the seeded built-in targets (the simulated infrastructure).
export const BUILTIN_DOCKER = 'builtin-docker';
export const BUILTIN_SSH = 'builtin-ssh';
export const BUILTIN_SFTP = 'builtin-sftp';

// Structural shape of a Target row (avoids importing the generated Prisma type).
export interface TargetRow {
  id: string;
  name: string;
  kind: string;
  scope: string;
  capabilities: string;
  host: string | null;
  port: number | null;
  username: string | null;
  auth: string | null;
  secret: string | null;
  remotePath: string | null;
  publicUrl: string | null;
  managementState?: string;
  managementStateChangedAt?: Date | null;
  routingMode?: string;
  gatewayAdapter?: string | null;
  gatewayPreflightStatus?: string;
  gatewayPreflightJobId?: string | null;
  gatewayPreflightAt?: Date | null;
  gatewayPreflightError?: string | null;
  verifiedAt: Date | null;
  ownerId: string | null;
  workspaceId: string | null;
  createdAt: Date;
  agent?: {
    credentialHash: string | null;
    disabledAt: Date | null;
    version: string | null;
  } | null;
}

/**
 * Deployment targets ("everything is a target"). Seeds the built-in simulated
 * infrastructure on startup and manages user-registered servers (register,
 * edit, delete, test connection). Built-in targets carry only display metadata;
 * their live connection comes from config, so deployments to them are unchanged.
 */
@Injectable()
export class TargetsService implements OnModuleInit {
  private readonly logger = new Logger('TargetsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly deployment: DeploymentService,
    private readonly workspaces: WorkspacesService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: async () => undefined,
    },
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedBuiltins();
  }

  // Upserts the three built-in targets from config. Idempotent — safe on every
  // boot; connection details for these come from config at deploy time.
  private async seedBuiltins(): Promise<void> {
    const { ssh, sftp } = config.providers;
    const builtins: Array<Omit<TargetRow, 'verifiedAt' | 'createdAt' | 'agent'>> = [
      {
        id: BUILTIN_DOCKER,
        name: 'Company Docker (dev/test)',
        kind: 'docker',
        scope: 'builtin',
        capabilities: 'static,node,php,python',
        host: null,
        port: null,
        username: null,
        auth: null,
        secret: null,
        remotePath: null,
        publicUrl: null,
        routingMode: 'direct-port',
        ownerId: null,
        workspaceId: null,
      },
      {
        id: BUILTIN_SSH,
        name: 'Company VPS (SSH)',
        kind: 'ssh',
        scope: 'builtin',
        capabilities: 'node',
        host: ssh.host,
        port: ssh.port,
        username: ssh.username,
        auth: 'password',
        secret: null,
        remotePath: ssh.remoteRoot,
        publicUrl: null,
        routingMode: 'direct-port',
        ownerId: null,
        workspaceId: null,
      },
      {
        id: BUILTIN_SFTP,
        name: 'Company static host (SFTP)',
        kind: 'sftp',
        scope: 'builtin',
        capabilities: 'static',
        host: sftp.host,
        port: sftp.port,
        username: sftp.username,
        auth: 'password',
        secret: null,
        remotePath: sftp.remoteRoot,
        publicUrl: sftp.publicUrl,
        routingMode: 'direct-port',
        ownerId: null,
        workspaceId: null,
      },
    ];

    try {
      for (const b of builtins) {
        const { id, ...rest } = b;
        await this.prisma.target.upsert({
          where: { id },
          // Keep display metadata in sync with config; do not reset verifiedAt.
          update: {
            name: rest.name,
            capabilities: rest.capabilities,
            host: rest.host,
            port: rest.port,
            username: rest.username,
            remotePath: rest.remotePath,
            publicUrl: rest.publicUrl,
            routingMode: rest.routingMode,
          },
          // Built-ins are treated as ready (they represent the platform's own
          // infra); the user can still run a live connection test.
          create: { id, ...rest, verifiedAt: new Date() },
        });
      }
      this.logger.log('Built-in deployment targets ready');
    } catch (e) {
      // Most likely the Target table does not exist yet (migration pending).
      // Do not crash the whole app — other routes still work while the user
      // runs the migration.
      this.logger.error(`Could not seed built-in targets: ${(e as Error).message}`);
    }
  }

  // Built-ins + the user's own targets, as API summaries (no secret), with the
  // workspace-scoped bindings that explain why deletion is currently blocked.
  async listForUser(userId: string, requestedWorkspaceId?: string): Promise<Target[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    const rows = (await this.prisma.target.findMany({
      // Built-ins live inside one self-hosted installation. A public SaaS
      // control plane cannot deploy into its own local Docker/SSH demo stack;
      // only targets explicitly owned by the active workspace are real there.
      where: config.edition === 'saas'
        ? { workspaceId }
        : { OR: [{ scope: 'builtin' }, { workspaceId }] },
      orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }],
      include: {
        agent: { select: { credentialHash: true, disabledAt: true, version: true } },
      },
    })) as TargetRow[];

    const bindings = await this.prisma.environment.findMany({
      where: {
        targetId: { in: rows.map((r) => r.id) },
        project: { workspaceId },
      },
      select: {
        targetId: true,
        name: true,
        status: true,
        url: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ project: { name: 'asc' } }, { order: 'asc' }],
    });
    const usage = new Map<string, TargetUsage[]>();
    for (const binding of bindings) {
      if (!binding.targetId) continue;
      const entries = usage.get(binding.targetId) ?? [];
      entries.push({
        projectId: binding.project.id,
        projectName: binding.project.name,
        environment: binding.name as TargetUsage['environment'],
        status: binding.status as TargetUsage['status'],
        url: binding.url,
      });
      usage.set(binding.targetId, entries);
    }
    return rows.map((row) => {
      const targetUsage = usage.get(row.id) ?? [];
      return this.toSummary(row, targetUsage.length > 0, targetUsage);
    });
  }

  // Raw rows (with secrets) for internal use by ProjectsService (default
  // selection + capability checks at project creation).
  async listEntities(workspaceId: string): Promise<TargetRow[]> {
    return (await this.prisma.target.findMany({
      where: config.edition === 'saas'
        ? { workspaceId }
        : { OR: [{ scope: 'builtin' }, { workspaceId }] },
      include: {
        agent: { select: { credentialHash: true, disabledAt: true, version: true } },
      },
    })) as TargetRow[];
  }

  async create(userId: string, dto: CreateTargetDto, requestedWorkspaceId?: string): Promise<Target> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspaceId, 'maintain');
    const agentBacked = dto.kind === 'docker';
    const routingMode = agentBacked ? dto.routingMode ?? 'direct-port' : 'direct-port';
    let publicUrl = dto.publicUrl;
    if (agentBacked) {
      this.assertNoRemoteCredentials(dto);
      publicUrl = this.normalizeAgentPublicUrl(dto.publicUrl, routingMode);
    } else {
      if (dto.routingMode && dto.routingMode !== 'direct-port') {
        throw new BadRequestException('Managed gateway routing is available only for Docker Agent targets');
      }
      this.assertSafeEndpoint(dto.host!, dto.publicUrl);
    }
    if (await this.prisma.target.findFirst({ where: { workspaceId, name: dto.name } })) {
      throw new BadRequestException(`This workspace already has a target named '${dto.name}'`);
    }
    const row = (await this.prisma.target.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        scope: 'user',
        capabilities: this.toCsv(dto.capabilities),
        host: agentBacked ? null : dto.host!,
        port: agentBacked ? null : dto.port!,
        username: agentBacked ? null : dto.username!,
        auth: agentBacked ? null : dto.auth!,
        secret: agentBacked ? null : encryptSecret(dto.secret!),
        remotePath: agentBacked ? null : dto.remotePath!,
        publicUrl,
        routingMode,
        gatewayAdapter: routingMode === 'managed-gateway' ? 'caddy' : null,
        ownerId: userId,
        workspaceId,
      },
    })) as TargetRow;
    await this.auditEvents.record({
      workspaceId,
      actorUserId: userId,
      action: 'target.created',
      resourceType: 'target',
      resourceId: row.id,
      resourceName: row.name,
      details: {
        kind: row.kind,
        routingMode: row.routingMode ?? 'direct-port',
        capabilities: row.capabilities,
      },
    });
    return this.toSummary(row, false);
  }

  async update(id: string, ownerId: string, dto: UpdateTargetDto): Promise<Target> {
    const row = await this.getUserTarget(id, ownerId, 'maintain');
    if (this.managementState(row) === 'retired') {
      throw new BadRequestException('Restore this retired target before editing it');
    }
    if (dto.kind !== undefined && dto.kind !== row.kind) {
      throw new BadRequestException('Target type cannot be changed; create a new target instead');
    }
    const agentBacked = row.kind === 'docker';
    const routingMode = (dto.routingMode ?? row.routingMode ?? 'direct-port') as TargetRoutingMode;
    let publicUrl = dto.publicUrl ?? row.publicUrl ?? '';
    if (agentBacked) {
      this.assertNoRemoteCredentials(dto);
      if (dto.publicUrl !== undefined || dto.routingMode !== undefined) {
        publicUrl = this.normalizeAgentPublicUrl(publicUrl, routingMode);
      }
    } else {
      if (dto.routingMode && dto.routingMode !== 'direct-port') {
        throw new BadRequestException('Managed gateway routing is available only for Docker Agent targets');
      }
      this.assertSafeEndpoint(dto.host ?? row.host ?? '', dto.publicUrl ?? row.publicUrl ?? '');
    }
    if (dto.name && dto.name !== row.name) {
      const duplicate = await this.prisma.target.findFirst({
        where: { workspaceId: row.workspaceId, name: dto.name, id: { not: row.id } },
      });
      if (duplicate) throw new BadRequestException(`You already have a target named '${dto.name}'`);
    }
    const currentCapabilities = this.parseCaps(row.capabilities);
    const capabilitiesChanged =
      dto.capabilities !== undefined &&
      this.toCsv(dto.capabilities) !== this.toCsv(currentCapabilities);
    const capabilitiesRemoved = dto.capabilities !== undefined &&
      currentCapabilities.some((capability) => !dto.capabilities!.includes(capability));
    const routingChanged = routingMode !== (row.routingMode ?? 'direct-port');
    const managedOriginChanged =
      agentBacked
      && routingMode === 'managed-gateway'
      && dto.publicUrl !== undefined
      && publicUrl !== row.publicUrl;
    // Adding a capability cannot invalidate an existing environment. Removing
    // one can, so only destructive capability changes are blocked while the
    // target is in use. This lets a shared host evolve from static-only to
    // static+PHP without first moving every existing static deployment away.
    if (capabilitiesRemoved) {
      const inUse = await this.prisma.environment.count({ where: { targetId: row.id } });
      if (inUse > 0) {
        throw new BadRequestException(
          'A target in use cannot remove runtime capabilities. Move its environments first.',
        );
      }
    }
    if (routingChanged) {
      const inUse = await this.prisma.environment.count({ where: { targetId: row.id } });
      if (inUse > 0) {
        throw new BadRequestException(
          'A target in use cannot change routing mode. Remove or move its environments first.',
        );
      }
    }
    if (managedOriginChanged) {
      const inUse = await this.prisma.environment.count({ where: { targetId: row.id } });
      if (inUse > 0) {
        throw new BadRequestException(
          'A managed gateway target in use cannot change its DNS origin. Remove or move its environments first.',
        );
      }
    }
    // Any change to the connection invalidates the previous verification.
    const connectionChanged =
      !agentBacked &&
      (dto.host !== undefined ||
        dto.port !== undefined ||
        dto.username !== undefined ||
        dto.auth !== undefined ||
        dto.secret !== undefined ||
        dto.remotePath !== undefined ||
        dto.publicUrl !== undefined ||
        capabilitiesChanged);
    const updated = (await this.prisma.target.update({
      where: { id: row.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.capabilities !== undefined ? { capabilities: this.toCsv(dto.capabilities) } : {}),
        ...(dto.host !== undefined ? { host: dto.host } : {}),
        ...(dto.port !== undefined ? { port: dto.port } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.auth !== undefined ? { auth: dto.auth } : {}),
        ...(dto.secret ? { secret: encryptSecret(dto.secret) } : {}),
        ...(dto.remotePath !== undefined ? { remotePath: dto.remotePath } : {}),
        ...(dto.publicUrl !== undefined || routingChanged ? { publicUrl } : {}),
        ...(dto.routingMode !== undefined ? { routingMode } : {}),
        ...(routingChanged
          ? { gatewayAdapter: routingMode === 'managed-gateway' ? 'caddy' : null }
          : {}),
        ...(agentBacked && (routingChanged || dto.publicUrl !== undefined)
          ? {
              gatewayPreflightStatus: 'not-run',
              gatewayPreflightJobId: null,
              gatewayPreflightAt: null,
              gatewayPreflightError: null,
            }
          : {}),
        ...(connectionChanged ? { verifiedAt: null } : {}),
      },
    })) as TargetRow;
    const changedFields = changedTargetFields(dto, row, publicUrl, routingMode);
    if (changedFields) {
      await this.auditEvents.record({
        workspaceId: row.workspaceId!,
        actorUserId: ownerId,
        action: 'target.updated',
        resourceType: 'target',
        resourceId: updated.id,
        resourceName: updated.name,
        details: { changedFields },
      });
    }
    return this.toSummary(updated, false);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const row = await this.getUserTarget(id, ownerId, 'maintain');
    const inUse = await this.prisma.environment.count({ where: { targetId: row.id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `This target is used by ${inUse} environment(s). Point them at another target first.`,
      );
    }
    await this.prisma.target.delete({ where: { id: row.id } });
    await this.auditEvents.record({
      workspaceId: row.workspaceId!,
      actorUserId: ownerId,
      action: 'target.deleted',
      resourceType: 'target',
      resourceId: row.id,
      resourceName: row.name,
      details: { kind: row.kind },
    });
  }

  async disconnect(id: string, userId: string): Promise<void> {
    const row = await this.getUserTarget(id, userId, 'admin');
    if (this.managementState(row) === 'retired') {
      throw new BadRequestException('Restore this retired target before disconnecting it');
    }
    await this.makeUnavailable(row, userId, 'disconnected');
  }

  async retire(id: string, userId: string): Promise<void> {
    const row = await this.getUserTarget(id, userId, 'admin');
    await this.makeUnavailable(row, userId, 'retired');
  }

  async restore(id: string, userId: string): Promise<void> {
    const row = await this.getUserTarget(id, userId, 'admin');
    if (this.managementState(row) !== 'retired') {
      throw new BadRequestException('Only a retired target can be restored');
    }
    const changedAt = new Date();
    await this.prisma.target.update({
      where: { id: row.id },
      data: {
        managementState: 'disconnected',
        managementStateChangedAt: changedAt,
        verifiedAt: null,
      },
    });
    await this.auditEvents.record({
      workspaceId: row.workspaceId!,
      actorUserId: userId,
      action: 'target.restored',
      resourceType: 'target',
      resourceId: row.id,
      resourceName: row.name,
      details: { kind: row.kind, state: 'disconnected' },
    });
  }

  // Runs a live connection test and stamps verifiedAt on success.
  async verify(id: string, userId: string, requestedWorkspaceId?: string): Promise<VerifyResult> {
    const row = await this.getVisibleTarget(id, userId, 'maintain');
    if (this.managementState(row) === 'retired') {
      throw new BadRequestException('Restore this retired target before verifying its connection');
    }
    if (row.scope === 'user' && row.kind === 'docker') {
      throw new BadRequestException(
        'Agent-backed Docker targets are verified by Agent heartbeat, not an inbound connection test',
      );
    }
    if (row.scope === 'builtin') {
      const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
      await this.workspaces.require(userId, workspaceId, 'maintain');
    }
    const result = await this.deployment.verify(
      row.kind as ProviderKind,
      this.connectionForTarget(row, { allowDisconnected: true }),
    );
    if (result.ok && row.scope === 'user') {
      const reconnecting = this.managementState(row) !== 'active';
      await this.prisma.target.update({
        where: { id: row.id },
        data: {
          verifiedAt: new Date(),
          managementState: 'active',
          ...(reconnecting ? { managementStateChangedAt: new Date() } : {}),
        },
      });
      if (reconnecting) {
        await this.auditEvents.record({
          workspaceId: row.workspaceId!,
          actorUserId: userId,
          action: 'target.connected',
          resourceType: 'target',
          resourceId: row.id,
          resourceName: row.name,
          details: { kind: row.kind },
        });
      }
    }
    return result;
  }

  // A target the user may read (their own or a built-in).
  async getVisibleTarget(
    id: string,
    userId: string,
    permission: 'read' | 'write' | 'maintain' | 'admin' = 'read',
  ): Promise<TargetRow> {
    const row = (await this.prisma.target.findUnique({ where: { id } })) as TargetRow | null;
    if (!row) throw new NotFoundException(`Target '${id}' not found`);
    if (row.scope !== 'builtin') {
      if (!row.workspaceId) throw new ForbiddenException('Target has no workspace assignment');
      await this.workspaces.require(userId, row.workspaceId, permission);
    }
    return row;
  }

  private async getUserTarget(
    id: string,
    userId: string,
    permission: 'read' | 'write' | 'maintain' | 'admin',
  ): Promise<TargetRow> {
    const row = await this.getVisibleTarget(id, userId, permission);
    if (row.scope === 'builtin') {
      throw new BadRequestException('Built-in targets cannot be modified');
    }
    return row;
  }

  // Live connection for a target, or undefined for a built-in (built-ins deploy
  // through the config demo path, keeping their behaviour unchanged).
  connectionForTarget(
    target: TargetRow,
    options: { allowDisconnected?: boolean } = {},
  ): ProviderConnection | undefined {
    if (
      target.scope === 'user'
      && this.managementState(target) !== 'active'
      && !options.allowDisconnected
    ) {
      throw new BadRequestException(
        `Target '${target.name}' is ${this.managementState(target)} and cannot receive management commands`,
      );
    }
    if (target.scope !== 'user' || !target.host) return undefined;
    if (!target.secret) {
      throw new BadRequestException(`Target '${target.name}' has no management credential`);
    }
    const secret = target.secret ? decryptSecret(target.secret) : '';
    const isKey = target.auth === 'key';
    return {
      host: target.host,
      port: target.port ?? 22,
      username: target.username ?? '',
      password: isKey ? undefined : secret,
      privateKey: isKey ? secret : undefined,
      remoteRoot: target.remotePath ?? '',
      publicUrl: target.publicUrl ?? '',
    };
  }

  private managementState(target: TargetRow): TargetManagementState {
    return (target.managementState ?? 'active') as TargetManagementState;
  }

  private async makeUnavailable(
    row: TargetRow,
    userId: string,
    nextState: Exclude<TargetManagementState, 'active'>,
  ): Promise<void> {
    if (this.managementState(row) === nextState) return;
    const activeOperations = await this.prisma.environment.count({
      where: { targetId: row.id, activeOperationId: { not: null } },
    });
    if (activeOperations > 0) {
      throw new BadRequestException(
        `This target has ${activeOperations} environment operation(s) in progress. Wait for them to finish or cancel them before changing target management.`,
      );
    }
    const now = new Date();
    const agent = row.kind === 'docker'
      ? await this.prisma.agent.findUnique({ where: { targetId: row.id }, select: { id: true } })
      : null;
    const bindings = await this.prisma.environment.count({ where: { targetId: row.id } });
    const message = nextState === 'retired'
      ? 'Target retired by a workspace administrator'
      : 'Target disconnected by a workspace administrator';

    await this.prisma.$transaction([
      this.prisma.target.update({
        where: { id: row.id },
        data: {
          managementState: nextState,
          managementStateChangedAt: now,
          verifiedAt: null,
          // Remote credentials are intentionally unrecoverable after
          // disconnect. Docker targets do not store an inbound credential.
          ...(row.kind === 'docker' ? {} : { secret: null }),
          ...(row.kind === 'docker'
            ? {
                gatewayPreflightStatus: 'not-run',
                gatewayPreflightJobId: null,
                gatewayPreflightAt: null,
                gatewayPreflightError: null,
              }
            : {}),
        },
      }),
      this.prisma.agent.updateMany({
        where: { targetId: row.id },
        data: {
          disabledAt: now,
          enrollmentTokenHash: null,
          enrollmentExpiresAt: null,
          credentialHash: null,
        },
      }),
      this.prisma.workloadDiagnostic.updateMany({
        where: {
          status: { in: ['queued', 'running'] },
          currentJob: { is: { targetId: row.id } },
        },
        data: { status: 'failed', message, finishedAt: now },
      }),
      this.prisma.agentJob.updateMany({
        where: { targetId: row.id, status: { in: ['blocked', 'queued', 'leased'] } },
        data: {
          status: 'cancelled',
          progressStage: 'cancelled',
          message,
          leaseExpiresAt: null,
          finishedAt: now,
        },
      }),
    ]);

    await this.auditEvents.record({
      workspaceId: row.workspaceId!,
      actorUserId: userId,
      action: `target.${nextState}`,
      resourceType: 'target',
      resourceId: row.id,
      resourceName: row.name,
      details: { kind: row.kind, boundEnvironments: bindings },
    });
    if (agent) {
      await this.auditEvents.record({
        workspaceId: row.workspaceId!,
        actorUserId: userId,
        action: 'agent.disabled',
        resourceType: 'agent',
        resourceId: agent.id,
        resourceName: row.name,
        details: { targetId: row.id },
      });
    }
  }

  parseCaps(csv: string): RuntimeKind[] {
    return csv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as RuntimeKind[];
  }

  private toCsv(caps: string[]): string {
    return [...new Set(caps)].sort().join(',');
  }

  private assertSafeEndpoint(host: string, publicUrl: string): void {
    const blocked = new Set([
      'localhost',
      '0.0.0.0',
      '::',
      '::1',
      'api',
      'postgres',
      'gitea',
      'host.docker.internal',
      '169.254.169.254',
      'metadata.google.internal',
    ]);
    const normalizedHost = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !normalizedHost ||
      blocked.has(normalizedHost) ||
      normalizedHost.startsWith('127.') ||
      normalizedHost.startsWith('169.254.') ||
      /[\s/@]/.test(normalizedHost)
    ) {
      throw new BadRequestException('This target host is reserved or unsafe');
    }
    this.assertSafePublicUrl(publicUrl);
  }

  private assertSafePublicUrl(publicUrl: string): void {
    const blocked = new Set([
      'localhost',
      '0.0.0.0',
      '::',
      '::1',
      'api',
      'postgres',
      'gitea',
      'host.docker.internal',
      '169.254.169.254',
      'metadata.google.internal',
    ]);
    try {
      const url = new URL(publicUrl);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (!['http:', 'https:'].includes(url.protocol) || blocked.has(hostname)) {
        throw new Error('unsafe');
      }
    } catch {
      throw new BadRequestException('Public URL must be a safe HTTP(S) address');
    }
  }

  private normalizeAgentPublicUrl(
    publicUrl: string,
    routingMode: TargetRoutingMode,
  ): string {
    this.assertSafePublicUrl(publicUrl);
    if (routingMode === 'direct-port') return publicUrl;
    return normalizeManagedGatewayOrigin(publicUrl);
  }

  private assertNoRemoteCredentials(dto: {
    host?: string;
    port?: number;
    username?: string;
    auth?: string;
    secret?: string;
    remotePath?: string;
  }): void {
    if (
      dto.host !== undefined ||
      dto.port !== undefined ||
      dto.username !== undefined ||
      dto.auth !== undefined ||
      dto.secret !== undefined ||
      dto.remotePath !== undefined
    ) {
      throw new BadRequestException(
        'Agent-backed Docker targets must not contain inbound host credentials',
      );
    }
  }

  private toSummary(row: TargetRow, inUse: boolean, usage: TargetUsage[] = []): Target {
    const routingMode = row.routingMode ?? 'direct-port';
    const managementState = this.managementState(row);
    const managedGatewayReady =
      routingMode === 'managed-gateway'
      && row.gatewayAdapter === 'caddy'
      && row.gatewayPreflightStatus === 'passed'
      && Boolean(row.publicUrl)
      && agentVersionAtLeast(row.agent?.version, MIN_GATEWAY_ROUTE_AGENT_VERSION);
    const agentReady = row.scope === 'user' && row.kind === 'docker'
      ? Boolean(
          artifactStoreConfigured()
          && managementState === 'active'
          && (routingMode === 'direct-port' || managedGatewayReady)
          && row.agent?.credentialHash
          && !row.agent.disabledAt
          && supportsProjectAgent(row.agent.version),
        )
      : undefined;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as ProviderKind,
      scope: row.scope as TargetScope,
      capabilities: this.parseCaps(row.capabilities),
      host: row.host,
      port: row.port,
      username: row.username,
      auth: row.auth,
      remotePath: row.remotePath,
      publicUrl: row.publicUrl,
      managementState,
      managementStateChangedAt: row.managementStateChangedAt?.toISOString() ?? null,
      ...(row.scope === 'user' && row.kind !== 'docker'
        ? { credentialConfigured: Boolean(row.secret) }
        : {}),
      routingMode: routingMode as TargetRoutingMode,
      gatewayPreflight: routingMode === 'managed-gateway'
        ? {
            adapter: 'caddy',
            status: (row.gatewayPreflightStatus ?? 'not-run') as GatewayPreflightStatus,
            checkedAt: row.gatewayPreflightAt?.toISOString() ?? null,
            error: row.gatewayPreflightError ?? null,
          }
        : null,
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      ...(agentReady !== undefined
        ? { agentReady, agentVersion: row.agent?.version ?? null }
        : {}),
      inUse,
      usage,
    };
  }
}
