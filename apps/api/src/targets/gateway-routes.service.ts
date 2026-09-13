import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { agentVersionAtLeast, MIN_GATEWAY_ROUTE_AGENT_VERSION } from '../agents/agent-version';
import { PrismaService } from '../prisma/prisma.service';
import { managedGatewayOrigin, stableGatewayHostname } from './managed-gateway';
import { newCorrelationId } from '../common/request-context';

export interface GatewayRouteReservation {
  id: string;
  environmentId: string;
  targetId: string;
  allocationId: string;
  hostname: string;
  publicUrl: string;
  desiredState: string;
  observedState: string;
  generation: number;
}

export interface GatewayRouteReconcileRequest {
  requestId: string;
  desiredState: 'active' | 'stopped' | 'absent';
  revision: string | null;
  projectSlug: string;
  containerPort: number;
  healthPath: string;
  workloadSlot: string | null;
  activation: 'deploy' | 'start' | null;
  /** Internal workflow binding; both values must be supplied together. */
  deploymentOperationId?: string;
  operationStep?: number;
  /** Stable workflow correlation copied from the parent operation when present. */
  correlationId?: string;
}

export interface GatewayRouteReconcileJob {
  routeId: string;
  jobId: string;
  generation: number;
  status: string;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REVISION = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/** Owns stable hostnames and durable, generation-fenced Agent route intents. */
@Injectable()
export class GatewayRoutesService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(environmentId: string): Promise<GatewayRouteReservation> {
    const environment = await this.prisma.environment.findUnique({
      where: { id: environmentId },
      select: {
        id: true,
        name: true,
        targetId: true,
        allocationId: true,
        project: { select: { name: true, workspaceId: true } },
        target: { select: { id: true, routingMode: true, publicUrl: true } },
        allocation: {
          select: {
            id: true,
            targetId: true,
            workspaceId: true,
            publicUrl: true,
            status: true,
          },
        },
      },
    });
    if (!environment) throw new BadRequestException('Gateway route environment does not exist');
    const { target, allocation } = environment;
    if (
      !target ||
      target.routingMode !== 'managed-gateway' ||
      !allocation ||
      environment.targetId !== target.id ||
      environment.allocationId !== allocation.id ||
      allocation.targetId !== target.id ||
      allocation.workspaceId !== environment.project.workspaceId ||
      allocation.status !== 'active'
    ) {
      throw new BadRequestException(
        'Gateway route requires active workspace access to the managed-gateway server',
      );
    }

    const existing = await this.prisma.gatewayRoute.findUnique({
      where: { environmentId },
    });
    if (existing) {
      this.assertSameBinding(existing, target.id, allocation.id);
      return existing;
    }

    const origin = managedGatewayOrigin(target.publicUrl, allocation.publicUrl);
    const hostname = stableGatewayHostname(
      environment.project.name,
      environment.name,
      environment.id,
      origin,
    );
    try {
      return await this.prisma.gatewayRoute.create({
        data: {
          environmentId,
          targetId: target.id,
          allocationId: allocation.id,
          hostname,
          publicUrl: `https://${hostname}`,
        },
      });
    } catch (error) {
      // A concurrent request may have won the unique environment reservation.
      // Reuse only that exact winner; a hostname collision with another
      // environment remains an error and is never silently rebound.
      const winner = await this.prisma.gatewayRoute.findUnique({
        where: { environmentId },
      });
      if (!winner) throw error;
      this.assertSameBinding(winner, target.id, allocation.id);
      return winner;
    }
  }

