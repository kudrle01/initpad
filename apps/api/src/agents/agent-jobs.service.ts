import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Readable } from 'stream';
import { ARTIFACT_STORE, type ArtifactStore } from '../artifacts/artifact-store';
import { decryptSecret } from '../common/secret';
import { generateToken, hashToken } from '../common/token';
import {
  activeDeploymentPhasePredecessors,
  ActiveDeploymentPhase,
  terminalDeploymentPhase,
} from '../domain/deployment-operation-state';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayRoutesService } from '../targets/gateway-routes.service';
import { AgentsService, type AuthenticatedAgent } from './agents.service';
import { agentConfigFingerprint } from './agent-config-fingerprint';
import {
  agentVersionAtLeast,
  MIN_GATEWAY_AGENT_VERSION,
  MIN_LIFECYCLE_AGENT_VERSION,
} from './agent-version';
import {
  AgentJobCompleteDto,
  AgentJobProgressDto,
  CreateAgentLifecycleTestDto,
  CreateAgentProbeJobDto,
  CreateGatewayPreflightDto,
} from './dto/agent-job.dto';

const LEASE_MS = 30_000;
const NEXT_POLL_SECONDS = 2;
const LEASE_PREFIX = 'initpad_lease_';
const LIFECYCLE_TEST_IMAGE = 'nginx@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa';

interface JobRow {
  id: string;
  targetId: string;
  kind: string;
  protocolVersion: number;
  payload: unknown;
  status: string;
  attempt: number;
  leaseTokenHash: string | null;
  leaseExpiresAt: Date | null;
  progressSequence: number;
  progressPercent: number;
  progressStage: string;
  message: string | null;
  resultCode: string | null;
  result: unknown;
  createdAt: Date;
  leasedAt: Date | null;
  finishedAt: Date | null;
}

export interface AgentJobSummary {
  id: string;
  kind: string;
  status: string;
  attempt: number;
  progressSequence: number;
  progressPercent: number;
  progressStage: string;
  message: string | null;
  resultCode: string | null;
  createdAt: string;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
  finishedAt: string | null;
}

export interface AgentJobDelivery {
  artifact: {
    path: string;
    sha256: string;
    sizeBytes: number;
  };
  /** Resolved only for the winning lease and never stored in AgentJob.payload. */
  envVars: Record<string, string>;
}

export interface AgentArtifactDownload {
  stream: Readable;
  sha256: string;
  sizeBytes: number;
}

