import {
  BadRequestException,
  ForbiddenException,
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
  TargetRoutingMode,
  TargetScope,
} from '../domain/types';
import type { ProviderConnection, VerifyResult } from '../deployment/deployment-provider.interface';
import { normalizeManagedGatewayOrigin } from './managed-gateway';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { supportsProjectAgent } from '../agents/agent-version';

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

  // Built-ins + the user's own targets, as API summaries (no secret), with an
  // inUse flag so the UI can block deletion of targets in use.
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

    const counts = await this.prisma.environment.groupBy({
      by: ['targetId'],
      where: { targetId: { in: rows.map((r) => r.id) } },
      _count: { targetId: true },
    });
    const used = new Set(counts.map((c) => c.targetId));
    return rows.map((r) => this.toSummary(r, used.has(r.id)));
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
    return this.toSummary(row, false);
  }

  async update(id: string, ownerId: string, dto: UpdateTargetDto): Promise<Target> {
    const row = await this.getUserTarget(id, ownerId, 'maintain');
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
  }

  // Runs a live connection test and stamps verifiedAt on success.
  async verify(id: string, userId: string, requestedWorkspaceId?: string): Promise<VerifyResult> {
    const row = await this.getVisibleTarget(id, userId, 'maintain');
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
      this.connectionForTarget(row),
    );
    if (result.ok && row.scope === 'user') {
      await this.prisma.target.update({
        where: { id: row.id },
        data: { verifiedAt: new Date() },
      });
    }
    return result;
  }

  // A target the user may read (their own or a built-in).
  async getVisibleTarget(
    id: string,
    userId: string,
    permission: 'read' | 'write' | 'maintain' = 'read',
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
    permission: 'read' | 'write' | 'maintain',
  ): Promise<TargetRow> {
    const row = await this.getVisibleTarget(id, userId, permission);
    if (row.scope === 'builtin') {
      throw new BadRequestException('Built-in targets cannot be modified');
    }
    return row;
  }

  // Live connection for a target, or undefined for a built-in (built-ins deploy
  // through the config demo path, keeping their behaviour unchanged).
  connectionForTarget(target: TargetRow): ProviderConnection | undefined {
    if (target.scope !== 'user' || !target.host) return undefined;
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

  private toSummary(row: TargetRow, inUse: boolean): Target {
    const agentReady = row.scope === 'user' && row.kind === 'docker'
      ? Boolean(
          artifactStoreConfigured()
          && (row.routingMode ?? 'direct-port') === 'direct-port'
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
      routingMode: (row.routingMode ?? 'direct-port') as TargetRoutingMode,
      gatewayPreflight: (row.routingMode ?? 'direct-port') === 'managed-gateway'
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
    };
  }
}