  async queueReconcile(
    environmentId: string,
    request: GatewayRouteReconcileRequest,
  ): Promise<GatewayRouteReconcileJob> {
    this.validateRequest(request);
    const route = await this.reserve(environmentId);
    const binding = await this.prisma.environment.findUnique({
      where: { id: environmentId },
      select: {
        id: true,
        name: true,
        targetId: true,
        allocationId: true,
        project: { select: { workspaceId: true } },
        target: {
          select: {
            id: true,
            kind: true,
            scope: true,
            routingMode: true,
            gatewayAdapter: true,
            gatewayPreflightStatus: true,
            workspaceId: true,
            agent: {
              select: {
                credentialHash: true,
                disabledAt: true,
                version: true,
              },
            },
          },
        },
        allocation: {
          select: {
            id: true,
            targetId: true,
            workspaceId: true,
            namespace: true,
            status: true,
          },
        },
      },
    });
    const target = binding?.target;
    const allocation = binding?.allocation;
    if (
      !binding ||
      !target ||
      target.id !== route.targetId ||
      binding.targetId !== target.id ||
      target.kind !== 'docker' ||
      target.scope !== 'user' ||
      target.workspaceId !== binding.project.workspaceId ||
      target.routingMode !== 'managed-gateway' ||
      target.gatewayAdapter !== 'caddy' ||
      target.gatewayPreflightStatus !== 'passed' ||
      !allocation ||
      allocation.id !== route.allocationId ||
      binding.allocationId !== allocation.id ||
      allocation.targetId !== target.id ||
      allocation.workspaceId !== binding.project.workspaceId ||
      allocation.status !== 'active'
    ) {
      throw new BadRequestException(
        'Gateway route requires a preflighted managed-gateway Agent allocation',
      );
    }
    if (!target.agent?.credentialHash || target.agent.disabledAt) {
      throw new BadRequestException(
        'Enroll and connect the target Agent before reconciling gateway routes',
      );
    }
    if (!agentVersionAtLeast(target.agent.version, MIN_GATEWAY_ROUTE_AGENT_VERSION)) {
      throw new BadRequestException(
        `Gateway routes require InitPad Agent ${MIN_GATEWAY_ROUTE_AGENT_VERSION.join('.')} or newer`,
      );
    }

    const dedupeKey = `gateway-route:${route.id}:${request.requestId}`;
    const existing = await this.prisma.agentJob.findUnique({ where: { dedupeKey } });
    if (existing) return this.reconcileJob(route.id, existing);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const duplicate = await transaction.agentJob.findUnique({ where: { dedupeKey } });
        if (duplicate) return this.reconcileJob(route.id, duplicate);
        const updatedRoute = await transaction.gatewayRoute.update({
          where: { id: route.id },
          data: {
            generation: { increment: 1 },
            desiredState: request.desiredState,
            desiredRevision: request.revision,
          },
        });
        await transaction.agentJob.updateMany({
          where: { gatewayRouteId: route.id, status: 'queued' },
          data: {
            status: 'cancelled',
            progressStage: 'cancelled',
            message: 'Superseded by a newer gateway route generation',
            finishedAt: new Date(),
          },
        });
        const job = await transaction.agentJob.create({
          data: {
            correlationId: request.correlationId ?? newCorrelationId(),
            targetId: target.id,
            allocationId: allocation.id,
            deploymentOperationId: request.deploymentOperationId,
            operationStep: request.operationStep,
            gatewayRouteId: route.id,
            dedupeKey,
            kind: 'gateway-route',
            protocolVersion: 1,
            payload: {
              adapter: 'caddy',
              routeId: route.id,
              generation: updatedRoute.generation,
              desiredState: request.desiredState,
              hostname: route.hostname,
              allocationId: allocation.id,
              namespace: allocation.namespace,
              projectSlug: request.projectSlug,
              environment: binding.name,
              revision: request.revision,
              containerPort: request.containerPort,
              healthPath: request.healthPath,
              workloadSlot: request.workloadSlot,
              activation: request.activation,
            },
            status: 'queued',
            progressStage: 'queued',
            message: 'Waiting for Agent gateway reconcile',
          },
        });
        await transaction.gatewayRoute.update({
          where: { id: route.id },
          data: { reconcileJobId: job.id },
        });
        return this.reconcileJob(route.id, job, updatedRoute.generation);
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const winner = await this.prisma.agentJob.findUnique({ where: { dedupeKey } });
      if (!winner) throw error;
      return this.reconcileJob(route.id, winner);
    }
  }

  private assertSameBinding(
    route: { targetId: string; allocationId: string },
    targetId: string,
    allocationId: string,
  ): void {
    if (route.targetId !== targetId || route.allocationId !== allocationId) {
      throw new BadRequestException(
        'The stable gateway hostname is still reserved on a different target; remove that route before moving the environment',
      );
    }
  }

  private validateRequest(request: GatewayRouteReconcileRequest): void {
    if (!UUID.test(request.requestId))
      throw new BadRequestException('Gateway route request id is invalid');
    if (request.correlationId !== undefined && !UUID.test(request.correlationId)) {
      throw new BadRequestException('Gateway route correlation id is invalid');
    }
    if (!['active', 'stopped', 'absent'].includes(request.desiredState)) {
      throw new BadRequestException('Gateway route desired state is invalid');
    }
    if (!SAFE_ID.test(request.projectSlug))
      throw new BadRequestException('Gateway route project slug is invalid');
    if (
      !Number.isInteger(request.containerPort) ||
      request.containerPort < 1 ||
      request.containerPort > 65_535
    ) {
      throw new BadRequestException('Gateway route container port is invalid');
    }
    if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,255}$/.test(request.healthPath)) {
      throw new BadRequestException('Gateway route health path is invalid');
    }
    if (request.revision !== null && !REVISION.test(request.revision)) {
      throw new BadRequestException('Gateway route revision is invalid');
    }
    if (request.desiredState !== 'absent' && !request.revision) {
      throw new BadRequestException('Gateway route active or stopped state requires a revision');
    }
    if (request.desiredState === 'absent' && request.revision !== null) {
      throw new BadRequestException('An absent gateway route cannot retain a desired revision');
    }
    if (request.desiredState === 'active') {
      if (!request.workloadSlot || !/^[a-f0-9]{12}$/.test(request.workloadSlot)) {
        throw new BadRequestException('An active gateway route requires a verified workload slot');
      }
      if (!['deploy', 'start'].includes(String(request.activation))) {
        throw new BadRequestException('An active gateway route requires a bounded activation mode');
      }
    } else if (request.workloadSlot !== null || request.activation !== null) {
      throw new BadRequestException('An inactive gateway route cannot activate a workload slot');
    }
    const hasOperation = request.deploymentOperationId !== undefined;
    const hasStep = request.operationStep !== undefined;
    if (hasOperation !== hasStep) {
      throw new BadRequestException('Gateway route workflow binding is incomplete');
    }
    if (hasOperation && !UUID.test(request.deploymentOperationId!)) {
      throw new BadRequestException('Gateway route deployment operation id is invalid');
    }
    if (hasStep && (!Number.isInteger(request.operationStep) || request.operationStep! < 1)) {
      throw new BadRequestException('Gateway route operation step is invalid');
    }
  }

  private reconcileJob(
    routeId: string,
    job: { id: string; status: string; payload: unknown },
    knownGeneration?: number,
  ): GatewayRouteReconcileJob {
    const payload =
      job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>)
        : null;
    const generation = knownGeneration ?? payload?.generation;
    if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1) {
      throw new BadRequestException('Existing gateway route job has an invalid generation');
    }
    return { routeId, jobId: job.id, generation, status: job.status };
  }
}
