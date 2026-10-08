// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubIntegrationSettings } from './GitHubIntegrationSettings';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  api: {
    authConfig: vi.fn(() => Promise.resolve({ githubEnabled: true })),
    listIdentities: vi.fn(() =>
      Promise.resolve([
        {
          provider: 'github',
          username: 'octocat',
          linkedAt: '2026-10-08T10:00:00.000Z',
          canUnlink: false,
        },
      ]),
    ),
    githubStatus: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        appConfigured: true,
        linked: true,
        login: 'octocat',
        credentialReady: true,
        ciCallbackReady: true,
        ciCallbackUrl: null,
        ciCallbackIssue: null,
        canInstall: true,
        installation: { present: false, suspended: false },
        installations: [],
      }),
    ),
    recoverGithubSetup: vi.fn(() => Promise.resolve({ recovered: false, accountLogin: null })),
    startGithubSetup: vi.fn(() =>
      Promise.resolve({ installUrl: 'https://github.com/apps/initpad/installations/new' }),
    ),
  },
}));

vi.mock('@/auth', () => ({
  useAuth: () => ({
    activeWorkspace: { id: 'workspace-1', name: 'Team Alpha', role: 'owner' },
  }),
}));
vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/confirmation', () => ({ useConfirmation: () => vi.fn() }));
vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

async function returnToWindow(statusReads: number) {
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(mocks.api.githubStatus).toHaveBeenCalledTimes(statusReads));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GitHubIntegrationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attempts setup recovery on load but not on every return to the window', async () => {
    render(<GitHubIntegrationSettings />);
    await waitFor(() => expect(mocks.api.githubStatus).toHaveBeenCalledTimes(1));
    expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(1);

    await returnToWindow(2);
    await returnToWindow(3);
    await returnToWindow(4);

    expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(1);
  });

  it('retries recovery on return while a setup started here is pending', async () => {
    const popup = {
      opener: {},
      document: { title: '', body: { textContent: '' } },
      location: { replace: vi.fn() },
      focus: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

    render(<GitHubIntegrationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: /Install GitHub App/ }));
    await waitFor(() =>
      expect(popup.location.replace).toHaveBeenCalledWith(
        'https://github.com/apps/initpad/installations/new',
      ),
    );
    expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(1);

    await returnToWindow(2);

    expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(2);
  });
});
