// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Invite from './Invite';

const TOKEN = 'invitation-token-1234567890';

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as null | { username: string },
    loading: false,
    refreshWorkspaces: vi.fn(() => Promise.resolve()),
    switchWorkspace: vi.fn(),
  },
  api: {
    previewInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
  },
}));

vi.mock('@/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api')>();
  return { ...original, api: mocks.api };
});

vi.mock('@/auth', () => ({ useAuth: () => mocks.auth }));

function renderInvite() {
  return render(
    <MemoryRouter initialEntries={[`/invite#${TOKEN}`]}>
      <Invite />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = null;
  mocks.api.previewInvitation.mockResolvedValue({
    workspaceName: 'Platform team',
    role: 'maintainer',
    invitedBy: 'Alice',
    email: 'bob@example.test',
    expiresAt: '2026-11-23T10:00:00.000Z',
  });
});

describe('Invite page (ADR-188)', () => {
  it('shows the invitation and keeps the token for the sign-in round trip', async () => {
    renderInvite();

    expect(await screen.findByText('Join Platform team')).toBeVisible();
    expect(screen.getByText('Alice invited you to Platform team as maintainer.')).toBeVisible();
    expect(mocks.api.previewInvitation).toHaveBeenCalledWith(TOKEN);
    // The token never goes into the login URL, only into this tab's storage.
    expect(screen.getByRole('link', { name: 'Sign in to accept' })).toHaveAttribute(
      'href',
      '/login?next=%2Finvite',
    );
    expect(sessionStorage.getItem('initpad.pendingInvitation')).toBe(TOKEN);
  });

  it('accepts for the signed-in account and opens the workspace', async () => {
    mocks.auth.user = { username: 'bob' };
    mocks.api.acceptInvitation.mockResolvedValue({
      workspaceId: 'w1',
      workspaceName: 'Platform team',
      role: 'maintainer',
    });
    const user = userEvent.setup();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    await waitFor(() => expect(mocks.auth.switchWorkspace).toHaveBeenCalledWith('w1', '/'));
    expect(mocks.api.acceptInvitation).toHaveBeenCalledWith(TOKEN);
    expect(sessionStorage.getItem('initpad.pendingInvitation')).toBeNull();
  });

  it('explains an invalid or used link', async () => {
    mocks.api.previewInvitation.mockRejectedValue(
      new Error('This invitation is invalid, expired or already used'),
    );
    renderInvite();

    expect(await screen.findByText('Invitation not available')).toBeVisible();
    expect(screen.getByText('This invitation is invalid, expired or already used')).toBeVisible();
  });
});
