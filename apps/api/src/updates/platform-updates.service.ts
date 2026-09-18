import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { compareStableVersions } from './release-manifest';
import { PlatformReleaseCatalogService } from './platform-release-catalog.service';
import { SupervisorClientService, type SupervisorOperation } from './supervisor-client.service';

const ACTIVE = new Set(['requesting', 'accepted', 'running']);

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function operationDto(row: {
  id: string;
  requestId: string;
  supervisorOperationId: string | null;
  requestedByUsername: string;
  requestedByDisplayName: string | null;
  fromVersion: string;
  toVersion: string;
  status: string;
  stage: string;
  message: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}) {
  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class PlatformUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PlatformReleaseCatalogService,
    private readonly supervisor: SupervisorClientService,
  ) {}

  async status() {
    const [catalogResult, supervisorResult] = await Promise.all([
      this.catalog.latest(),
      this.supervisor.configured
        ? this.supervisor.status().then(
            (value) => ({ value, error: null }),
            (error: unknown) => ({
              value: null,
              error: error instanceof Error ? error.message : 'Supervisor is unavailable',
            }),
          )
        : Promise.resolve({ value: null, error: 'Platform update Supervisor is not configured' }),
    ]);
    if (supervisorResult.value?.operation) {
      await this.syncOperation(supervisorResult.value.operation);
    }
    const history = await this.history();
    const currentVersion = supervisorResult.value?.currentVersion ?? config.updates.platformVersion;
    const latestVersion = catalogResult.release?.manifest.version ?? null;
    const updateAvailable = Boolean(
      latestVersion && compareStableVersions(latestVersion, currentVersion) > 0,
    );
    const active = history.find((item) => ACTIVE.has(item.status)) ?? null;
    const supervisorActive = Boolean(
      supervisorResult.value?.operation &&
      ['accepted', 'running'].includes(supervisorResult.value.operation.status),
    );
    return {
      enabled: config.edition === 'self-hosted' && config.updates.enabled,
      supervisorConfigured: this.supervisor.configured,
      supervisorOnline: supervisorResult.value !== null,
      supervisorError: supervisorResult.error,
      currentVersion,
      latestVersion,
      updateAvailable,
      canInstall:
        config.edition === 'self-hosted' &&
        config.updates.enabled &&
        this.supervisor.configured &&
        supervisorResult.value !== null &&
        updateAvailable &&
        !catalogResult.stale &&
        !catalogResult.error &&
        !active &&
        !supervisorActive,
      releaseUrl: catalogResult.release?.releaseUrl ?? null,
      publishedAt: catalogResult.release?.publishedAt ?? null,
      catalogCheckedAt: catalogResult.checkedAt,
      catalogStale: catalogResult.stale,
      catalogError: catalogResult.error,
      operation: supervisorResult.value?.operation ?? null,
      history,
    };
  }

  async request(userId: string, requestId: string) {
    if (config.edition !== 'self-hosted' || !config.updates.enabled) {
      throw new BadRequestException('Self-hosted platform updates are disabled');
    }
    if (!this.supervisor.configured) {
      throw new ServiceUnavailableException('Platform update Supervisor is not configured');
    }
    const duplicate = await this.prisma.platformUpdateOperation.findUnique({
      where: { requestId },
    });
    if (duplicate) return operationDto(duplicate);

    const [catalog, state, actor] = await Promise.all([
      this.catalog.latest(),
      this.supervisor.status().catch((error: unknown) => {
        throw new ServiceUnavailableException(
          error instanceof Error ? error.message : 'Platform update Supervisor is unavailable',
        );
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, name: true },
      }),
    ]);
    if (!actor) throw new BadRequestException('Administrator account no longer exists');
    if (catalog.stale || catalog.error || !catalog.release) {
      throw new ServiceUnavailableException(
        catalog.error || 'No verified platform release is currently available',
      );
    }
    const toVersion = catalog.release.manifest.version;
    if (compareStableVersions(toVersion, state.currentVersion) <= 0) {
      throw new BadRequestException('The latest verified platform release is already installed');
    }
    if (state.operation && ['accepted', 'running'].includes(state.operation.status)) {
      throw new ConflictException('Another platform update is already running');
    }
    const active = await this.prisma.platformUpdateOperation.findFirst({
      where: { status: { in: [...ACTIVE] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) throw new ConflictException('Another platform update is already running');

    let pending;
    try {
      pending = await this.prisma.platformUpdateOperation.create({
        data: {
          requestId,
          requestedById: userId,
          requestedByUsername: actor.username,
          requestedByDisplayName: actor.name,
          fromVersion: state.currentVersion,
          toVersion,
          status: 'requesting',
          stage: 'requesting',
          message: `Requesting verified InitPad ${toVersion} update`,
        },
      });
    } catch (error) {
      if (!uniqueViolation(error)) throw error;
      const concurrent = await this.prisma.platformUpdateOperation.findUnique({
        where: { requestId },
      });
      if (!concurrent) throw error;
      return operationDto(concurrent);
    }
    let operation: SupervisorOperation;
    try {
      operation = await this.supervisor.update(requestId, {
        version: toVersion,
        manifestBase64: catalog.release.manifestBase64,
        bundle: catalog.release.bundle,
      });
    } catch (error) {
      await this.prisma.platformUpdateOperation.update({
        where: { id: pending.id },
        data: {
          status: 'failed',
          stage: 'request-failed',
          message: (error instanceof Error
            ? error.message
            : 'Supervisor rejected the update'
          ).slice(0, 500),
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Supervisor rejected the update',
      );
    }
    return operationDto(await this.persistOperation(operation));
  }

  private async syncOperation(operation: SupervisorOperation): Promise<void> {
    const existing = await this.prisma.platformUpdateOperation.findUnique({
      where: { requestId: operation.requestId },
      select: { id: true },
    });
    if (existing) await this.persistOperation(operation);
  }

  private persistOperation(operation: SupervisorOperation) {
    return this.prisma.platformUpdateOperation.update({
      where: { requestId: operation.requestId },
      data: {
        supervisorOperationId: operation.id,
        fromVersion: operation.fromVersion,
        toVersion: operation.toVersion,
        status: operation.status,
        stage: operation.stage,
        message: operation.message,
        startedAt: new Date(operation.startedAt),
        finishedAt: operation.finishedAt ? new Date(operation.finishedAt) : null,
      },
    });
  }

  private async history() {
    const rows = await this.prisma.platformUpdateOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return rows.map(operationDto);
  }
}
