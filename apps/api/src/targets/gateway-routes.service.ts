import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { managedGatewayOrigin, stableGatewayHostname } from './managed-gateway';

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

/** Owns stable hostname reservation; gateway mutation is added in the next step. */
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
      !target
      || target.routingMode !== 'managed-gateway'
      || !allocation
      || environment.targetId !== target.id
      || environment.allocationId !== allocation.id
      || allocation.targetId !== target.id
      || allocation.workspaceId !== environment.project.workspaceId
      || allocation.status !== 'active'
    ) {
      throw new BadRequestException(
        'Gateway route requires an active managed-gateway target allocation in the same workspace',
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
}
