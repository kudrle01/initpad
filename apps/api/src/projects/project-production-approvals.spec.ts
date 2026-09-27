import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ProjectProductionApprovals } from './project-production-approvals';

const targetRevision = new Date('2026-09-07T10:00:00.000Z');
const allocationRevision = new Date('2026-09-07T10:05:00.000Z');
type TestRole = 'owner' | 'admin' | 'maintainer' | 'member' | 'viewer';
type TestPermission = 'read' | 'write' | 'maintain' | 'admin';

function harness(
  initialPolicy: 'self-review' | 'separate-reviewer' = 'separate-reviewer',
  pipelinePreset: 'dev-test-prod' | 'dev-prod' | 'prod-only' = 'dev-test-prod',
) {
  let policy = initialPolicy;
  let request: Record<string, any> | null = null;
  let configRevision = 3;
  const roles = new Map<string, TestRole>([
    ['requester', 'member'],
    ['reviewer', 'owner'],
  ]);
  const permissions: Record<TestPermission, ReadonlySet<TestRole>> = {
    read: new Set<TestRole>(['owner', 'admin', 'maintainer', 'member', 'viewer']),
    write: new Set<TestRole>(['owner', 'admin', 'maintainer', 'member']),
    maintain: new Set<TestRole>(['owner', 'admin', 'maintainer']),
    admin: new Set<TestRole>(['owner', 'admin']),
  } as const;
  const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    request = {
      id: 'request-1',
      ...data,
      deploymentOperationId: null,
      deploymentOperation: null,
      reviewNote: null,
      reviewedAt: null,
      reviewedById: null,
      reviewedByUsername: null,
      reviewedByDisplayName: null,
      createdAt: new Date('2026-09-07T11:00:00.000Z'),
      updatedAt: new Date('2026-09-07T11:00:00.000Z'),
    };
    return request;
  });
  const updateMany = jest.fn(
    async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      if (!request) return { count: 0 };
      if (where.id && where.id !== request.id) return { count: 0 };
      const allowed =
        where.status === undefined ||
        where.status === request.status ||
        (where.status?.in?.includes(request.status) ?? false);
      if (!allowed) return { count: 0 };
      request = { ...request, ...data };
      return { count: 1 };
    },
  );
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (!request) throw new Error('missing request');
    request = {
      ...request,
      ...data,
      deploymentOperation: data.deploymentOperationId
        ? {
            id: data.deploymentOperationId,
            status: 'running',
            phase: 'queued',
            message: 'Preparing deployment',
          }
        : request.deploymentOperation,
    };
    return request;
  });
  const projectSnapshot = () => ({
    id: 'project-1',
    name: 'Payments API',
    workspaceId: 'workspace-1',
    pipelinePreset,
    workspace: { productionApprovalPolicy: policy },
    environments: [
      {
        id: 'dev-env',
        name: 'dev',
        provider: 'docker',
        status: 'running',
        version: 'dddddddddddddddddddddddddddddddddddddddd',
        buildArtifactId: 'artifact-dev',
        activeOperationId: null,
        targetId: 'target-dev',
        allocationId: 'allocation-dev',
        configRevision: 1,
        target: {
          id: 'target-dev',
          name: 'Dev target',
          updatedAt: targetRevision,
          managementState: 'active',
        },
        allocation: { id: 'allocation-dev', updatedAt: allocationRevision, status: 'active' },
        buildArtifact: { id: 'artifact-dev', digest: 'digest-dev' },
      },
      {
        id: 'test-env',
        name: 'test',
        provider: 'docker',
        status: 'running',
        version: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        buildArtifactId: 'artifact-1',
        activeOperationId: null,
        targetId: 'target-test',
        allocationId: 'allocation-test',
        configRevision: 1,
        target: {
          id: 'target-test',
          name: 'Test target',
          updatedAt: targetRevision,
          managementState: 'active',
        },
        allocation: { id: 'allocation-test', updatedAt: allocationRevision, status: 'active' },
        buildArtifact: { id: 'artifact-1', digest: 'digest-1' },
      },
      {
        id: 'prod-env',
        name: 'prod',
        provider: 'docker',
        status: 'running',
        version: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        buildArtifactId: 'artifact-old',
        activeOperationId: null,
        targetId: 'target-prod',
        allocationId: 'allocation-prod',
        configRevision,
        target: {
          id: 'target-prod',
          name: 'Production',
          updatedAt: targetRevision,
          managementState: 'active',
        },
        allocation: { id: 'allocation-prod', updatedAt: allocationRevision, status: 'active' },
        buildArtifact: { id: 'artifact-old', digest: 'digest-old' },
      },
    ],
    buildArtifacts: [
      {
        id: 'artifact-ci',
        commitSha: 'cccccccccccccccccccccccccccccccccccccccc',
        digest: 'digest-ci',
      },
    ],
  });
  const prisma: Record<string, any> = {
    project: { findUnique: jest.fn(async () => projectSnapshot()) },
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        username: where.id === 'requester' ? 'alice' : 'bob',
        name: where.id === 'requester' ? 'Alice' : 'Bob',
      })),
    },
    workspace: { findUnique: jest.fn(async () => ({ productionApprovalPolicy: policy })) },
    productionDeploymentRequest: {
      create,
      updateMany,
      update,
      deleteMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => request),
      findUnique: jest.fn(async () => request),
    },
  };
  prisma.$transaction = jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback(prisma),
  );
  const workspaces = {
    requireProject: jest.fn(
      async (userId: string, _projectId: string, permission: TestPermission) => {
        const role = roles.get(userId) ?? 'viewer';
        if (!permissions[permission].has(role)) throw new ForbiddenException();
        return { workspaceId: 'workspace-1', role };
      },
    ),
    roleFor: jest.fn(async (userId: string) => roles.get(userId) ?? null),
    can: jest.fn((role: TestRole, permission: TestPermission) => permissions[permission].has(role)),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const schedule = jest.fn(async () => 'operation-1');
  const service = new ProjectProductionApprovals(
    prisma as never,
    workspaces as never,
    audit,
    schedule,
    jest.fn(async () => null),
  );
  return {
    service,
    prisma,
    audit,
    schedule,
    get request() {
      return request;
    },
    setPolicy(value: 'self-review' | 'separate-reviewer') {
      policy = value;
    },
    setRole(userId: string, role: TestRole) {
      roles.set(userId, role);
    },
    changeProductionConfig() {
      configRevision += 1;
    },
  };
}

