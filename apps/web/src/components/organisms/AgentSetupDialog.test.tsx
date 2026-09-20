// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    getAgentUpdateStatus: vi.fn(),
    requestAgentUpdate: vi.fn(),
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
  onUpdateAgent: () => void = () => undefined,
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
        onUpdateAgent={onUpdateAgent}
      />
    </ConfirmationProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getAgentUpdateStatus).mockResolvedValue({
    enabled: true,
    checkedAt: '2026-09-16T10:00:00.000Z',
    stale: false,
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    updateMethod: 'none',
    image: null,
    releaseUrl: null,
    publishedAt: null,
    error: null,
  });
});
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
    expect(commands[0]).toHaveTextContent("--expected-target-id 'target-1'");
    expect(commands[0]).not.toHaveTextContent('--published-host');
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
    expect(commands[0]).toHaveTextContent("--expected-target-id 'target-1'");
    expect(commands[0]).not.toHaveTextContent('--published-host');
    expect(commands[0]).not.toHaveTextContent('--re-enroll');
  });

  it('keeps a current online Agent compact without reinstall controls', async () => {
    const release: AgentDistribution = {
      available: true,
      version: '0.14.1',
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
        version: '0.14.1',
        enrolledAt: '2026-09-15T12:00:00.000Z',
        lastSeenAt: '2026-09-15T12:01:00.000Z',
      },
      null,
    );

    expect(await screen.findByText('Agent 0.14.1 is current')).toBeInTheDocument();
    expect(screen.getByText(/ready to receive jobs/i)).toBeInTheDocument();
    expect(screen.queryByText(/curl -fsSLo initpad-agent-install\.sh/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download script only/i })).not.toBeInTheDocument();
  });

  it('shows a verified newer release and uses its immutable image for the manual bootstrap', async () => {
    const latestImage = `ghcr.io/example/initpad-agent@sha256:${'e'.repeat(64)}`;
    vi.mocked(api.getAgentDistribution).mockResolvedValue({
      available: true,
      version: '0.12.1',
      image: `ghcr.io/example/initpad-agent@sha256:${'c'.repeat(64)}`,
      unavailableReason: null,
      installer: { path: '/api/agent/distribution/install.sh', sha256: 'd'.repeat(64) },
    });
    vi.mocked(api.getAgentUpdateStatus).mockResolvedValue({
      enabled: true,
      checkedAt: '2026-09-16T10:00:00.000Z',
      stale: false,
      currentVersion: '0.12.1',
      latestVersion: '0.13.0',
      updateAvailable: true,
      updateMethod: 'manual',
      image: latestImage,
      releaseUrl: 'https://github.com/example/initpad/releases/tag/agent-v0.13.0',
      publishedAt: '2026-09-16T09:00:00.000Z',
      error: null,
    });

    renderDialog(
      [],
      {
        ...enrollment,
        state: 'online',
        enrollmentPending: false,
        credentialGeneration: 1,
        version: '0.12.1',
      },
      null,
    );

    expect(await screen.findByText('Agent 0.13.0 is available')).toBeInTheDocument();
    expect(screen.getByText(/final manual, identity-preserving update/i)).toBeInTheDocument();
    expect(screen.getByText('Update Agent to 0.13.0')).toBeInTheDocument();
    expect(screen.getByText(/curl -fsSLo initpad-agent-install\.sh/)).toHaveTextContent(
      latestImage,
    );
    expect(screen.getByRole('link', { name: /release details/i })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('requires confirmation before queuing a supported remote update', async () => {
    const user = userEvent.setup();
    const onUpdateAgent = vi.fn();
    vi.mocked(api.getAgentDistribution).mockResolvedValue({
      available: true,
      version: '0.13.0',
      image: `ghcr.io/example/initpad-agent@sha256:${'c'.repeat(64)}`,
      unavailableReason: null,
      installer: { path: '/api/agent/distribution/install.sh', sha256: 'd'.repeat(64) },
    });
    vi.mocked(api.getAgentUpdateStatus).mockResolvedValue({
      enabled: true,
      checkedAt: '2026-09-16T10:00:00.000Z',
      stale: false,
      currentVersion: '0.13.0',
      latestVersion: '0.14.0',
      updateAvailable: true,
      updateMethod: 'remote',
      image: `ghcr.io/example/initpad-agent@sha256:${'e'.repeat(64)}`,
      releaseUrl: 'https://github.com/example/initpad/releases/tag/agent-v0.14.0',
      publishedAt: '2026-09-16T09:00:00.000Z',
      error: null,
    });

    renderDialog(
      [],
      {
        ...enrollment,
        state: 'online',
        enrollmentPending: false,
        credentialGeneration: 1,
        version: '0.13.0',
      },
      null,
      onUpdateAgent,
    );

    await user.click(await screen.findByRole('button', { name: 'Install update' }));
    expect(await screen.findByText('Install Agent 0.14.0?')).toBeInTheDocument();
    expect(onUpdateAgent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Install update' }));
    expect(onUpdateAgent).toHaveBeenCalledTimes(1);
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
