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
import {
  SupervisorClientService,
  SupervisorRejectedError,
  type SupervisorOperation,
  type SupervisorState,
} from './supervisor-client.service';

const ACTIVE = new Set(['requesting', 'accepted', 'running']);
// Longer than the /v1/update timeout: a request the Supervisor still verifies
// must not be failed while it may yet be accepted.
const REQUESTING_TIMEOUT_MS = 5 * 60_000;

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

/** Node reports a refused connection only as "fetch failed"; say what it means. */
function supervisorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return !message || message === 'fetch failed'
    ? 'The update Supervisor is not reachable (it may be restarting)'
    : message;
}

@Injectable()
export class PlatformUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PlatformReleaseCatalogService,
    private readonly supervisor: SupervisorClientService,
  ) {}

  async status(refresh = false) {
    const [catalogResult, supervisorResult] = await Promise.all([
      this.catalog.latest(refresh),
      this.supervisor.configured
        ? this.supervisor.status().then(
            (value) => ({ value, error: null }),
            (error: unknown) => ({
              value: null,
              error: supervisorErrorMessage(error),
            }),
          )
        : Promise.resolve({ value: null, error: 'Platform update Supervisor is not configured' }),
    ]);
    if (supervisorResult.value) await this.reconcile(supervisorResult.value);
    const history = await this.history();
    const active = history.find((item) => ACTIVE.has(item.status)) ?? null;
    // While the Supervisor swaps containers it can be briefly unreachable and
    // this API may already run the candidate image; an active update still
    // reports the version it started from until the Supervisor confirms.
    const currentVersion =
      supervisorResult.value?.currentVersion ??
      active?.fromVersion ??
      config.updates.platformVersion;
    const latestVersion = catalogResult.release?.manifest.version ?? null;
    const updateAvailable = Boolean(
      latestVersion && compareStableVersions(latestVersion, currentVersion) > 0,
    );
    const supervisorActive = Boolean(
      supervisorResult.value?.operation &&
      ['accepted', 'running'].includes(supervisorResult.value.operation.status),
    );
    return {
      enabled: config.edition === 'self-hosted' && config.updates.enabled,
      channel: catalogResult.channel,
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
      // While the Supervisor restarts itself at the end of an update it cannot
      // answer. The durable operation keeps the UI polling until it can.
      operation: supervisorResult.value?.operation ?? active,
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
    await this.reconcile(state);
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
      if (!(error instanceof SupervisorRejectedError)) {
        // A timeout or dropped connection does not prove the update did not
        // start. The row stays `requesting`; status polls adopt the
        // Supervisor's operation or fail the row after REQUESTING_TIMEOUT_MS.
        return operationDto(
          await this.prisma.platformUpdateOperation.update({
            where: { id: pending.id },
            data: {
              message: `Waiting for the Supervisor to confirm the InitPad ${toVersion} update`,
            },
          }),
        );
      }
      await this.prisma.platformUpdateOperation.update({
        where: { id: pending.id },
        data: {
          status: 'failed',
          stage: 'request-failed',
          message: error.message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException(error.message);
    }
    return operationDto(await this.persistOperation(operation));
  }

  /**
   * Aligns durable rows with the Supervisor, the only authority on whether an
   * update runs. An active row the Supervisor does not know was lost (state
   * reset, helper gone before it recorded anything) and would otherwise block
   * every later update.
   */
  private async reconcile(state: SupervisorState): Promise<void> {
    if (state.operation) await this.syncOperation(state.operation);
    const orphaned = await this.prisma.platformUpdateOperation.findMany({
      where: {
        status: { in: [...ACTIVE] },
        ...(state.operation ? { requestId: { not: state.operation.requestId } } : {}),
      },
      select: { id: true, status: true, createdAt: true },
    });
    const now = Date.now();
    for (const row of orphaned) {
      const requesting = row.status === 'requesting';
      if (requesting && now - row.createdAt.getTime() < REQUESTING_TIMEOUT_MS) continue;
      await this.prisma.platformUpdateOperation.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: 'failed',
          stage: requesting ? 'request-timeout' : 'interrupted',
          message: requesting
            ? 'The Supervisor never confirmed this update request; nothing was installed'
            : 'The Supervisor has no record of this update; it was interrupted',
          finishedAt: new Date(now),
        },
      });
    }
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