describe('ProjectProductionApprovals', () => {
  it('stores one immutable production intent without configuration or secret values', async () => {
    const h = harness();

    await expect(
      h.service.create('project-1', 'requester', { kind: 'promote' }),
    ).resolves.toMatchObject({
      status: 'pending',
      version: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    const data = h.prisma.productionDeploymentRequest.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      projectNameSnapshot: 'Payments API',
      targetIdSnapshot: 'target-prod',
      allocationIdSnapshot: 'allocation-prod',
      configRevisionSnapshot: 3,
      buildArtifactId: 'artifact-1',
      artifactDigest: 'digest-1',
      policySnapshot: 'separate-reviewer',
    });
    expect(data.stateToken).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toMatch(/secret|password|DATABASE_URL/i);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'production.requested',
        actorUserId: 'requester',
      }),
    );
  });

  it.each([
    ['dev-test-prod', 'test', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'artifact-1'],
    ['dev-prod', 'dev', 'dddddddddddddddddddddddddddddddddddddddd', 'artifact-dev'],
    ['prod-only', 'ci', 'cccccccccccccccccccccccccccccccccccccccc', 'artifact-ci'],
  ] as const)(
    'takes a protected production candidate from the %s pipeline source',
    async (preset, sourceEnvironment, version, artifactId) => {
      const h = harness('separate-reviewer', preset);

      await h.service.create('project-1', 'requester', { kind: 'promote' });

      expect(h.prisma.productionDeploymentRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceEnvironment,
            version,
            buildArtifactId: artifactId,
          }),
        }),
      );
    },
  );

  it('enforces a different reviewer for team production', async () => {
    const h = harness();
    h.setRole('requester', 'maintainer');
    await h.service.create('project-1', 'requester', { kind: 'promote' });

    await expect(h.service.latest('project-1', 'requester')).resolves.toMatchObject({
      canApprove: false,
      canReject: true,
    });
    await expect(h.service.approve('project-1', 'request-1', 'requester')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.schedule).not.toHaveBeenCalled();
    expect(h.request?.status).toBe('pending');
  });

  it('lets a maintainer queue the exact approved snapshot once', async () => {
    const h = harness();
    h.setRole('reviewer', 'maintainer');
    await h.service.create('project-1', 'requester', { kind: 'promote' });

    await expect(h.service.approve('project-1', 'request-1', 'reviewer')).resolves.toMatchObject({
      status: 'approved',
      deployment: { id: 'operation-1' },
    });
    expect(h.schedule).toHaveBeenCalledTimes(1);
    expect(h.schedule).toHaveBeenCalledWith(
      'project-1',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'promote',
      'artifact-1',
      'reviewer',
      expect.objectContaining({
        targetId: 'target-prod',
        allocationId: 'allocation-prod',
        configRevision: 3,
      }),
    );
    const auditActions = (
      h.audit.record.mock.calls as unknown as Array<[Record<string, unknown>]>
    ).map(([event]) => event.action);
    expect(auditActions).toEqual(
      expect.arrayContaining(['production.approval_accepted', 'production.request_approved']),
    );
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'production.approval_accepted',
        details: expect.objectContaining({ reviewerRole: 'maintainer' }),
      }),
    );

    await expect(h.service.approve('project-1', 'request-1', 'reviewer')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.schedule).toHaveBeenCalledTimes(1);
  });

  it('invalidates approval when production configuration changes after review began', async () => {
    const h = harness();
    await h.service.create('project-1', 'requester', { kind: 'promote' });
    h.changeProductionConfig();

    await expect(h.service.approve('project-1', 'request-1', 'reviewer')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.schedule).not.toHaveBeenCalled();
    expect(h.request?.status).toBe('stale');
  });

  it('uses the current workspace policy for a still-pending request', async () => {
    const h = harness();
    h.setRole('requester', 'maintainer');
    await h.service.create('project-1', 'requester', { kind: 'promote' });
    h.setPolicy('self-review');

    await expect(h.service.latest('project-1', 'requester')).resolves.toMatchObject({
      policy: 'self-review',
      canApprove: true,
    });
    await expect(h.service.approve('project-1', 'request-1', 'requester')).resolves.toMatchObject({
      status: 'approved',
    });
  });

  it.each(['member', 'viewer'] as const)(
    'does not let a %s approve or reject production',
    async (role) => {
      const h = harness();
      h.setRole('reviewer', role);
      await h.service.create('project-1', 'requester', { kind: 'promote' });

      await expect(h.service.approve('project-1', 'request-1', 'reviewer')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(h.service.reject('project-1', 'request-1', 'reviewer')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(h.schedule).not.toHaveBeenCalled();
      expect(h.request?.status).toBe('pending');
    },
  );

  it.each([
    ['owner', true],
    ['admin', true],
    ['maintainer', true],
    ['member', false],
    ['viewer', false],
  ] as const)('reports canApprove from the %s permission tier', async (role, canApprove) => {
    const h = harness();
    h.setRole('reviewer', role);
    await h.service.create('project-1', 'requester', { kind: 'promote' });

    await expect(h.service.latest('project-1', 'reviewer')).resolves.toMatchObject({
      canApprove,
      canReject: canApprove,
    });
  });

  it('records a maintainer role when a request is rejected', async () => {
    const h = harness();
    h.setRole('reviewer', 'maintainer');
    await h.service.create('project-1', 'requester', { kind: 'promote' });

    await h.service.reject('project-1', 'request-1', 'reviewer');

    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'production.request_rejected',
        details: expect.objectContaining({ reviewerRole: 'maintainer' }),
      }),
    );
  });
});
