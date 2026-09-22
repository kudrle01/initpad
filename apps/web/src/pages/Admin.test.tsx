// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformUpdateStatus } from '@/types';
import { PlatformUpdateCard } from './Admin';

afterEach(cleanup);

describe('PlatformUpdateCard', () => {
  it('shows the current release and keeps a successful operation only in history', () => {
    const completed = {
      id: 'operation-1',
      requestId: 'request-1',
      fromVersion: '0.2.0',
      toVersion: '0.2.1',
      status: 'succeeded' as const,
      stage: 'completed',
      message: 'InitPad 0.2.1 installed successfully',
      startedAt: '2026-09-21T10:00:00.000Z',
      finishedAt: '2026-09-21T10:05:00.000Z',
    };
    const status: PlatformUpdateStatus = {
      enabled: true,
      supervisorConfigured: true,
      supervisorOnline: true,
      supervisorError: null,
      currentVersion: '0.2.1',
      latestVersion: '0.2.1',
      updateAvailable: false,
      canInstall: false,
      releaseUrl: 'https://github.com/example/initpad/releases/tag/initpad-v0.2.1',
      publishedAt: '2026-09-21T09:00:00.000Z',
      catalogCheckedAt: '2026-09-21T10:06:00.000Z',
      catalogStale: false,
      catalogError: null,
      operation: completed,
      history: [completed],
    };

    render(
      <PlatformUpdateCard
        status={status}
        loading={false}
        error={null}
        installing={false}
        onRefresh={() => undefined}
        onInstall={() => undefined}
      />,
    );

    expect(screen.getByText('InitPad 0.2.1 is current')).toBeInTheDocument();
    expect(screen.queryByText('InitPad 0.2.1 installed successfully')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });

  it('treats a transient fetch failure during an active update as reconnecting', () => {
    const operation = {
      id: 'operation-2',
      requestId: 'request-2',
      fromVersion: '0.2.4',
      toVersion: '0.2.6',
      status: 'running' as const,
      stage: 'supervisor',
      message: 'Switching the release Supervisor and checking readiness',
      startedAt: '2026-09-22T11:26:32.000Z',
      finishedAt: null,
    };
    const status: PlatformUpdateStatus = {
      enabled: true,
      supervisorConfigured: true,
      supervisorOnline: true,
      supervisorError: null,
      currentVersion: '0.2.4',
      latestVersion: '0.2.6',
      updateAvailable: true,
      canInstall: false,
      releaseUrl: null,
      publishedAt: null,
      catalogCheckedAt: '2026-09-22T11:26:32.000Z',
      catalogStale: false,
      catalogError: null,
      operation,
      history: [operation],
    };

    render(
      <PlatformUpdateCard
        status={status}
        loading={false}
        error="fetch failed"
        installing={false}
        onRefresh={() => undefined}
        onInstall={() => undefined}
      />,
    );

    expect(
      screen.getByText('Connection interrupted while InitPad restarts. Reconnecting…'),
    ).toBeInTheDocument();
    expect(screen.queryByText('fetch failed')).not.toBeInTheDocument();
  });
});
