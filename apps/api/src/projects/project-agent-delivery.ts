import { BadRequestException } from '@nestjs/common';
import { ArtifactStore } from '../artifacts/artifact-store';
import { PrismaService } from '../prisma/prisma.service';

const MIN_PROJECT_AGENT_VERSION = [0, 4, 0] as const;

export interface AgentDeploymentIntent {
  projectSlug: string;
  imageRef: string;
  containerPort: number;
  healthPath: string;
}

/** Creates the durable, non-secret handoff for one project deployment. */
export class ProjectAgentDelivery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactStore: ArtifactStore,
  ) {}

  async queueDeployment(
    operationId: string,
    intent: AgentDeploymentIntent,
  ): Promise<void> {
    if (!this.artifactStore.durable) {
      throw new BadRequestException(
        'Agent deployment requires durable artifact storage; configure the S3/MinIO artifact bucket',
      );
    }
    const operation = await this.prisma.deploymentOperation.findUnique({
      where: { id: operationId },
      include: {
        buildArtifact: true,
        environment: {
          include: {
            project: { select: { workspaceId: true } },
            target: { include: { agent: true } },
            allocation: true,
          },
        },
      },
    });
    if (!operation || operation.status !== 'running' || operation.finishedAt) {
      throw new BadRequestException('Deployment operation is no longer active');
    }
    const environment = operation.environment;
    const target = environment.target;
    const allocation = environment.allocation;
    const artifact = operation.buildArtifact;
    if (
      !target
      || target.kind !== 'docker'
      || target.scope !== 'user'
      || target.workspaceId !== environment.project.workspaceId
      || !allocation
      || allocation.targetId !== target.id
      || allocation.workspaceId !== environment.project.workspaceId
    ) {
      throw new BadRequestException('Deployment is not bound to a workspace Agent allocation');
    }
    if (
      !artifact
      || artifact.projectId !== environment.projectId
      || artifact.status !== 'available'
      || artifact.storageKind !== 'object-store'
      || !artifact.storageRef
    ) {
      throw new BadRequestException('Agent deployment requires an available verified build artifact');
    }
    if (!target.agent?.credentialHash || target.agent.disabledAt) {
      throw new BadRequestException('Enroll the target Agent before deploying to it');
    }
    if (!this.supportsProjectDelivery(target.agent.version)) {
      throw new BadRequestException(
        `Project delivery requires InitPad Agent ${MIN_PROJECT_AGENT_VERSION.join('.')} or newer`,
      );
    }

    const row = await this.prisma.agentJob.upsert({
      where: { dedupeKey: `deployment:${operation.id}` },
      update: {},
      create: {
        targetId: target.id,
        allocationId: allocation.id,
        deploymentOperationId: operation.id,
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
        },
        status: 'queued',
        progressStage: 'queued',
        message: 'Waiting for Agent',
      },
    });
    if (!['queued', 'leased'].includes(row.status)) return;
    await this.prisma.$transaction([
      this.prisma.deploymentOperation.updateMany({
        where: { id: operation.id, status: 'running' },
        data: { message: 'Waiting for Agent' },
      }),
      this.prisma.environment.updateMany({
        where: { id: environment.id, activeOperationId: operation.id },
        data: {
          status: 'deploying',
          statusReason: 'Waiting for Agent',
          allocationId: allocation.id,
        },
      }),
    ]);
  }

  private supportsProjectDelivery(version: string | null): boolean {
    if (!version) return false;
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) return false;
    const actual = match.slice(1).map(Number);
    for (let index = 0; index < MIN_PROJECT_AGENT_VERSION.length; index += 1) {
      if (actual[index] !== MIN_PROJECT_AGENT_VERSION[index]) {
        return actual[index] > MIN_PROJECT_AGENT_VERSION[index];
      }
    }
    return true;
  }
}
