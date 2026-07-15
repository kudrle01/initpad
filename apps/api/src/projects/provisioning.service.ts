import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ProvisioningKind = 'create' | 'import';
export type ProvisioningStep = 'validate' | 'repository' | 'ci' | 'done';

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
}

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
};

/**
 * Persistent audit of provisioning a project (create/import), Phase 3. Every
 * mutation past `start` is best-effort (never throws) so recording can wrap the
 * real work without ever changing its outcome; the flow's own errors surface as
 * usual and are also recorded as a failed operation.
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
    };
  }
}
