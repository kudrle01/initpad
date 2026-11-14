import { ProjectProductionApprovals } from './project-production-approvals';

// Regression suite for audit P2: a crash between claiming a production request
// and recording its deployment left it in `approving` forever, which blocked
// later production requests and pipeline preset changes.

const NOW = new Date('2026-11-14T12:00:00Z');
const STUCK = {
  id: 'request-1',
  environmentId: 'env-prod',
  kind: 'promote',
  version: 'a'.repeat(40),
  reviewedAt: new Date('2026-11-14T11:40:00Z'),
  updatedAt: new Date('2026-11-14T11:40:00Z'),
};

function make(operation: { id: string } | null) {
  const prisma = {
    productionDeploymentRequest: {
      findMany: jest.fn(async () => [STUCK]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    deploymentOperation: { findFirst: jest.fn(async () => operation) },
  };
  const approvals = new ProjectProductionApprovals(
    prisma as never,
    {} as never,
    undefined,
    jest.fn(),
    jest.fn(),
  );
  return { approvals, prisma };
}

describe('ProjectProductionApprovals stuck approval recovery', () => {
  it('looks only at requests older than the approval grace period', async () => {
    const { approvals, prisma } = make(null);

    await approvals.recoverStuckApprovals(NOW);

    expect(prisma.productionDeploymentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'approving', updatedAt: { lte: new Date('2026-11-14T11:55:00Z') } },
        take: 25,
      }),
    );
  });

  it('links the deployment that the interrupted approval already started', async () => {
    const { approvals, prisma } = make({ id: 'operation-9' });

    await expect(approvals.recoverStuckApprovals(NOW)).resolves.toBe(1);

    expect(prisma.deploymentOperation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          environmentId: 'env-prod',
          kind: 'promote',
          version: STUCK.version,
          createdAt: { gte: STUCK.reviewedAt },
          productionRequest: null,
        },
      }),
    );
    expect(prisma.productionDeploymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', status: 'approving', updatedAt: STUCK.updatedAt },
      data: { status: 'approved', deploymentOperationId: 'operation-9' },
    });
  });

  it('returns a request without a started deployment to pending review', async () => {
    const { approvals, prisma } = make(null);

    await expect(approvals.recoverStuckApprovals(NOW)).resolves.toBe(1);

    expect(prisma.productionDeploymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', status: 'approving', updatedAt: STUCK.updatedAt },
      data: {
        status: 'pending',
        reviewedById: null,
        reviewedByUsername: null,
        reviewedByDisplayName: null,
        reviewedAt: null,
      },
    });
  });
});
