import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Readable } from 'stream';
import { ARTIFACT_STORE, type ArtifactStore } from '../artifacts/artifact-store';
import { decryptSecret } from '../common/secret';
import { generateToken, hashToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService, type AuthenticatedAgent } from './agents.service';
import {
  AgentJobCompleteDto,
  AgentJobProgressDto,
  CreateAgentLifecycleTestDto,
  CreateAgentProbeJobDto,
} from './dto/agent-job.dto';

const LEASE_MS = 30_000;
const NEXT_POLL_SECONDS = 2;
const LEASE_PREFIX = 'initpad_lease_';
const MIN_LIFECYCLE_AGENT_VERSION = [0, 3, 0] as const;
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
export class AgentJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    @Inject(ARTIFACT_STORE) private readonly artifactStore: ArtifactStore,
  ) {}

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
          finishedAt: null,
        },
      });
      if (claimed.count !== 1) continue;
      const row = await this.prisma.agentJob.findUniqueOrThrow({ where: { id: candidate.id } });
      const delivery = ['deploy', 'rollback'].includes(row.kind)
        ? await this.deliveryForLease(agent, row.id, leaseToken)
        : undefined;
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
      return this.summary(current as JobRow);
    }
    return this.summary(await this.prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } }) as JobRow);
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
      ) {
        throw this.lostLease();
      }
      return this.summary(current as JobRow);
    }
    return this.summary(await this.prisma.agentJob.findUniqueOrThrow({ where: { id: jobId } }) as JobRow);
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
    if (!version) return false;
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) return false;
    const actual = match.slice(1).map(Number);
    for (let index = 0; index < MIN_LIFECYCLE_AGENT_VERSION.length; index += 1) {
      if (actual[index] !== MIN_LIFECYCLE_AGENT_VERSION[index]) {
        return actual[index] > MIN_LIFECYCLE_AGENT_VERSION[index];
      }
    }
    return true;
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
