import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditEventsService } from '../audit/audit-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { RollbackPreview } from '../domain/types';

export type ProductionRequestKind = 'promote' | 'redeploy' | 'rollback';
export type ProductionApprovalPolicy = 'self-review' | 'separate-reviewer';

interface CreateInput {
  kind: ProductionRequestKind;
  candidateOperationId?: string;
  stateToken?: string;
}

interface Candidate {
  kind: ProductionRequestKind;
  sourceEnvironment: string;
  candidateOperationId: string | null;
  candidateStateToken: string | null;
  version: string;
  buildArtifactId: string | null;
  artifactDigest: string | null;
}

interface ProductionSnapshot extends Candidate {
  workspaceId: string;
  projectName: string;
  environmentId: string;
  targetId: string | null;
  allocationId: string | null;
  targetName: string;
  provider: string;
  configRevision: number;
  targetRevision: Date | null;
  allocationRevision: Date | null;
  policy: ProductionApprovalPolicy;
  stateToken: string;
}

export interface ExpectedProductionState {
  stateToken: string;
  targetId: string | null;
  allocationId: string | null;
  configRevision: number;
  targetRevision: Date | null;
  allocationRevision: Date | null;
}

type ScheduleApprovedProduction = (
  projectId: string,
  version: string,
  kind: ProductionRequestKind,
  buildArtifactId: string | null,
  actorUserId: string,
  expected: ExpectedProductionState,
) => Promise<string>;

type ResolveRollback = (projectId: string) => Promise<RollbackPreview | null>;

const REQUEST_INCLUDE = {
  deploymentOperation: {
    select: { id: true, status: true, phase: true, message: true },
  },
} as const;

