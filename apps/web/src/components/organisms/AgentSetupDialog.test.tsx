// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentDistribution,
  AgentEnrollment,
  AgentJobSummary,
  AgentStatus,
  Target,
} from '@/types';
import { api } from '@/api';
import { ConfirmationProvider } from '@/confirmation';
import { AgentSetupDialog } from './AgentSetupDialog';

vi.mock('@/api', () => ({
  api: {
    getAgentDistribution: vi.fn(),
  },
}));

const target: Target = {
  id: 'target-1',
  name: 'Application server',
  kind: 'docker',
  scope: 'user',
  capabilities: ['static', 'node', 'php', 'python'],
  host: null,
  port: null,
  username: null,
  auth: null,
  hostKeyFingerprint: null,
  remotePath: null,
  publicUrl: 'https://apps.example.test',
  managementState: 'active',
  managementStateChangedAt: null,
  routingMode: 'direct-port',
  gatewayPreflight: null,
  verifiedAt: null,
};

const enrollment: AgentEnrollment = {
  id: 'agent-1',
  targetId: target.id,
  state: 'not-enrolled',
  enrollmentPending: true,
  enrollmentExpiresAt: '2030-01-01T12:00:00.000Z',
  enrollmentToken: 'test-enrollment-token',
  credentialGeneration: 0,
  credentialActivatedAt: null,
  credentialRotationPending: false,
  protocolVersion: 1,
  version: null,
  capabilities: null,
  enrolledAt: null,
  lastSeenAt: null,
  disabledAt: null,
};

function renderDialog(
  jobs: AgentJobSummary[] = [],
  agentStatus: AgentStatus | null = enrollment,
  currentEnrollment: AgentEnrollment | null = enrollment,
) {
  render(
    <ConfirmationProvider>
      <AgentSetupDialog
        open
        target={target}
        agent={agentStatus}
        jobs={jobs}
        protocolError={null}
        testBusy={null}
        busy={false}
        enrollment={currentEnrollment}
        onOpenChange={() => undefined}
        onIssueEnrollment={() => undefined}
        onDisable={() => undefined}
        onTestProtocol={() => undefined}
        onTestLifecycle={() => undefined}
        onTestGateway={() => undefined}
      />
    </ConfirmationProvider>,
  );
}

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('AgentSetupDialog distribution', () => {
  it('shows only the verified installer command when a release is available', async () => {
    const release: AgentDistribution = {
      available: true,
      version: '0.11.0',
      image: `ghcr.io/example/initpad-agent@sha256:${'a'.repeat(64)}`,
      unavailableReason: null,
      installer: {
        path: '/api/agent/distribution/installer',
        sha256: 'b'.repeat(64),
      },
    };
    vi.mocked(api.getAgentDistribution).mockResolvedValue(release);

    renderDialog();

    expect(await screen.findByText(/immutable Agent 0\.11\.0 image/i)).toBeInTheDocument();
    const commands = screen.getAllByText(/curl -fsSLo initpad-agent-install\.sh/);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toHaveTextContent(release.image!);
    expect(commands[0]).not.toHaveTextContent('--re-enroll');
    expect(commands[1]).toHaveTextContent('--re-enroll');
    expect(screen.getByText(/replace an invalid existing identity/i)).toBeInTheDocument();
    expect(
      screen.getByText(/copy and run this command in an interactive terminal/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download script only/i })).toHaveAttribute(
      'title',
      'Downloads the script without running it',
    );
    expect(screen.queryByText(/sudo initpad-agent enroll/)).not.toBeInTheDocument();
  });

  it('shows an identity-preserving update command without generating enrollment', async () => {
    const release: AgentDistribution = {
      available: true,
      version: '0.12.1',
      image: `ghcr.io/example/initpad-agent@sha256:${'c'.repeat(64)}`,
      unavailableReason: null,
      installer: {
        path: '/api/agent/distribution/install.sh',
        sha256: 'd'.repeat(64),
      },
    };
    vi.mocked(api.getAgentDistribution).mockResolvedValue(release);

    renderDialog(
      [],
      {
        ...enrollment,
        state: 'online',
        enrollmentPending: false,
        credentialGeneration: 1,
        credentialActivatedAt: '2026-09-15T12:00:00.000Z',
        version: '0.12.0',
        enrolledAt: '2026-09-15T12:00:00.000Z',
        lastSeenAt: '2026-09-15T12:01:00.000Z',
      },
      null,
    );

    expect(await screen.findByText('Update Agent to 0.12.1')).toBeInTheDocument();
    expect(screen.getByText(/No new enrollment token is required/i)).toBeInTheDocument();
    const commands = screen.getAllByText(/curl -fsSLo initpad-agent-install\.sh/);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toHaveTextContent(release.image!);
    expect(commands[0]).not.toHaveTextContent('--re-enroll');
  });

  it('never suggests a host binary when distribution is unavailable', async () => {
    vi.mocked(api.getAgentDistribution).mockResolvedValue({
      available: false,
      version: '0.11.0',
      image: null,
      unavailableReason: 'No reviewed Agent release is selected',
      installer: {
        path: '/api/agent/distribution/installer',
        sha256: 'b'.repeat(64),
      },
    });

    renderDialog();

    expect(await screen.findByText('Agent installer is not configured')).toBeInTheDocument();
    expect(screen.getByText(/No reviewed Agent release is selected/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download script only/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/sudo initpad-agent enroll/)).not.toBeInTheDocument();
  });

  it('turns a first diagnostic pull timeout into an actionable retry message', () => {
    vi.mocked(api.getAgentDistribution).mockResolvedValue({
      available: false,
      version: '0.12.1',
      image: null,
      unavailableReason: 'Not relevant to this test',
      installer: { path: '/api/agent/distribution/install.sh', sha256: 'b'.repeat(64) },
    });

    renderDialog([
      {
        id: 'job-1',
        correlationId: 'correlation-1',
        kind: 'lifecycle-test',
        status: 'failed',
        attempt: 1,
        progressSequence: 1,
        progressPercent: 8,
        progressStage: 'working',
        message: 'Docker API timed out',
        resultCode: 'lifecycle_failed',
        createdAt: '2026-09-15T12:00:00.000Z',
        leasedAt: '2026-09-15T12:00:01.000Z',
        leaseExpiresAt: null,
        finishedAt: '2026-09-15T12:02:01.000Z',
      },
    ]);

    expect(
      screen.getByText(/diagnostic image pull timed out.+run Test Docker again/i),
    ).toBeInTheDocument();
  });
});
