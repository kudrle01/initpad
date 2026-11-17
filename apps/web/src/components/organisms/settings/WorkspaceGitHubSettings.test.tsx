// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { GitHubIntegrationSettings } from './GitHubIntegrationSettings';
import { WorkspaceGitHubSettings } from './WorkspaceGitHubSettings';

const mocks = vi.hoisted(() => ({
  requestPending: false,
  linked: true,
  workspaceType: 'personal',
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
        linked: mocks.linked,
        login: 'octocat',
        credentialReady: true,
        ciCallbackReady: true,
        ciCallbackUrl: null,
        ciCallbackIssue: null,
        canInstall: true,
        installation: { present: false, suspended: false },
        installationRequestPending: mocks.requestPending,
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
    activeWorkspace: {
      id: 'workspace-1',
      name: 'Team Alpha',
      role: 'owner',
      type: mocks.workspaceType,
    },
  }),
}));

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <WorkspaceGitHubSettings />
    </MemoryRouter>,
  );
}
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

describe('WorkspaceGitHubSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestPending = false;
    mocks.linked = true;
    mocks.workspaceType = 'personal';
  });

  it('connects organizations from a team workspace', async () => {
    mocks.workspaceType = 'team';
    renderWorkspace();

    expect(await screen.findByRole('button', { name: /Connect organization/ })).toBeInTheDocument();
    expect(
      screen.getByText('No GitHub organization is connected to Team Alpha yet.'),
    ).toBeInTheDocument();
  });

  it('asks to link GitHub in account settings before connecting', async () => {
    mocks.linked = false;
    renderWorkspace();

    const link = await screen.findByRole('link', { name: 'account settings' });
    expect(link).toHaveAttribute('href', '/settings/account');
    expect(screen.queryByRole('button', { name: /Install GitHub App/ })).not.toBeInTheDocument();
  });

  it('attempts setup recovery on load but not on every return to the window', async () => {
    renderWorkspace();
    await waitFor(() => expect(mocks.api.githubStatus).toHaveBeenCalledTimes(1));
    expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(1);

    await returnToWindow(2);
    await returnToWindow(3);
    await returnToWindow(4);

    expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying recovery on return while an org owner has yet to approve', async () => {
    mocks.requestPending = true;
    renderWorkspace();
    expect(
      await screen.findByText(/Waiting for a GitHub organization owner to approve the App/),
    ).toBeInTheDocument();

    await returnToWindow(2);
    await waitFor(() => expect(mocks.api.recoverGithubSetup).toHaveBeenCalledTimes(2));
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

    renderWorkspace();
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

describe('GitHubIntegrationSettings', () => {
  it('keeps only the GitHub identity and points to workspace settings for installations', async () => {
    render(
      <MemoryRouter>
        <GitHubIntegrationSettings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('@octocat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Install GitHub App/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'workspace settings' })).toHaveAttribute(
      'href',
      '/settings/workspace',
    );
  });
});