type RequestRow = Prisma.ProductionDeploymentRequestGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Owns immutable production intent, review policy and stale-state detection. */
export class ProjectProductionApprovals {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly audit: Pick<AuditEventsService, 'record'> | undefined,
    private readonly schedule: ScheduleApprovedProduction,
    private readonly resolveRollback: ResolveRollback,
  ) {}

  async latest(projectId: string, userId: string) {
    const { workspaceId } = await this.workspaces.requireProject(userId, projectId, 'read');
    let request = await this.prisma.productionDeploymentRequest.findFirst({
      where: { projectId, workspaceId },
      orderBy: { createdAt: 'desc' },
      include: REQUEST_INCLUDE,
    });
    if (request?.status === 'pending' && !(await this.matchesCurrentState(request))) {
      const changed = await this.prisma.productionDeploymentRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: {
          status: 'stale',
          reviewNote: 'Production inputs changed after this request was created',
        },
      });
      if (changed.count) {
        await this.record(request, null, 'production.request_stale', {
          kind: request.kind,
          environment: 'prod',
        });
        request = await this.prisma.productionDeploymentRequest.findUnique({
          where: { id: request.id },
          include: REQUEST_INCLUDE,
        });
      }
    }
    return request ? this.toView(request, userId) : null;
  }

  async create(projectId: string, userId: string, input: CreateInput) {
    await this.workspaces.requireProject(
      userId,
      projectId,
      input.kind === 'rollback' ? 'maintain' : 'write',
    );
    const snapshot = await this.snapshot(projectId, input);
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, name: true },
    });
    if (!actor) throw new NotFoundException('User not found');

    let request: RequestRow;
    try {
      request = await this.prisma.$transaction(
        async (tx) => {
          await tx.productionDeploymentRequest.updateMany({
            where: {
              environmentId: snapshot.environmentId,
              status: 'pending',
            },
            data: {
              status: 'stale',
              reviewNote: 'Replaced by a newer production request',
            },
          });
          return tx.productionDeploymentRequest.create({
            data: {
              workspaceId: snapshot.workspaceId,
              projectId,
              projectNameSnapshot: snapshot.projectName,
              environmentId: snapshot.environmentId,
              requestedById: userId,
              requestedByUsername: actor.username,
              requestedByDisplayName: actor.name,
              kind: input.kind,
              status: 'pending',
              sourceEnvironment: snapshot.sourceEnvironment,
              candidateOperationId: snapshot.candidateOperationId,
              candidateStateToken: snapshot.candidateStateToken,
              version: snapshot.version,
              buildArtifactId: snapshot.buildArtifactId,
              artifactDigest: snapshot.artifactDigest,
              targetIdSnapshot: snapshot.targetId,
              allocationIdSnapshot: snapshot.allocationId,
              targetNameSnapshot: snapshot.targetName,
              providerSnapshot: snapshot.provider,
              configRevisionSnapshot: snapshot.configRevision,
              targetRevisionSnapshot: snapshot.targetRevision,
              allocationRevisionSnapshot: snapshot.allocationRevision,
              stateToken: snapshot.stateToken,
              policySnapshot: snapshot.policy,
            },
            include: REQUEST_INCLUDE,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Another production request was created at the same time. Reload and review it.',
        );
      }
      throw error;
    }

    try {
      await this.record(request, userId, 'production.requested', {
        kind: request.kind,
        environment: 'prod',
        version: request.version,
        policy: request.policySnapshot,
      });
    } catch (error) {
      await this.prisma.productionDeploymentRequest.deleteMany({
        where: { id: request.id, status: 'pending' },
      });
      throw error;
    }
    return this.toView(request, userId);
  }

  approve(projectId: string, requestId: string, userId: string, note?: string) {
    return this.review(projectId, requestId, userId, 'approved', note);
  }

  reject(projectId: string, requestId: string, userId: string, note?: string) {
    return this.review(projectId, requestId, userId, 'rejected', note);
  }

  async cancel(projectId: string, requestId: string, userId: string) {
    await this.workspaces.requireProject(userId, projectId, 'read');
    const request = await this.request(projectId, requestId);
    if (request.requestedById !== userId) {
      throw new ForbiddenException('Only the requester can cancel this production request');
    }
    const updated = await this.prisma.productionDeploymentRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: { status: 'cancelled', reviewNote: 'Cancelled by requester', reviewedAt: new Date() },
    });
    if (updated.count !== 1)
      throw new ConflictException('This production request is no longer pending');
    await this.record(request, userId, 'production.request_cancelled', {
      kind: request.kind,
      environment: 'prod',
    });
    return this.latest(projectId, userId);
  }

  private async review(
    projectId: string,
    requestId: string,
    userId: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    const { workspaceId } = await this.workspaces.requireProject(userId, projectId, 'admin');
    const request = await this.request(projectId, requestId);
    if (request.workspaceId !== workspaceId)
      throw new NotFoundException('Production request not found');
    if (request.status !== 'pending') {
      throw new ConflictException(`This production request is already ${request.status}`);
    }
    const policy = await this.currentPolicy(workspaceId);
    if (
      decision === 'approved' &&
      policy === 'separate-reviewer' &&
      request.requestedById === userId
    ) {
      throw new ForbiddenException(
        'This workspace requires a different person to approve production',
      );
    }
    const reviewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, name: true },
    });
    if (!reviewer) throw new NotFoundException('Reviewer not found');

    if (decision === 'rejected') {
      const updated = await this.prisma.productionDeploymentRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: {
          status: 'rejected',
          reviewedById: userId,
          reviewedByUsername: reviewer.username,
          reviewedByDisplayName: reviewer.name,
          reviewedAt: new Date(),
          reviewNote: note?.trim() || null,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('This production request was reviewed concurrently');
      await this.record(request, userId, 'production.request_rejected', {
        kind: request.kind,
        environment: 'prod',
      });
      return this.latest(projectId, userId);
    }

    if (!(await this.matchesCurrentState(request))) {
      await this.markStale(request.id);
      throw new ConflictException(
        'Artifact, target, or production configuration changed. Create a new request.',
      );
    }
    const claimed = await this.prisma.productionDeploymentRequest.updateMany({
      where: { id: request.id, status: 'pending' },
      data: {
        status: 'approving',
        reviewedById: userId,
        reviewedByUsername: reviewer.username,
        reviewedByDisplayName: reviewer.name,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
    if (claimed.count !== 1)
      throw new ConflictException('This production request was reviewed concurrently');

    try {
      await this.record(request, userId, 'production.approval_accepted', {
        kind: request.kind,
        environment: 'prod',
        version: request.version,
      });
      const operationId = await this.schedule(
        projectId,
        request.version,
        request.kind as ProductionRequestKind,
        request.buildArtifactId,
        userId,
        {
          stateToken: request.stateToken,
          targetId: request.targetIdSnapshot,
          allocationId: request.allocationIdSnapshot,
          configRevision: request.configRevisionSnapshot,
          targetRevision: request.targetRevisionSnapshot,
          allocationRevision: request.allocationRevisionSnapshot,
        },
      );
      await this.prisma.productionDeploymentRequest.update({
        where: { id: request.id },
        data: { status: 'approved', deploymentOperationId: operationId },
      });
      await this.record(request, userId, 'production.request_approved', {
        kind: request.kind,
        environment: 'prod',
        version: request.version,
        operationId,
      }).catch(() => undefined);
    } catch (error) {
      const stale = error instanceof ConflictException;
      await this.prisma.productionDeploymentRequest.updateMany({
        where: { id: request.id, status: 'approving' },
        data: {
          status: stale ? 'stale' : 'pending',
          ...(stale
            ? { reviewNote: 'Production inputs changed during approval' }
            : {
                reviewedById: null,
                reviewedByUsername: null,
                reviewedByDisplayName: null,
                reviewedAt: null,
              }),
        },
      });
      await this.record(request, userId, 'production.approval_failed', {
        kind: request.kind,
        environment: 'prod',
        reason: stale ? 'state-changed' : 'scheduling-failed',
      }).catch(() => undefined);
      throw error;
    }
    return this.latest(projectId, userId);
  }

  private async snapshot(projectId: string, input: CreateInput): Promise<ProductionSnapshot> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        workspaceId: true,
        workspace: { select: { productionApprovalPolicy: true } },
        environments: {
          where: { name: { in: ['test', 'prod'] } },
          select: {
            id: true,
            name: true,
            provider: true,
            status: true,
            version: true,
            buildArtifactId: true,
            activeOperationId: true,
            targetId: true,
            allocationId: true,
            configRevision: true,
            target: {
              select: { id: true, name: true, updatedAt: true, managementState: true },
            },
            allocation: { select: { id: true, updatedAt: true, status: true } },
            buildArtifact: { select: { id: true, digest: true } },
          },
        },
      },
    });
    if (!project) throw new NotFoundException(`Project '${projectId}' not found`);
    const production = project.environments.find((environment) => environment.name === 'prod');
    if (!production) throw new NotFoundException("Environment 'prod' not found");
    if (production.activeOperationId) {
      throw new BadRequestException('Production has an operation in progress');
    }
    if (production.target?.managementState && production.target.managementState !== 'active') {
      throw new BadRequestException(`Production target is ${production.target.managementState}`);
    }
    if (production.allocation?.status && production.allocation.status !== 'active') {
      throw new BadRequestException('Production workspace access is paused');
    }

    const candidate = await this.candidate(projectId, input, project.environments);
    const policy = project.workspace.productionApprovalPolicy as ProductionApprovalPolicy;
    const base = {
      workspaceId: project.workspaceId,
      projectName: project.name,
      environmentId: production.id,
      targetId: production.targetId,
      allocationId: production.allocationId,
      targetName: production.target?.name ?? production.provider,
      provider: production.provider,
      configRevision: production.configRevision,
      targetRevision: production.target?.updatedAt ?? null,
      allocationRevision: production.allocation?.updatedAt ?? null,
      policy,
      ...candidate,
    };
    return { ...base, stateToken: this.stateToken(projectId, base) };
  }

  private async candidate(
    projectId: string,
    input: CreateInput,
    environments: Array<{
      name: string;
      status: string;
      version: string | null;
      buildArtifactId: string | null;
      buildArtifact: { id: string; digest: string } | null;
    }>,
  ): Promise<Candidate> {
    if (input.kind === 'rollback') {
      if (!input.candidateOperationId || !input.stateToken) {
        throw new BadRequestException('Rollback candidate and state token are required');
      }
      const preview = await this.resolveRollback(projectId);
      if (!preview || preview.candidateOperationId !== input.candidateOperationId) {
        throw new ConflictException(
          'The previous verified production deployment changed. Review rollback again.',
        );
      }
      if (preview.stateToken !== input.stateToken) {
        throw new ConflictException(
          'Production changed after rollback confirmation was opened. Review it again.',
        );
      }
      return {
        kind: input.kind,
        sourceEnvironment: 'history',
        candidateOperationId: preview.candidateOperationId,
        candidateStateToken: preview.stateToken,
        version: preview.rollbackVersion,
        buildArtifactId: preview.rollbackArtifact?.id ?? null,
        artifactDigest: preview.rollbackArtifact?.digest ?? null,
      };
    }

    const sourceName = input.kind === 'promote' ? 'test' : 'prod';
    const source = environments.find((environment) => environment.name === sourceName);
    if (!source?.version)
      throw new BadRequestException(`${sourceName} has no verified build to publish`);
    if (input.kind === 'promote' && source.status !== 'running') {
      throw new BadRequestException(
        'Test must be running before its build can be requested for production',
      );
    }
    return {
      kind: input.kind,
      sourceEnvironment: sourceName,
      candidateOperationId: null,
      candidateStateToken: null,
      version: source.version,
      buildArtifactId: source.buildArtifactId,
      artifactDigest: source.buildArtifact?.digest ?? null,
    };
  }

  private async matchesCurrentState(request: RequestRow): Promise<boolean> {
    try {
      const snapshot = await this.snapshot(request.projectId, {
        kind: request.kind as ProductionRequestKind,
        candidateOperationId: request.candidateOperationId ?? undefined,
        stateToken: request.candidateStateToken ?? undefined,
      });
      return snapshot.stateToken === request.stateToken;
    } catch {
      return false;
    }
  }

  private stateToken(
    projectId: string,
    state: Omit<ProductionSnapshot, 'stateToken' | 'workspaceId' | 'projectName'>,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          projectId,
          state.environmentId,
          state.kind,
          state.sourceEnvironment,
          state.candidateOperationId,
          state.candidateStateToken,
          state.version,
          state.buildArtifactId,
          state.artifactDigest,
          state.targetId,
          state.allocationId,
          state.provider,
          state.configRevision,
          state.targetRevision?.toISOString() ?? null,
          state.allocationRevision?.toISOString() ?? null,
        ]),
      )
      .digest('hex');
  }

  private request(projectId: string, requestId: string): Promise<RequestRow> {
    return this.prisma.productionDeploymentRequest
      .findFirst({
        where: { id: requestId, projectId },
        include: REQUEST_INCLUDE,
      })
      .then((request) => {
        if (!request) throw new NotFoundException('Production request not found');
        return request;
      });
  }

  private async currentPolicy(workspaceId: string): Promise<ProductionApprovalPolicy> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { productionApprovalPolicy: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace.productionApprovalPolicy as ProductionApprovalPolicy;
  }

  private async markStale(id: string): Promise<void> {
    await this.prisma.productionDeploymentRequest.updateMany({
      where: { id, status: { in: ['pending', 'approving'] } },
      data: {
        status: 'stale',
        reviewNote: 'Production inputs changed after this request was created',
      },
    });
  }

  private record(
    request: Pick<
      RequestRow,
      'workspaceId' | 'projectId' | 'projectNameSnapshot' | 'kind' | 'version'
    >,
    actorUserId: string | null,
    action: string,
    details: Record<string, string>,
  ): Promise<void> {
    return (
      this.audit?.record({
        workspaceId: request.workspaceId,
        actorUserId,
        action,
        resourceType: 'project',
        resourceId: request.projectId,
        resourceName: request.projectNameSnapshot,
        details,
      }) ?? Promise.resolve()
    );
  }

  private async toView(request: RequestRow, userId: string) {
    const [role, currentPolicy] = await Promise.all([
      this.workspaces.roleFor(userId, request.workspaceId),
      this.currentPolicy(request.workspaceId),
    ]);
    const canReview = role === 'owner' || role === 'admin';
    const selfBlocked = currentPolicy === 'separate-reviewer' && request.requestedById === userId;
    return {
      id: request.id,
      kind: request.kind as ProductionRequestKind,
      status: request.status,
      sourceEnvironment: request.sourceEnvironment,
      version: request.version,
      artifact: request.buildArtifactId
        ? { id: request.buildArtifactId, digest: request.artifactDigest }
        : null,
      target: {
        id: request.targetIdSnapshot,
        name: request.targetNameSnapshot,
        provider: request.providerSnapshot,
      },
      policy: currentPolicy,
      requester: {
        userId: request.requestedById,
        username: request.requestedByUsername,
        displayName: request.requestedByDisplayName,
      },
      reviewer: request.reviewedByUsername
        ? {
            userId: request.reviewedById,
            username: request.reviewedByUsername,
            displayName: request.reviewedByDisplayName,
          }
        : null,
      reviewNote: request.reviewNote,
      deployment: request.deploymentOperation,
      canApprove: request.status === 'pending' && canReview && !selfBlocked,
      canReject: request.status === 'pending' && canReview,
      canCancel: request.status === 'pending' && request.requestedById === userId,
      createdAt: request.createdAt.toISOString(),
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
    };
  }
}