@Injectable()
export class AgentJobsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    @Inject(ARTIFACT_STORE) private readonly artifactStore: ArtifactStore,
    private readonly gatewayRoutes: GatewayRoutesService,
  ) {}

  async onModuleInit(): Promise<void> {
    // A crash can occur after the terminal AgentJob write but before its
    // Environment projection. The job result is durable, so safely replay it.
    const pendingOperations = await this.prisma.agentJob.findMany({
      where: {
        status: { in: ['succeeded', 'failed'] },
        deploymentOperation: { is: { status: 'running', finishedAt: null } },
      },
      select: { id: true },
    }).catch(() => []);
    for (const job of pendingOperations) {
      await this.reconcileGatewayRoute(job.id).catch(() => undefined);
      await this.reconcileTerminalJob(job.id).catch(() => undefined);
    }

    // Read only the currently fenced target jobs. Scanning every historical
    // terminal preflight on each API restart would grow without bound.
    const pendingPreflights = await this.prisma.target.findMany({
      where: {
        gatewayPreflightStatus: { in: ['queued', 'running'] },
        gatewayPreflightJobId: { not: null },
      },
      select: { gatewayPreflightJobId: true },
    }).catch(() => []);
    for (const target of pendingPreflights) {
      if (target.gatewayPreflightJobId) {
        await this.reconcileGatewayPreflight(target.gatewayPreflightJobId)
          .catch(() => undefined);
      }
    }

    // GatewayRoute.reconcileJobId is the durable generation fence. Replay
    // only those current projections, never the unbounded AgentJob history.
    const pendingRoutes = await this.prisma.gatewayRoute.findMany({
      where: { reconcileJobId: { not: null } },
      select: { reconcileJobId: true },
    }).catch(() => []);
    for (const route of pendingRoutes) {
      if (route.reconcileJobId) {
        await this.reconcileGatewayRoute(route.reconcileJobId).catch(() => undefined);
      }
    }
  }

  async createProbe(
    targetId: string,
    userId: string,
    dto: CreateAgentProbeJobDto,
  ): Promise<AgentJobSummary> {
    await this.agents.requireTargetAccess(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({
      where: { targetId },
      select: { credentialHash: true, disabledAt: true },
    });
    if (!agent?.credentialHash || agent.disabledAt) {
      throw new BadRequestException('Enroll and connect the Agent before testing its job protocol');
    }
    const row = await this.prisma.agentJob.upsert({
      where: { dedupeKey: `probe:${targetId}:${dto.requestId}` },
      update: {},
      create: {
        targetId,
        dedupeKey: `probe:${targetId}:${dto.requestId}`,
        kind: 'probe',
        protocolVersion: 1,
        payload: { durationSeconds: dto.durationSeconds },
        status: 'queued',
        progressStage: 'queued',
        message: 'Waiting for Agent',
      },
    });
    return this.summary(row as JobRow);
  }

  async createLifecycleTest(
    targetId: string,
    userId: string,
    dto: CreateAgentLifecycleTestDto,
  ): Promise<AgentJobSummary> {
    await this.agents.requireTargetAccess(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({
      where: { targetId },
      select: {
        credentialHash: true,
        disabledAt: true,
        version: true,
        target: {
          select: {
            kind: true,
            scope: true,
            workspaceId: true,
            capabilities: true,
            publicUrl: true,
            workspace: { select: { slug: true } },
          },
        },
      },
    });
    if (!agent?.credentialHash || agent.disabledAt) {
      throw new BadRequestException('Enroll and connect the Agent before testing Docker lifecycle operations');
    }
    if (!this.supportsLifecycle(agent.version)) {
      throw new BadRequestException(`Docker lifecycle testing requires InitPad Agent ${MIN_LIFECYCLE_AGENT_VERSION.join('.')} or newer`);
    }
    const target = agent.target;
    if (
      target.kind !== 'docker'
      || target.scope !== 'user'
      || !target.workspaceId
      || !target.workspace?.slug
    ) {
      throw new BadRequestException('Docker lifecycle testing requires a workspace-owned Docker target');
    }

    // The diagnostic uses the same first-class allocation boundary as future
    // deployments. It cannot invent a namespace in an Agent job payload.
    const allocation = await this.prisma.targetAllocation.upsert({
      where: {
        workspaceId_targetId: { workspaceId: target.workspaceId, targetId },
      },
      update: {},
      create: {
        workspaceId: target.workspaceId,
        targetId,
        namespace: target.workspace.slug,
        rootPath: null,
        publicUrl: target.publicUrl,
        capabilities: target.capabilities,
        maxEnvironments: 50,
      },
    });
    const revision = `probe-${dto.requestId.replace(/-/g, '').slice(0, 12)}`;
    const row = await this.prisma.agentJob.upsert({
      where: { dedupeKey: `lifecycle-test:${targetId}:${dto.requestId}` },
      update: {},
      create: {
        targetId,
        allocationId: allocation.id,
        dedupeKey: `lifecycle-test:${targetId}:${dto.requestId}`,
        kind: 'lifecycle-test',
        protocolVersion: 1,
        payload: {
          allocationId: allocation.id,
          namespace: allocation.namespace,
          projectSlug: 'agent-lifecycle-check',
          environment: 'diagnostic',
          revision,
          imageRef: LIFECYCLE_TEST_IMAGE,
          containerPort: 80,
          healthPath: '/',
        },
        status: 'queued',
        progressStage: 'queued',
        message: 'Waiting for Agent',
      },
    });
    return this.summary(row as JobRow);
  }

  async createGatewayPreflight(
    targetId: string,
    userId: string,
    dto: CreateGatewayPreflightDto,
  ): Promise<AgentJobSummary> {
    await this.agents.requireTargetAccess(targetId, userId, 'admin');
    const agent = await this.prisma.agent.findUnique({
      where: { targetId },
      select: {
        credentialHash: true,
        disabledAt: true,
        version: true,
        target: {
          select: {
            kind: true,
            scope: true,
            routingMode: true,
            gatewayAdapter: true,
            publicUrl: true,
          },
        },
      },
    });
    if (!agent?.credentialHash || agent.disabledAt) {
      throw new BadRequestException('Enroll and connect the Agent before testing its gateway');
    }
    if (!agentVersionAtLeast(agent.version, MIN_GATEWAY_AGENT_VERSION)) {
      throw new BadRequestException(
        `Gateway preflight requires InitPad Agent ${MIN_GATEWAY_AGENT_VERSION.join('.')} or newer`,
      );
    }
    const target = agent.target;
    if (
      target.kind !== 'docker'
      || target.scope !== 'user'
      || target.routingMode !== 'managed-gateway'
      || target.gatewayAdapter !== 'caddy'
      || !target.publicUrl
    ) {
      throw new BadRequestException('Gateway preflight requires a managed-gateway Docker target');
    }

    const dedupeKey = `gateway-preflight:${targetId}:${dto.requestId}`;
    let row: JobRow;
    try {
      row = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.agentJob.create({
          data: {
          targetId,
          dedupeKey,
          kind: 'gateway-preflight',
          protocolVersion: 1,
          payload: { adapter: 'caddy', publicUrl: target.publicUrl },
          status: 'queued',
          progressStage: 'queued',
          message: 'Waiting for Agent',
          },
        });
        await transaction.target.update({
          where: { id: targetId },
          data: {
            gatewayPreflightStatus: 'queued',
            gatewayPreflightJobId: created.id,
            gatewayPreflightAt: null,
            gatewayPreflightError: null,
          },
        });
        return created as JobRow;
      });
    } catch (error) {
      // An HTTP retry with the same request id is idempotent, but must never
      // move the target fence back to this older job after a newer preflight.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.agentJob.findUnique({ where: { dedupeKey } });
      if (!existing) throw error;
      row = existing as JobRow;
    }
    return this.summary(row);
  }

  async list(targetId: string, userId: string): Promise<AgentJobSummary[]> {
    await this.agents.requireTargetAccess(targetId, userId, 'read');
    const rows = await this.prisma.agentJob.findMany({
      where: { targetId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return rows.map((row) => this.summary(row as JobRow));
  }

  async claim(authorization: string | undefined): Promise<{
    job: null | {
      id: string;
      targetId: string;
      kind: string;
      protocolVersion: number;
      payload: unknown;
      attempt: number;
      leaseToken: string;
      leaseExpiresAt: string;
      delivery?: AgentJobDelivery;
    };
    nextPollSeconds: number;
  }> {
    const agent = await this.agents.authenticateCredential(authorization);
    for (let raceAttempt = 0; raceAttempt < 3; raceAttempt += 1) {
      const now = new Date();
      const candidate = await this.prisma.agentJob.findFirst({
        where: {
          targetId: agent.targetId,
          protocolVersion: { lte: agent.protocolVersion },
          OR: [
            { status: 'queued' },
            { status: 'leased', leaseExpiresAt: { lte: now } },
          ],
          ...this.activeAgentFilter(agent),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, leaseTokenHash: true },
      });
      if (!candidate) return { job: null, nextPollSeconds: NEXT_POLL_SECONDS };

      const leaseToken = `${LEASE_PREFIX}${generateToken()}`;
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      const claimed = await this.prisma.agentJob.updateMany({
        where: {
          id: candidate.id,
          targetId: agent.targetId,
          ...this.activeAgentFilter(agent),
          ...(candidate.status === 'queued'
            ? { status: 'queued' }
            : {
                status: 'leased',
                leaseExpiresAt: { lte: now },
                leaseTokenHash: candidate.leaseTokenHash,
              }),
        },
        data: {
          status: 'leased',
          leasedByAgentId: agent.id,
          leaseTokenHash: hashToken(leaseToken),
          leasedAt: now,
          leaseExpiresAt,
          attempt: { increment: 1 },
          progressSequence: 0,
          progressPercent: 0,
          progressStage: 'assigned',
          message: 'Claimed by Agent',
          resultCode: null,
          result: Prisma.DbNull,
          finishedAt: null,
        },
      });
      if (claimed.count !== 1) continue;
      const row = await this.prisma.agentJob.findUniqueOrThrow({ where: { id: candidate.id } });
      await this.advanceDeploymentPhase(
        row.deploymentOperationId,
        'assigned',
        'Claimed by Agent',
      );
      let delivery: AgentJobDelivery | undefined;
      if (['deploy', 'rollback'].includes(row.kind)) {
        try {
          delivery = await this.deliveryForLease(agent, row.id, leaseToken);
        } catch (error) {
          await this.failInvalidDelivery(
            agent,
            row.id,
            leaseToken,
            error instanceof Error ? error.message : 'Agent delivery could not be prepared',
          );
          continue;
        }
      }
      return {
        job: {
          id: row.id,
          targetId: row.targetId,
          kind: row.kind,
          protocolVersion: row.protocolVersion,
          payload: row.payload,
          attempt: row.attempt,
          leaseToken,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          ...(delivery ? { delivery } : {}),
        },
        nextPollSeconds: NEXT_POLL_SECONDS,
      };
    }
    return { job: null, nextPollSeconds: 1 };
  }

  async openArtifact(
    authorization: string | undefined,
    jobId: string,
    leaseToken: string | undefined,
  ): Promise<AgentArtifactDownload> {
    if (!leaseToken?.startsWith(LEASE_PREFIX)) throw this.lostLease();
    const agent = await this.agents.authenticateCredential(authorization);
    const binding = await this.deliveryBinding(agent, jobId, leaseToken);
    if (!binding || !['deploy', 'rollback'].includes(binding.kind)) throw this.lostLease();
    const artifact = this.assertDeliveryBinding(binding);
    const object = await this.artifactStore.head(artifact.storageRef);
    const sizeBytes = this.safeSize(artifact.sizeBytes);
    if (!object || object.sizeBytes !== sizeBytes) {
      throw new NotFoundException('Verified build artifact is no longer available');
    }
    return {
      stream: await this.artifactStore.openRead(artifact.storageRef),
      sha256: this.normalizedDigest(artifact.digest),
      sizeBytes,
    };
  }

  async renew(
    authorization: string | undefined,
    jobId: string,
    leaseToken: string,
  ): Promise<{ leaseExpiresAt: string }> {
    const agent = await this.agents.authenticateCredential(authorization);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const renewed = await this.prisma.agentJob.updateMany({
      where: this.activeLeaseWhere(agent, jobId, leaseToken, now),
      data: { leaseExpiresAt },
    });
    if (renewed.count !== 1) throw this.lostLease();
    return { leaseExpiresAt: leaseExpiresAt.toISOString() };
  }

  async progress(
    authorization: string | undefined,
    jobId: string,
    dto: AgentJobProgressDto,
  ): Promise<AgentJobSummary> {
    const agent = await this.agents.authenticateCredential(authorization);
    const now = new Date();
    const leaseTokenHash = hashToken(dto.leaseToken);
    const advanced = await this.prisma.agentJob.updateMany({
      where: {
        ...this.activeLeaseWhere(agent, jobId, dto.leaseToken, now),
        progressSequence: { lt: dto.sequence },
      },
      data: {
        progressSequence: dto.sequence,
        progressPercent: dto.percent,
        progressStage: dto.stage,
        message: dto.message,
      },
    });
    if (advanced.count !== 1) {
      const current = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
      if (
        !current ||
        current.targetId !== agent.targetId ||
        current.status !== 'leased' ||
        current.leaseTokenHash !== leaseTokenHash ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt <= now
      ) {
        throw this.lostLease();
      }
      await this.mirrorDeploymentProgress(jobId, dto.stage, dto.message);
      await this.mirrorGatewayPreflightProgress(jobId);
      return this.summary(current as JobRow);
    }
    const current = await this.prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } });
    await this.mirrorDeploymentProgress(jobId, dto.stage, dto.message);
    await this.mirrorGatewayPreflightProgress(jobId);
    return this.summary(current as JobRow);
  }

  async complete(
    authorization: string | undefined,
    jobId: string,
    dto: AgentJobCompleteDto,
  ): Promise<AgentJobSummary> {
    const agent = await this.agents.authenticateCredential(authorization);
    const now = new Date();
    const leaseTokenHash = hashToken(dto.leaseToken);
    const completed = await this.prisma.agentJob.updateMany({
      where: this.activeLeaseWhere(agent, jobId, dto.leaseToken, now),
      data: {
        status: dto.status,
        progressPercent: dto.status === 'succeeded' ? 100 : undefined,
        progressStage: dto.status,
        message: dto.message,
        resultCode: dto.resultCode ?? null,
        result: dto.result
          ? {
              state: dto.result.state,
              ...(dto.result.revision ? { revision: dto.result.revision } : {}),
              ...(dto.result.hostPort ? { hostPort: dto.result.hostPort } : {}),
              ...(dto.result.workloadSlot ? { workloadSlot: dto.result.workloadSlot } : {}),
            }
          : Prisma.DbNull,
        leaseExpiresAt: null,
        finishedAt: now,
      },
    });
    if (completed.count !== 1) {
      const current = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
      if (
        !current ||
        current.targetId !== agent.targetId ||
        current.leaseTokenHash !== leaseTokenHash ||
        current.status !== dto.status ||
        current.message !== dto.message ||
        current.resultCode !== (dto.resultCode ?? null)
        || !this.sameResult(current.result, dto.result)
      ) {
        throw this.lostLease();
      }
      await this.reconcileGatewayPreflight(jobId);
      await this.reconcileGatewayRoute(jobId);
      await this.reconcileTerminalJob(jobId);
      return this.summary(current as JobRow);
    }
    await this.reconcileGatewayPreflight(jobId);
    await this.reconcileGatewayRoute(jobId);
    await this.reconcileTerminalJob(jobId);
    return this.summary(await this.prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } }) as JobRow);
  }

  private async mirrorDeploymentProgress(
    jobId: string,
    stage: string,
    message: string,
  ): Promise<void> {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      select: { deploymentOperationId: true },
    });
    if (!job?.deploymentOperationId) return;
    const phase: ActiveDeploymentPhase = stage === 'verifying'
      ? 'verifying'
      : stage === 'working'
        ? 'running'
        : 'assigned';
    await this.prisma.$transaction([
      this.prisma.deploymentOperation.updateMany({
        where: { id: job.deploymentOperationId, status: 'running' },
        data: { message },
      }),
      this.prisma.deploymentOperation.updateMany({
        where: {
          id: job.deploymentOperationId,
          status: 'running',
          finishedAt: null,
          phase: { in: activeDeploymentPhasePredecessors(phase) },
        },
        data: { phase },
      }),
      this.prisma.environment.updateMany({
        where: { activeOperationId: job.deploymentOperationId },
        data: { statusReason: message },
      }),
    ]);
  }

  private async advanceDeploymentPhase(
    operationId: string | null,
    phase: ActiveDeploymentPhase,
    message: string,
  ): Promise<void> {
    if (!operationId) return;
    await this.prisma.deploymentOperation.updateMany({
      where: {
        id: operationId,
        status: 'running',
        finishedAt: null,
        phase: { in: activeDeploymentPhasePredecessors(phase) },
      },
      data: { phase, message },
    });
  }

  private async mirrorGatewayPreflightProgress(jobId: string): Promise<void> {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      select: { id: true, targetId: true, kind: true },
    });
    if (job?.kind !== 'gateway-preflight') return;
    await this.prisma.target.updateMany({
      where: { id: job.targetId, gatewayPreflightJobId: job.id },
      data: { gatewayPreflightStatus: 'running' },
    });
  }

  private async reconcileGatewayPreflight(jobId: string): Promise<void> {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        targetId: true,
        kind: true,
        status: true,
        message: true,
        finishedAt: true,
      },
    });
    if (job?.kind !== 'gateway-preflight' || !['succeeded', 'failed'].includes(job.status)) return;
    await this.prisma.target.updateMany({
      where: { id: job.targetId, gatewayPreflightJobId: job.id },
      data: {
        gatewayPreflightStatus: job.status === 'succeeded' ? 'passed' : 'failed',
        gatewayPreflightAt: job.finishedAt ?? new Date(),
        gatewayPreflightError: job.status === 'failed'
          ? (job.message ?? 'Gateway preflight failed')
          : null,
      },
    });
  }

  private async reconcileGatewayRoute(jobId: string): Promise<void> {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        kind: true,
        status: true,
        message: true,
        finishedAt: true,
        gatewayRouteId: true,
        payload: true,
      },
    });
    if (
      job?.kind !== 'gateway-route'
      || !job.gatewayRouteId
      || !['succeeded', 'failed'].includes(job.status)
    ) return;
    const payload = this.objectRecord(job.payload);
    const generation = payload?.generation;
    const desiredState = payload?.desiredState;
    const revision = payload?.revision;
    if (
      typeof generation !== 'number'
      || !Number.isInteger(generation)
      || generation < 1
      || !['active', 'stopped', 'absent'].includes(String(desiredState))
      || (revision !== null && typeof revision !== 'string')
    ) return;
    const now = job.finishedAt ?? new Date();
    if (job.status === 'succeeded') {
      await this.prisma.gatewayRoute.updateMany({
        where: {
          id: job.gatewayRouteId,
          generation,
          reconcileJobId: job.id,
        },
        data: {
          observedState: desiredState as string,
          observedRevision: desiredState === 'absent' ? null : revision as string,
          observedGeneration: generation,
          reconcileJobId: null,
          lastError: null,
          reconciledAt: now,
        },
      });
      return;
    }
    await this.prisma.gatewayRoute.updateMany({
      where: {
        id: job.gatewayRouteId,
        generation,
        reconcileJobId: job.id,
      },
      data: {
        reconcileJobId: null,
        lastError: (job.message ?? 'Gateway route reconcile failed').slice(0, 500),
        reconciledAt: now,
      },
    });
  }

  private async reconcileTerminalJob(jobId: string): Promise<void> {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      include: {
        deploymentOperation: {
          include: {
            environment: {
              include: {
                target: { select: { publicUrl: true, routingMode: true } },
                gatewayRoute: true,
              },
            },
          },
        },
      },
    });
    const operation = job?.deploymentOperation;
    if (!job || !operation || !['succeeded', 'failed'].includes(job.status)) return;
    if (operation.status !== 'running' || operation.finishedAt) return;
    if (operation.environment.target?.routingMode === 'managed-gateway') {
      await this.reconcileManagedTerminalJob(job, operation);
      return;
    }
    const result = this.jobResult(job.result);
    const successfulDeploy =
      job.kind === 'deploy'
      && job.status === 'succeeded'
      && result?.state === 'running'
      && result.revision === operation.version
      && result.hostPort !== undefined;
    const successfulStart =
      job.kind === 'start'
      && job.status === 'succeeded'
      && result?.state === 'running'
      && result.revision === operation.version
      && result.hostPort !== undefined;
    const successfulStop =
      job.kind === 'stop'
      && job.status === 'succeeded'
      && result?.state === 'stopped'
      && result.revision === operation.version;
    const successfulRemove =
      job.kind === 'remove'
      && job.status === 'succeeded'
      && result?.state === 'missing';
    const now = new Date();
    if (successfulDeploy) {
      const url = this.workloadUrl(operation.environment.target?.publicUrl, result.hostPort!);
      await this.prisma.$transaction([
        this.prisma.environment.updateMany({
          where: { id: operation.environmentId, activeOperationId: operation.id },
          data: {
            status: 'running',
            version: operation.version,
            buildArtifactId: operation.buildArtifactId,
            url,
            statusReason: null,
            deploymentRequired: false,
            activeOperationId: null,
          },
        }),
        this.prisma.deploymentOperation.updateMany({
          where: { id: operation.id, status: 'running', finishedAt: null },
          data: {
            status: 'succeeded',
            phase: 'succeeded',
            message: job.message,
            finishedAt: now,
          },
        }),
      ]);
      return;
    }
    if (successfulStart) {
      const url = this.workloadUrl(operation.environment.target?.publicUrl, result.hostPort!);
      await this.finishLifecycle(operation, job.message, {
        status: 'running',
        url,
        statusReason: null,
      });
      return;
    }
    if (successfulStop) {
      await this.finishLifecycle(operation, job.message, {
        status: 'stopped',
        statusReason: null,
      });
      return;
    }
    if (successfulRemove) {
      await this.finishLifecycle(operation, job.message, {
        status: 'empty',
        version: null,
        buildArtifactId: null,
        url: null,
        statusReason: null,
        allocatedPort: null,
        deploymentRequired: false,
      });
      return;
    }
    const reason = job.status === 'failed'
      ? (job.message || 'Agent deployment failed')
      : 'Agent returned an invalid deployment result';
    await this.prisma.$transaction([
      this.prisma.environment.updateMany({
        where: { id: operation.environmentId, activeOperationId: operation.id },
        data: {
          status: 'failed',
          statusReason: reason,
          deploymentRequired: true,
          activeOperationId: null,
        },
      }),
      this.prisma.deploymentOperation.updateMany({
        where: { id: operation.id, status: 'running', finishedAt: null },
        data: {
          status: 'failed',
          phase: terminalDeploymentPhase('failed', reason),
          message: reason,
          finishedAt: now,
        },
      }),
    ]);
  }

  private async reconcileManagedTerminalJob(
    job: {
      id: string;
      kind: string;
      status: string;
      operationStep: number | null;
      message: string | null;
      payload: unknown;
      result: unknown;
    },
    operation: {
      id: string;
      environmentId: string;
      buildArtifactId: string | null;
      kind: string;
      version: string | null;
      environment: {
        version: string | null;
        url: string | null;
        gatewayRoute: {
          publicUrl: string;
          observedState: string;
          observedRevision: string | null;
          observedGeneration: number;
        } | null;
      };
    },
  ): Promise<void> {
    if (job.status === 'failed') {
      const reason = job.message || 'Agent operation failed';
      const routeRollback = job.kind === 'gateway-route'
        ? reason.includes('previous serving route restored')
          ? 'serving'
          : reason.includes('previous gateway state restored')
            ? 'stopped'
            : 'unknown'
        : undefined;
      await this.failManagedOperation(operation, reason, routeRollback);
      return;
    }
    if (![1, 2].includes(job.operationStep ?? 0)) {
      await this.failManagedOperation(operation, 'Agent returned an invalid managed gateway workflow step');
      return;
    }

    if (job.operationStep === 1 && ['stop', 'remove'].includes(operation.kind)) {
      if (job.kind !== 'gateway-route') {
        await this.failManagedOperation(operation, 'Managed teardown did not remove its gateway route first');
        return;
      }
      const next = await this.prisma.agentJob.updateMany({
        where: {
          deploymentOperationId: operation.id,
          operationStep: 2,
          status: 'blocked',
        },
        data: {
          status: 'queued',
          progressStage: 'queued',
          message: 'Gateway route updated; waiting for Agent workload cleanup',
        },
      });
      if (next.count === 0) {
        const existing = await this.prisma.agentJob.findFirst({
          where: { deploymentOperationId: operation.id, operationStep: 2 },
          select: { id: true, status: true },
        });
        if (!existing || !['queued', 'leased', 'succeeded'].includes(existing.status)) {
          await this.failManagedOperation(operation, 'Managed teardown workload step is missing');
          return;
        }
        if (existing.status === 'succeeded') await this.reconcileTerminalJob(existing.id);
        return;
      }
      await this.publishManagedProgress(
        operation,
        'Gateway route updated; waiting for Agent workload cleanup',
      );
      return;
    }

    if (job.operationStep === 1) {
      const result = this.jobResult(job.result);
      const payload = this.objectRecord(job.payload);
      const projectSlug = payload?.projectSlug;
      const containerPort = payload?.containerPort;
      const healthPath = payload?.healthPath;
      if (
        !['deploy', 'start'].includes(job.kind)
        || result?.state !== 'running'
        || !operation.version
        || result.revision !== operation.version
        || typeof projectSlug !== 'string'
        || !Number.isInteger(containerPort)
        || typeof healthPath !== 'string'
        || !result.workloadSlot
      ) {
        await this.failManagedOperation(operation, 'Agent returned an invalid managed workload result');
        return;
      }
      try {
        const routeJob = await this.gatewayRoutes.queueReconcile(operation.environmentId, {
          requestId: operation.id,
          desiredState: 'active',
          revision: operation.version,
          projectSlug,
          containerPort: Number(containerPort),
          healthPath,
          workloadSlot: result.workloadSlot,
          activation: operation.kind === 'start' ? 'start' : 'deploy',
          deploymentOperationId: operation.id,
          operationStep: 2,
        });
        await this.publishManagedProgress(operation, 'Workload is ready; waiting for gateway route');
        if (routeJob.status === 'succeeded') {
          await this.reconcileGatewayRoute(routeJob.jobId);
          await this.reconcileTerminalJob(routeJob.jobId);
        }
      } catch (error) {
        await this.failManagedOperation(
          operation,
          error instanceof Error ? error.message : 'Gateway route could not be queued',
        );
      }
      return;
    }

    if (['stop', 'remove'].includes(operation.kind)) {
      const result = this.jobResult(job.result);
      const successfulStop =
        operation.kind === 'stop'
        && job.kind === 'stop'
        && result?.state === 'stopped'
        && result.revision === operation.version;
      const successfulRemove =
        operation.kind === 'remove'
        && job.kind === 'remove'
        && result?.state === 'missing';
      if (successfulStop) {
        await this.finishLifecycle(operation, job.message, {
          status: 'stopped',
          statusReason: null,
        });
        return;
      }
      if (successfulRemove) {
        await this.finishLifecycle(operation, job.message, {
          status: 'empty',
          version: null,
          buildArtifactId: null,
          url: null,
          statusReason: null,
          allocatedPort: null,
          deploymentRequired: false,
        });
        return;
      }
      await this.failManagedOperation(operation, 'Agent returned an invalid managed teardown result');
      return;
    }

    const route = operation.environment.gatewayRoute;
    const payload = this.objectRecord(job.payload);
    const generation = payload?.generation;
    if (
      job.kind !== 'gateway-route'
      || !route
      || route.observedState !== 'active'
      || route.observedRevision !== operation.version
      || route.observedGeneration !== generation
    ) {
      await this.failManagedOperation(
        operation,
        'Gateway did not publish the requested workload revision',
        'unknown',
      );
      return;
    }
    if (operation.kind === 'start') {
      await this.finishLifecycle(operation, job.message, {
        status: 'running',
        url: route.publicUrl,
        statusReason: null,
      });
      return;
    }
    await this.prisma.$transaction([
      this.prisma.environment.updateMany({
        where: { id: operation.environmentId, activeOperationId: operation.id },
        data: {
          status: 'running',
          version: operation.version,
          buildArtifactId: operation.buildArtifactId,
          url: route.publicUrl,
          statusReason: null,
          deploymentRequired: false,
          activeOperationId: null,
        },
      }),
      this.prisma.deploymentOperation.updateMany({
        where: { id: operation.id, status: 'running', finishedAt: null },
        data: {
          status: 'succeeded',
          phase: 'succeeded',
          message: job.message,
          finishedAt: new Date(),
        },
      }),
    ]);
  }

  private async publishManagedProgress(
    operation: { id: string; environmentId: string },
    message: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.deploymentOperation.updateMany({
        where: { id: operation.id, status: 'running', finishedAt: null },
        data: { phase: 'verifying', message },
      }),
      this.prisma.environment.updateMany({
        where: { id: operation.environmentId, activeOperationId: operation.id },
        data: { statusReason: message },
      }),
    ]);
  }

  private async failManagedOperation(
    operation: {
      id: string;
      environmentId: string;
      kind: string;
      version: string | null;
      environment: {
        version: string | null;
        url: string | null;
        gatewayRoute: {
          publicUrl: string;
          observedState: string;
          observedRevision: string | null;
          observedGeneration: number;
        } | null;
      };
    },
    reason: string,
    routeRollback?: 'serving' | 'stopped' | 'unknown',
  ): Promise<void> {
    const message = reason.slice(0, 500);
    const now = new Date();
    const route = operation.environment.gatewayRoute;
    const previousStillServing = Boolean(
      route
      && route.observedState === 'active'
      && route.observedRevision
      && route.observedRevision === operation.environment.version
      && (routeRollback === undefined || routeRollback === 'serving')
    );
    const previousStillStopped = Boolean(
      route
      && operation.kind === 'start'
      && route.observedState === 'stopped'
      && route.observedRevision
      && route.observedRevision === operation.environment.version
      && (routeRollback === undefined || routeRollback === 'stopped')
    );
    const preservedMessage = previousStillServing
      ? `Deployment failed; revision ${route!.observedRevision!.slice(0, 12)} remains online. ${message}`.slice(0, 500)
      : previousStillStopped
        ? `Start failed; the previous revision remains stopped. ${message}`.slice(0, 500)
        : message;
    await this.prisma.$transaction([
      this.prisma.agentJob.updateMany({
        where: {
          deploymentOperationId: operation.id,
          status: { in: ['blocked', 'queued'] },
        },
        data: {
          status: 'cancelled',
          progressStage: 'cancelled',
          message: 'Cancelled because another workflow step failed',
          finishedAt: now,
        },
      }),
      this.prisma.environment.updateMany({
        where: { id: operation.environmentId, activeOperationId: operation.id },
        data: previousStillServing
          ? {
              status: 'running',
              url: route!.publicUrl,
              statusReason: preservedMessage,
              deploymentRequired: !['start', 'stop', 'remove'].includes(operation.kind),
              activeOperationId: null,
            }
          : previousStillStopped
            ? {
                status: 'stopped',
                url: route!.publicUrl,
                statusReason: preservedMessage,
                deploymentRequired: false,
                activeOperationId: null,
              }
            : {
                status: 'failed',
                statusReason: message,
                deploymentRequired: true,
                activeOperationId: null,
              },
      }),
      this.prisma.deploymentOperation.updateMany({
        where: { id: operation.id, status: 'running', finishedAt: null },
        data: {
          status: 'failed',
          phase: terminalDeploymentPhase('failed', preservedMessage),
          message: preservedMessage,
          finishedAt: now,
        },
      }),
    ]);
  }

  private async finishLifecycle(
    operation: {
      id: string;
      environmentId: string;
    },
    message: string | null,
    environmentData: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.environment.updateMany({
        where: { id: operation.environmentId, activeOperationId: operation.id },
        data: { ...environmentData, activeOperationId: null },
      }),
      this.prisma.deploymentOperation.updateMany({
        where: { id: operation.id, status: 'running', finishedAt: null },
        data: { status: 'succeeded', phase: 'succeeded', message, finishedAt: new Date() },
      }),
    ]);
  }

  private jobResult(value: unknown): {
    state: 'running' | 'stopped' | 'missing';
    revision?: string;
    hostPort?: number;
    workloadSlot?: string;
  } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    if (!['running', 'stopped', 'missing'].includes(String(input.state))) return null;
    if (input.revision !== undefined && typeof input.revision !== 'string') return null;
    if (
      input.hostPort !== undefined
      && (!Number.isInteger(input.hostPort) || Number(input.hostPort) < 1 || Number(input.hostPort) > 65_535)
    ) return null;
    if (input.workloadSlot !== undefined && !/^[a-f0-9]{12}$/.test(String(input.workloadSlot))) return null;
    return {
      state: input.state as 'running' | 'stopped' | 'missing',
      ...(typeof input.revision === 'string' ? { revision: input.revision } : {}),
      ...(typeof input.hostPort === 'number' ? { hostPort: input.hostPort } : {}),
      ...(typeof input.workloadSlot === 'string' ? { workloadSlot: input.workloadSlot } : {}),
    };
  }

  private workloadUrl(publicUrl: string | null | undefined, hostPort: number): string {
    if (!publicUrl) throw new BadRequestException('Agent target has no public URL');
    const url = new URL(publicUrl);
    url.port = String(hostPort);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  private sameResult(stored: unknown, received: AgentJobCompleteDto['result']): boolean {
    if (!received) return stored == null;
    const parsed = this.jobResult(stored);
    return Boolean(
      parsed
      && parsed.state === received.state
      && parsed.revision === received.revision
      && parsed.hostPort === received.hostPort
      && parsed.workloadSlot === received.workloadSlot
    );
  }

  private activeAgentFilter(agent: AuthenticatedAgent) {
    return {
      target: {
        agent: {
          is: {
            id: agent.id,
            credentialHash: agent.credentialHash,
            disabledAt: null,
          },
        },
      },
    };
  }

  private async deliveryForLease(
    agent: AuthenticatedAgent,
    jobId: string,
    leaseToken: string,
  ): Promise<AgentJobDelivery> {
    const binding = await this.deliveryBinding(agent, jobId, leaseToken);
    if (!binding) throw this.lostLease();
    const artifact = this.assertDeliveryBinding(binding);
    const payload = this.objectRecord(binding.payload);
    const queuedFingerprint = typeof payload?.configFingerprint === 'string'
      ? payload.configFingerprint
      : '';
    const currentFingerprint = agentConfigFingerprint(
      binding.deploymentOperation!.environment.configVars,
    );
    if (!queuedFingerprint || queuedFingerprint !== currentFingerprint) {
      throw new BadRequestException(
        'Application config changed after this deployment was queued; start a new deployment',
      );
    }
    const sizeBytes = this.safeSize(artifact.sizeBytes);
    const object = await this.artifactStore.head(artifact.storageRef);
    if (!object || object.sizeBytes !== sizeBytes) {
      throw new NotFoundException('Verified build artifact is no longer available');
    }
    const envVars: Record<string, string> = {};
    for (const variable of binding.deploymentOperation!.environment.configVars) {
      envVars[variable.key] = variable.isSecret
        ? decryptSecret(variable.value)
        : variable.value;
    }
    return {
      artifact: {
        path: `/api/agent/jobs/${encodeURIComponent(jobId)}/artifact`,
        sha256: this.normalizedDigest(artifact.digest),
        sizeBytes,
      },
      envVars,
    };
  }

  private deliveryBinding(
    agent: AuthenticatedAgent,
    jobId: string,
    leaseToken: string,
  ) {
    return this.prisma.agentJob.findFirst({
      where: this.activeLeaseWhere(agent, jobId, leaseToken, new Date()),
      select: {
        kind: true,
        payload: true,
        targetId: true,
        allocationId: true,
        deploymentOperation: {
          select: {
            buildArtifact: {
              select: {
                digest: true,
                sizeBytes: true,
                status: true,
                storageKind: true,
                storageRef: true,
              },
            },
            environment: {
              select: {
                targetId: true,
                allocationId: true,
                configVars: {
                  orderBy: { key: 'asc' },
                  select: { key: true, value: true, isSecret: true },
                },
              },
            },
          },
        },
      },
    });
  }

  private assertDeliveryBinding(binding: Awaited<ReturnType<AgentJobsService['deliveryBinding']>>) {
    const operation = binding?.deploymentOperation;
    const artifact = operation?.buildArtifact;
    if (
      !binding
      || !operation
      || !artifact?.storageRef
      || artifact.status !== 'available'
      || artifact.storageKind !== 'object-store'
      || operation.environment.targetId !== binding.targetId
      || operation.environment.allocationId !== binding.allocationId
    ) {
      throw new BadRequestException('Agent job is not bound to an available deployment artifact');
    }
    return artifact as typeof artifact & { storageRef: string };
  }

  private normalizedDigest(value: string): string {
    const digest = value.toLowerCase().replace(/^sha256:/, '');
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new BadRequestException('Build artifact has an invalid SHA-256 digest');
    }
    return digest;
  }

  private objectRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private async failInvalidDelivery(
    agent: AuthenticatedAgent,
    jobId: string,
    leaseToken: string,
    message: string,
  ): Promise<void> {
    const now = new Date();
    const failed = await this.prisma.agentJob.updateMany({
      where: this.activeLeaseWhere(agent, jobId, leaseToken, now),
      data: {
        status: 'failed',
        progressStage: 'failed',
        message: message.slice(0, 500),
        resultCode: 'delivery_invalid',
        result: Prisma.DbNull,
        leaseExpiresAt: null,
        finishedAt: now,
      },
    });
    if (failed.count === 1) await this.reconcileTerminalJob(jobId);
  }

  private safeSize(value: bigint): number {
    const size = Number(value);
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new BadRequestException('Build artifact has an invalid size');
    }
    return size;
  }

  private activeLeaseWhere(
    agent: AuthenticatedAgent,
    jobId: string,
    leaseToken: string,
    now: Date,
  ) {
    return {
      id: jobId,
      targetId: agent.targetId,
      status: 'leased',
      leasedByAgentId: agent.id,
      leaseTokenHash: hashToken(leaseToken),
      leaseExpiresAt: { gt: now },
      ...this.activeAgentFilter(agent),
    };
  }

  private lostLease(): ConflictException {
    return new ConflictException('Agent job lease is no longer valid');
  }

  private supportsLifecycle(version: string | null): boolean {
    return agentVersionAtLeast(version, MIN_LIFECYCLE_AGENT_VERSION);
  }

  private summary(row: JobRow): AgentJobSummary {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      attempt: row.attempt,
      progressSequence: row.progressSequence,
      progressPercent: row.progressPercent,
      progressStage: row.progressStage,
      message: row.message,
      resultCode: row.resultCode,
      createdAt: row.createdAt.toISOString(),
      leasedAt: row.leasedAt?.toISOString() ?? null,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
