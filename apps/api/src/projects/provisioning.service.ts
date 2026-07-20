import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ProvisioningKind = 'create' | 'import';
export type ProvisioningStep = 'validate' | 'repository' | 'ci' | 'done';
export type ProvisioningEffectKind = 'repository' | 'collaborator' | 'secrets' | 'project';

export interface ProvisioningEffectView {
  key: string;
  kind: string;
  status: string;
  metadata: unknown;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
  compensatedAt: string | null;
}

export interface ProvisioningView {
  id: string;
  kind: string;
  status: string;
  step: string;
  message: string | null;
  projectId: string | null;
  projectName: string;
  createdAt: string;
  finishedAt: string | null;
  effects: ProvisioningEffectView[];
}

type EffectRow = {
  key: string;
  kind: string;
  status: string;
  metadata: unknown;
  error: string | null;
  createdAt: Date;
  appliedAt: Date | null;
  compensatedAt: Date | null;
};

type Row = {
  id: string;
  kind: string;
  status: string;
  step: string;
  message: string | null;
  projectId: string | null;
  projectName: string;
  createdAt: Date;
  finishedAt: Date | null;
  effects: EffectRow[];
};

/**
 * Persistent provisioning audit plus a write-ahead effect journal. Planning an
 * effect and moving it to `applying` are deliberately strict: an external
 * mutation must not start if its recovery intent cannot be persisted. Summary
 * step/outcome updates remain best-effort so they never replace the real error.
 */
@Injectable()
export class ProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  async start(workspaceId: string, projectName: string, kind: ProvisioningKind): Promise<string> {
    const op = await this.prisma.provisioningOperation.create({
      data: { workspaceId, projectName, kind, status: 'running', step: 'validate' },
      select: { id: true },
    });
    return op.id;
  }

  async bindProject(id: string, projectId: string): Promise<void> {
    await this.prisma.provisioningOperation.update({ where: { id }, data: { projectId } });
  }

  async planEffect(
    operationId: string,
    key: string,
    kind: ProvisioningEffectKind,
    metadata?: Record<string, string | null>,
  ): Promise<void> {
    await this.prisma.provisioningEffect.create({
      data: { operationId, key, kind, status: 'planned', ...(metadata ? { metadata } : {}) },
    });
  }

  async beginEffect(operationId: string, key: string): Promise<void> {
    await this.transitionEffect(operationId, key, ['planned'], { status: 'applying', error: null });
  }

  async completeEffect(
    operationId: string,
    key: string,
    metadata?: Record<string, string | null>,
  ): Promise<void> {
    await this.transitionEffect(operationId, key, ['applying'], {
      status: 'applied',
      appliedAt: new Date(),
      ...(metadata ? { metadata } : {}),
    });
  }

  async failEffect(operationId: string, key: string, error: string): Promise<void> {
    await this.transitionEffect(operationId, key, ['planned', 'applying'], {
      status: 'failed',
      error: error.slice(0, 500),
    });
  }

  async compensateEffect(operationId: string, key: string): Promise<void> {
    await this.transitionEffect(operationId, key, ['applying', 'applied', 'failed'], {
      status: 'compensated',
      compensatedAt: new Date(),
      error: null,
    });
  }

  async compensationFailed(operationId: string, key: string, error: string): Promise<void> {
    await this.transitionEffect(operationId, key, ['applying', 'applied', 'failed'], {
      status: 'compensation_failed',
      error: error.slice(0, 500),
    });
  }

  private async transitionEffect(
    operationId: string,
    key: string,
    from: string[],
    data: Record<string, unknown>,
  ): Promise<void> {
    const changed = await this.prisma.provisioningEffect.updateMany({
      where: { operationId, key, status: { in: from } },
      data,
    });
    if (changed.count !== 1) {
      throw new Error(`Provisioning effect '${key}' is not in the expected state`);
    }
  }

  async step(id: string, step: ProvisioningStep): Promise<void> {
    await this.prisma.provisioningOperation
      .update({ where: { id }, data: { step } })
      .catch(() => undefined);
  }

  async succeed(id: string, projectId?: string): Promise<void> {
    await this.prisma.provisioningOperation
      .update({
        where: { id },
        data: { status: 'succeeded', step: 'done', finishedAt: new Date(), ...(projectId ? { projectId } : {}) },
      })
      .catch(() => undefined);
  }

  async fail(id: string, message: string): Promise<void> {
    await this.prisma.provisioningOperation
      .update({ where: { id }, data: { status: 'failed', message: message.slice(0, 500), finishedAt: new Date() } })
      .catch(() => undefined);
  }

  async latestForProject(projectId: string): Promise<ProvisioningView | null> {
    const op = await this.prisma.provisioningOperation.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { effects: { orderBy: { createdAt: 'asc' } } },
    });
    return op ? this.toView(op) : null;
  }

  private toView(op: Row): ProvisioningView {
    return {
      id: op.id,
      kind: op.kind,
      status: op.status,
      step: op.step,
      message: op.message,
      projectId: op.projectId,
      projectName: op.projectName,
      createdAt: op.createdAt.toISOString(),
      finishedAt: op.finishedAt ? op.finishedAt.toISOString() : null,
      effects: op.effects.map((effect) => ({
        key: effect.key,
        kind: effect.kind,
        status: effect.status,
        metadata: effect.metadata,
        error: effect.error,
        createdAt: effect.createdAt.toISOString(),
        appliedAt: effect.appliedAt ? effect.appliedAt.toISOString() : null,
        compensatedAt: effect.compensatedAt ? effect.compensatedAt.toISOString() : null,
      })),
    };
  }
}
