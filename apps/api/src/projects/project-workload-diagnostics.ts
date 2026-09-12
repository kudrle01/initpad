import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { agentHeartbeatIsFresh } from '../agents/agents.service';
import {
  agentVersionAtLeast,
  MIN_WORKLOAD_DIAGNOSTICS_AGENT_VERSION,
} from '../agents/agent-version';
import {
  EnvName,
  WorkloadDiagnostic,
  WorkloadDiagnosticStatus,
  WorkloadHealth,
} from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';
import { repositoryRef } from '../scm/scm-provider';
import { TemplatesService } from '../templates/templates.service';
import { deploymentSlug } from './project-deployment-identity';

const ACTIVE_DIAGNOSTICS = ['queued', 'running'];

/** Maintains one bounded, explicitly requested runtime snapshot per environment. */
export class ProjectWorkloadDiagnostics {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
  ) {}

  async get(projectId: string, environmentName: EnvName): Promise<WorkloadDiagnostic | null> {
    const environment = await this.loadEnvironment(projectId, environmentName);
    const diagnostic = environment.diagnostic;
    if (!diagnostic) return null;
    return {
      environment: environmentName,
      target: environment.target?.name ?? environment.provider,
      status: diagnostic.status as WorkloadDiagnosticStatus,
      agentOnline: Boolean(
        environment.target?.agent?.credentialHash &&
        !environment.target.agent.disabledAt &&
        agentHeartbeatIsFresh(environment.target.agent.lastSeenAt),
      ),
      progressPercent: diagnostic.currentJob?.progressPercent ?? 0,
      message: diagnostic.message,
      runtimeState: diagnostic.runtimeState as WorkloadDiagnostic['runtimeState'],
      revision: diagnostic.revision,
      exitCode: diagnostic.exitCode,
      health: diagnostic.health as WorkloadHealth | null,
      logs: diagnostic.logs,
      requestedAt: diagnostic.requestedAt?.toISOString() ?? null,
      observedAt: diagnostic.observedAt?.toISOString() ?? null,
      finishedAt: diagnostic.finishedAt?.toISOString() ?? null,
    };
  }

  async request(
    projectId: string,
    environmentName: EnvName,
    userId: string,
    requestId: string,
  ): Promise<WorkloadDiagnostic> {
    const environment = await this.loadEnvironment(projectId, environmentName);
    const target = environment.target;
    const allocation = environment.allocation;
    const agent = target?.agent;
    if (target?.scope === 'user' && (target.managementState ?? 'active') !== 'active') {
      throw new BadRequestException(
        `Target '${target.name}' is ${target.managementState ?? 'disconnected'}; reconnect it before requesting diagnostics`,
      );
    }
    if (
      environment.provider !== 'docker' ||
      !target ||
      target.kind !== 'docker' ||
      target.scope !== 'user' ||
      target.workspaceId !== environment.project.workspaceId ||
      !allocation ||
      allocation.targetId !== target.id ||
      allocation.workspaceId !== environment.project.workspaceId
    ) {
      throw new BadRequestException(
        'Workload diagnostics are available only for a workspace Agent Docker target',
      );
    }
    if (!agent?.credentialHash || agent.disabledAt) {
      throw new BadRequestException('Enroll the target Agent before requesting diagnostics');
    }
    if (!agentVersionAtLeast(agent.version, MIN_WORKLOAD_DIAGNOSTICS_AGENT_VERSION)) {
      throw new BadRequestException(
        `Workload diagnostics require InitPad Agent ${MIN_WORKLOAD_DIAGNOSTICS_AGENT_VERSION.join('.')} or newer`,
      );
    }
    if (environment.activeOperationId || environment.status === 'deploying') {
      throw new BadRequestException(
        `Environment '${environmentName}' is changing. Wait for its deployment before reading diagnostics.`,
      );
    }
    if (!environment.version || !/^[a-f0-9]{40}$/i.test(environment.version)) {
      throw new BadRequestException(`Environment '${environmentName}' has no immutable workload`);
    }
    if (environment.status === 'empty') {
      throw new BadRequestException(`Environment '${environmentName}' has no workload to inspect`);
    }

    const dedupeKey = `logs:${environment.id}:${requestId}`;
    const existing = await this.prisma.agentJob.findUnique({ where: { dedupeKey } });
    if (existing) return this.existingRequest(projectId, environmentName, existing.id);

    await this.prisma.workloadDiagnostic.upsert({
      where: { environmentId: environment.id },
      update: {},
      create: { environmentId: environment.id },
    });
    const template = this.templates.get(environment.project.templateId);
    const now = new Date();
    try {
      await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.workloadDiagnostic.updateMany({
          where: {
            environmentId: environment.id,
            status: { notIn: ACTIVE_DIAGNOSTICS },
          },
          data: {
            requestedById: userId,
            status: 'queued',
            message: agentHeartbeatIsFresh(agent.lastSeenAt)
              ? 'Waiting for Agent'
              : 'Queued while Agent is offline',
            requestedAt: now,
            finishedAt: null,
          },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(
            `Diagnostics for environment '${environmentName}' are already running`,
          );
        }
        const job = await transaction.agentJob.create({
          data: {
            targetId: target.id,
            allocationId: allocation.id,
            dedupeKey,
            kind: 'logs',
            protocolVersion: 1,
            payload: {
              allocationId: allocation.id,
              namespace: allocation.namespace,
              projectSlug: deploymentSlug(repositoryRef(environment.project)),
              environment: environment.name,
              revision: environment.version,
              containerPort: template.port ?? 8080,
              healthPath: template.healthPath ?? '/health',
              routingMode: target.routingMode ?? 'direct-port',
            },
            status: 'queued',
            progressStage: 'queued',
            message: 'Waiting for Agent',
          },
        });
        await transaction.workloadDiagnostic.update({
          where: { environmentId: environment.id },
          data: { currentJobId: job.id },
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced = await this.prisma.agentJob.findUnique({ where: { dedupeKey } });
      if (!raced) throw error;
      return this.existingRequest(projectId, environmentName, raced.id);
    }
    return (await this.get(projectId, environmentName))!;
  }

  private async existingRequest(
    projectId: string,
    environmentName: EnvName,
    jobId: string,
  ): Promise<WorkloadDiagnostic> {
    const diagnostic = await this.prisma.workloadDiagnostic.findUnique({
      where: { environmentId: await this.environmentId(projectId, environmentName) },
      select: { currentJobId: true },
    });
    if (diagnostic?.currentJobId !== jobId) {
      throw new ConflictException('This diagnostics request was superseded by a newer refresh');
    }
    return (await this.get(projectId, environmentName))!;
  }

  private async environmentId(projectId: string, environmentName: EnvName): Promise<string> {
    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: environmentName } },
      select: { id: true },
    });
    return environment.id;
  }

  private loadEnvironment(projectId: string, environmentName: EnvName) {
    return this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: environmentName } },
      include: {
        project: true,
        target: { include: { agent: true } },
        allocation: true,
        diagnostic: { include: { currentJob: true } },
      },
    });
  }
}
