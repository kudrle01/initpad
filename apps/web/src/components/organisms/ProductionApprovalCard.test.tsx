// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductionDeploymentRequest } from '@/types';
import { ProductionApprovalCard } from './ProductionApprovalCard';

afterEach(cleanup);

function request(
  overrides: Partial<ProductionDeploymentRequest> = {},
): ProductionDeploymentRequest {
  return {
    id: 'request-1',
    kind: 'promote',
    status: 'pending',
    sourceEnvironment: 'test',
    version: '0123456789abcdef0123456789abcdef01234567',
    artifact: {
      id: 'artifact-1',
      digest: `sha256:${'a'.repeat(64)}`,
    },
    target: { id: 'target-1', name: 'Production cluster', provider: 'agent' },
    policy: 'separate-reviewer',
    requester: { userId: 'user-1', username: 'alice', displayName: 'Alice' },
    reviewer: null,
    reviewNote: null,
    deployment: null,
    canApprove: true,
    canReject: true,
    canCancel: false,
    createdAt: '2026-09-22T10:00:00.000Z',
    reviewedAt: null,
    ...overrides,
  };
}

describe('ProductionApprovalCard', () => {
  it('shows the complete immutable artifact digest before approval', () => {
    const deploymentRequest = request();

    render(
      <MemoryRouter>
        <ProductionApprovalCard
          request={deploymentRequest}
          projectId="project-1"
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Artifact digest')).toBeInTheDocument();
    expect(screen.getByText(deploymentRequest.artifact!.digest!)).toBeInTheDocument();
  });

  it('marks old requests without a recorded digest explicitly', () => {
    render(
      <MemoryRouter>
        <ProductionApprovalCard
          request={request({ artifact: null })}
          projectId="project-1"
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Not available for this legacy build')).toBeInTheDocument();
  });

  it('shows production review actions and the maintainer capability from the server view', () => {
    render(
      <MemoryRouter>
        <ProductionApprovalCard
          request={request({ canApprove: true, canReject: true })}
          projectId="project-1"
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Approve and deploy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(
      screen.getByText('Owners, admins and maintainers can review production requests.'),
    ).toBeInTheDocument();
  });

  it('does not expose review actions when the server denies them', () => {
    render(
      <MemoryRouter>
        <ProductionApprovalCard
          request={request({ canApprove: false, canReject: false })}
          projectId="project-1"
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Approve and deploy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('explains separate review to a maintainer who created the request', () => {
    render(
      <MemoryRouter>
        <ProductionApprovalCard
          request={request({ canApprove: false, canReject: true })}
          projectId="project-1"
          busy={false}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        'A different workspace owner, admin or maintainer must approve this request.',
      ),
    ).toBeInTheDocument();
  });
});
