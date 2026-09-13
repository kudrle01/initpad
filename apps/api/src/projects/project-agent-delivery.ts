import { BadRequestException } from '@nestjs/common';
import { agentConfigFingerprint } from '../agents/agent-config-fingerprint';
import {
  agentVersionAtLeast,
  MIN_GATEWAY_ROUTE_AGENT_VERSION,
  MIN_PROJECT_AGENT_VERSION,
  supportsProjectAgent,
} from '../agents/agent-version';
import { ArtifactStore } from '../artifacts/artifact-store';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayRoutesService } from '../targets/gateway-routes.service';

export interface AgentDeploymentIntent {
  projectSlug: string;
  imageRef: string;
  containerPort: number;
  healthPath: string;
}

export type AgentProjectAction = 'start' | 'stop' | 'remove';

/** Creates the durable, non-secret handoff for one project deployment. */
export class ProjectAgentDelivery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactStore: ArtifactStore,
    private readonly gatewayRoutes = new GatewayRoutesService(prisma),
  ) {}

  async queueDeployment(operationId: string, intent: AgentDeploymentIntent): Promise<void> {
    if (!this.artifactStore.durable) {
      throw new BadRequestException(
        'Agent deployment requires durable artifact storage; configure the S3/MinIO artifact bucket',
      );
    }
    const operation = await this.loadOperation(operationId);
    const { environment, target, allocation } = this.assertAgentBinding(operation);
    const artifact = operation.buildArtifact;
    if (
      !artifact ||
      artifact.projectId !== environment.projectId ||
      artifact.status !== 'available' ||
      artifact.storageKind !== 'object-store' ||
      !artifact.storageRef
    ) {
      throw new BadRequestException(
        'Agent deployment requires an available verified build artifact',
      );
    }

    const row = await this.prisma.agentJob.upsert({
      where: { dedupeKey: `deployment:${operation.id}` },
      update: {},
      create: {
        correlationId: operation.correlationId,
        targetId: target.id,
        allocationId: allocation.id,
        deploymentOperationId: operation.id,
        operationStep: 1,
        dedupeKey: `deployment:${operation.id}`,
        kind: 'deploy',
        protocolVersion: 1,
        payload: {
          allocationId: allocation.id,
          namespace: allocation.namespace,
          projectSlug: intent.projectSlug,
          environment: environment.name,
          revision: operation.version,
          imageRef: intent.imageRef,
          containerPort: intent.containerPort,
          healthPath: intent.healthPath,
          routingMode: target.routingMode ?? 'direct-port',
          configFingerprint: agentConfigFingerprint(environment.configVars),
          cpuLimitMillicores: allocation.cpuLimitMillicores,
          memoryLimitMb: allocation.memoryLimitMb,
          pidsLimit: allocation.pidsLimit,
        },
        status: 'queued',
        progressStage: 'queued',
        message: 'Waiting for Agent',
      },
    });
    if (!['queued', 'leased'].includes(row.status)) return;
    await this.publishQueued(operation.id, environment.id, allocation.id, false);
  }

  async queueLifecycle(
    operationId: string,
    kind: AgentProjectAction,
    intent: AgentDeploymentIntent,
  ): Promise<void> {
    const operation = await this.loadOperation(operationId);
    const { environment, target, allocation } = this.assertAgentBinding(operation);
    const managedGateway = target.routingMode === 'managed-gateway';
    const workloadStep = managedGateway && ['stop', 'remove'].includes(kind) ? 2 : 1;
    const initialStatus = workloadStep === 2 ? 'blocked' : 'queued';
    const row = await this.prisma.agentJob.upsert({
      where: { dedupeKey: `${kind}:${operation.id}` },
      update: {},
      create: {
        correlationId: operation.correlationId,
        targetId: target.id,
        allocationId: allocation.id,
        deploymentOperationId: operation.id,
        operationStep: workloadStep,
        dedupeKey: `${kind}:${operation.id}`,
        kind,
        protocolVersion: 1,
        payload: {
          allocationId: allocation.id,
          namespace: allocation.namespace,
          projectSlug: intent.projectSlug,
          environment: environment.name,
          revision: operation.version,
          imageRef: intent.imageRef,
          containerPort: intent.containerPort,
          healthPath: intent.healthPath,
          routingMode: target.routingMode ?? 'direct-port',
          configFingerprint: agentConfigFingerprint(environment.configVars),
          cpuLimitMillicores: allocation.cpuLimitMillicores,
          memoryLimitMb: allocation.memoryLimitMb,
          pidsLimit: allocation.pidsLimit,
        },
        status: initialStatus,
        progressStage: initialStatus,
        message: initialStatus === 'blocked' ? 'Waiting for gateway route' : 'Waiting for Agent',
      },
    });
    if (managedGateway && ['stop', 'remove'].includes(kind)) {
      if (row.status !== 'blocked') return;
      try {
        await this.gatewayRoutes.queueReconcile(environment.id, {
          requestId: operation.id,
          desiredState: kind === 'stop' ? 'stopped' : 'absent',
          revision: kind === 'stop' ? operation.version : null,
          projectSlug: intent.projectSlug,
          containerPort: intent.containerPort,
          healthPath: intent.healthPath,
          workloadSlot: null,
          activation: null,
          deploymentOperationId: operation.id,
          operationStep: 1,
          correlationId: operation.correlationId,
        });
      } catch (error) {
        await this.prisma.agentJob.updateMany({
          where: { id: row.id, status: 'blocked' },
          data: {
            status: 'cancelled',
            progressStage: 'cancelled',
            message: 'Gateway route could not be queued',
            finishedAt: new Date(),
          },
        });
        throw error;
      }
    } else if (!['queued', 'leased'].includes(row.status)) {
      return;
    }
    await this.publishQueued(operation.id, environment.id, allocation.id, kind === 'remove');
  }

  private async publishQueued(
    operationId: string,
    environmentId: string,
    allocationId: string,
    removing: boolean,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.deploymentOperation.updateMany({
        where: { id: operationId, status: 'running' },
        data: { message: 'Waiting for Agent' },
      }),
      this.prisma.environment.updateMany({
        where: { id: environmentId, activeOperationId: operationId },
        data: {
          status: 'deploying',
          statusReason: 'Waiting for Agent',
          allocationId,
          ...(removing ? { deploymentRequired: false } : {}),
        },
      }),
    ]);
  }

  private async loadOperation(operationId: string) {
    const operation = await this.prisma.deploymentOperation.findUnique({
      where: { id: operationId },
      include: {
        buildArtifact: true,
        environment: {
          include: {
            project: { select: { workspaceId: true } },
            target: { include: { agent: true } },
            allocation: true,
            configVars: {
              orderBy: { key: 'asc' },
              select: { key: true, value: true, isSecret: true },
            },
          },
        },
      },
    });
    if (!operation || operation.status !== 'running' || operation.finishedAt) {
      throw new BadRequestException('Deployment operation is no longer active');
    }
    return operation;
  }

  private assertAgentBinding(
    operation: Awaited<ReturnType<ProjectAgentDelivery['loadOperation']>>,
  ) {
    const environment = operation.environment;
    const target = environment.target;
    const allocation = environment.allocation;
    if (
      !target ||
      target.kind !== 'docker' ||
      target.scope !== 'user' ||
      target.workspaceId !== environment.project.workspaceId ||
      !allocation ||
      allocation.targetId !== target.id ||
      allocation.workspaceId !== environment.project.workspaceId
    ) {
      throw new BadRequestException('Deployment is not bound to a workspace Agent allocation');
    }
    if (!target.agent?.credentialHash || target.agent.disabledAt) {
      throw new BadRequestException('Enroll the target Agent before deploying to it');
    }
    if (!supportsProjectAgent(target.agent.version)) {
      throw new BadRequestException(
        `Project delivery requires InitPad Agent ${MIN_PROJECT_AGENT_VERSION.join('.')} or newer`,
      );
    }
    if (target.routingMode === 'managed-gateway') {
      if (
        target.gatewayAdapter !== 'caddy' ||
        target.gatewayPreflightStatus !== 'passed' ||
        !target.publicUrl
      ) {
        throw new BadRequestException(
          'Managed gateway deployment requires a successful Caddy gateway preflight',
        );
      }
      if (!agentVersionAtLeast(target.agent.version, MIN_GATEWAY_ROUTE_AGENT_VERSION)) {
        throw new BadRequestException(
          `Managed gateway delivery requires InitPad Agent ${MIN_GATEWAY_ROUTE_AGENT_VERSION.join('.')} or newer`,
        );
      }
    }
    return { environment, target, allocation };
  }
}
