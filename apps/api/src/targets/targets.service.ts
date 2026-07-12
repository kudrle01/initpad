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
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../common/secret';
import {
  ProviderKind,
  RuntimeKind,
  Target,
  TargetScope,
} from '../domain/types';
import type { ProviderConnection, VerifyResult } from '../deployment/deployment-provider.interface';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';

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
  verifiedAt: Date | null;
  ownerId: string | null;
  createdAt: Date;
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
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedBuiltins();
  }

  // Upserts the three built-in targets from config. Idempotent — safe on every
  // boot; connection details for these come from config at deploy time.
  private async seedBuiltins(): Promise<void> {
    const { ssh, sftp } = config.providers;
    const builtins: Array<Omit<TargetRow, 'verifiedAt' | 'createdAt'>> = [
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
        ownerId: null,
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
        ownerId: null,
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
        ownerId: null,
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
  async listForUser(ownerId: string): Promise<Target[]> {
    const rows = (await this.prisma.target.findMany({
      where: { OR: [{ scope: 'builtin' }, { ownerId }] },
      orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }],
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
  async listEntities(ownerId: string): Promise<TargetRow[]> {
    return (await this.prisma.target.findMany({
      where: { OR: [{ scope: 'builtin' }, { ownerId }] },
    })) as TargetRow[];
  }

  async create(ownerId: string, dto: CreateTargetDto): Promise<Target> {
    this.assertSafeEndpoint(dto.host, dto.publicUrl);
    if (await this.prisma.target.findFirst({ where: { ownerId, name: dto.name } })) {
      throw new BadRequestException(`You already have a target named '${dto.name}'`);
    }
    const row = (await this.prisma.target.create({
      data: {
        name: dto.name,
        kind: dto.kind,
        scope: 'user',
        capabilities: this.toCsv(dto.capabilities),
        host: dto.host,
        port: dto.port,
        username: dto.username,
        auth: dto.auth,
        secret: encryptSecret(dto.secret),
        remotePath: dto.remotePath,
        publicUrl: dto.publicUrl,
        ownerId,
      },
    })) as TargetRow;
    return this.toSummary(row, false);
  }

  async update(id: string, ownerId: string, dto: UpdateTargetDto): Promise<Target> {
    const row = await this.getUserTarget(id, ownerId);
    this.assertSafeEndpoint(dto.host ?? row.host ?? '', dto.publicUrl ?? row.publicUrl ?? '');
    if (dto.name && dto.name !== row.name) {
      const duplicate = await this.prisma.target.findFirst({
        where: { ownerId, name: dto.name, id: { not: row.id } },
      });
      if (duplicate) throw new BadRequestException(`You already have a target named '${dto.name}'`);
    }
    const kindChanged = dto.kind !== undefined && dto.kind !== row.kind;
    const capabilitiesChanged =
      dto.capabilities !== undefined &&
      this.toCsv(dto.capabilities) !== this.toCsv(this.parseCaps(row.capabilities));
    if (kindChanged || capabilitiesChanged) {
      const inUse = await this.prisma.environment.count({ where: { targetId: row.id } });
      if (inUse > 0) {
        throw new BadRequestException(
          'A target in use cannot change kind or runtime capabilities. Move its environments first.',
        );
      }
    }
    // Any change to the connection invalidates the previous verification.
    const connectionChanged =
      kindChanged ||
      dto.host !== undefined ||
      dto.port !== undefined ||
      dto.username !== undefined ||
      dto.auth !== undefined ||
      dto.secret !== undefined ||
      dto.remotePath !== undefined ||
      dto.publicUrl !== undefined ||
      capabilitiesChanged;
    const updated = (await this.prisma.target.update({
      where: { id: row.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.capabilities !== undefined ? { capabilities: this.toCsv(dto.capabilities) } : {}),
        ...(dto.host !== undefined ? { host: dto.host } : {}),
        ...(dto.port !== undefined ? { port: dto.port } : {}),
        ...(dto.username !== undefined ? { username: dto.username } : {}),
        ...(dto.auth !== undefined ? { auth: dto.auth } : {}),
        ...(dto.secret ? { secret: encryptSecret(dto.secret) } : {}),
        ...(dto.remotePath !== undefined ? { remotePath: dto.remotePath } : {}),
        ...(dto.publicUrl !== undefined ? { publicUrl: dto.publicUrl } : {}),
        ...(connectionChanged ? { verifiedAt: null } : {}),
      },
    })) as TargetRow;
    // Keep the denormalised Environment.provider in sync with the target kind
    // so bound environments deploy over the right protocol.
    if (kindChanged) {
      await this.prisma.environment.updateMany({
        where: { targetId: row.id },
        data: { provider: dto.kind },
      });
    }
    return this.toSummary(updated, false);
  }

  async remove(id: string, ownerId: string): Promise<void> {
    const row = await this.getUserTarget(id, ownerId);
    const inUse = await this.prisma.environment.count({ where: { targetId: row.id } });
    if (inUse > 0) {
      throw new BadRequestException(
        `This target is used by ${inUse} environment(s). Point them at another target first.`,
      );
    }
    await this.prisma.target.delete({ where: { id: row.id } });
  }

  // Runs a live connection test and stamps verifiedAt on success.
  async verify(id: string, ownerId: string): Promise<VerifyResult> {
    const row = await this.getVisibleTarget(id, ownerId);
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
  async getVisibleTarget(id: string, ownerId: string): Promise<TargetRow> {
    const row = (await this.prisma.target.findUnique({ where: { id } })) as TargetRow | null;
    if (!row) throw new NotFoundException(`Target '${id}' not found`);
    if (row.scope !== 'builtin' && row.ownerId !== ownerId) {
      throw new ForbiddenException('Not your target');
    }
    return row;
  }

  private async getUserTarget(id: string, ownerId: string): Promise<TargetRow> {
    const row = await this.getVisibleTarget(id, ownerId);
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

  private toSummary(row: TargetRow, inUse: boolean): Target {
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
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      inUse,
    };
  }
}
