// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceMember } from '@/types';
import { WorkspaceMembersSettings } from './WorkspaceMembersSettings';

const members: WorkspaceMember[] = [
  {
    userId: 'u-owner',
    username: 'olga',
    name: null,
    avatarUrl: null,
    role: 'owner',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    userId: 'u-admin',
    username: 'adam',
    name: null,
    avatarUrl: null,
    role: 'admin',
    createdAt: '2026-11-02T00:00:00.000Z',
  },
  {
    userId: 'u-member',
    username: 'mia',
    name: null,
    avatarUrl: null,
    role: 'member',
    createdAt: '2026-11-03T00:00:00.000Z',
  },
];

const mocks = vi.hoisted(() => ({
  api: {
    listWorkspaceMembers: vi.fn(),
    addWorkspaceMember: vi.fn(),
    leaveWorkspace: vi.fn(),
    transferWorkspaceOwnership: vi.fn(),
  },
  auth: {
    activeWorkspace: null as Workspace | null,
    refreshWorkspaces: vi.fn(() => Promise.resolve()),
  },
  confirmAction: vi.fn(() => Promise.resolve(true)),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/confirmation', () => ({ useConfirmation: () => mocks.confirmAction }));
vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

function workspace(role: Workspace['role']): Workspace {
  return {
    id: 'w1',
    slug: 'team',
    name: 'Team',
    type: 'team',
    role,
    productionApprovalPolicy: 'self-review',
    createdAt: '2026-11-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.listWorkspaceMembers.mockResolvedValue(members);
});
afterEach(cleanup);

describe('WorkspaceMembersSettings (audit P1.19, P3)', () => {
  it('lets the owner hand the workspace to an admin', async () => {
    mocks.auth.activeWorkspace = workspace('owner');
    mocks.api.transferWorkspaceOwnership.mockResolvedValue(members);
    render(<WorkspaceMembersSettings />);

    expect(screen.queryByRole('button', { name: 'Make mia the owner' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Make adam the owner' }));

    expect(mocks.api.transferWorkspaceOwnership).toHaveBeenCalledWith('w1', 'u-admin');
    await waitFor(() => expect(mocks.auth.refreshWorkspaces).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Leave workspace' })).not.toBeInTheDocument();
  });

  it('lets a member leave a team workspace', async () => {
    mocks.auth.activeWorkspace = workspace('member');
    mocks.api.leaveWorkspace.mockResolvedValue(undefined);
    render(<WorkspaceMembersSettings />);

    await userEvent.click(await screen.findByRole('button', { name: 'Leave workspace' }));

    expect(mocks.api.leaveWorkspace).toHaveBeenCalledWith('w1');
    await waitFor(() => expect(mocks.auth.refreshWorkspaces).toHaveBeenCalled());
  });

  it('does not claim that an unknown account was added', async () => {
    mocks.auth.activeWorkspace = workspace('admin');
    mocks.api.addWorkspaceMember.mockResolvedValue(members);
    render(<WorkspaceMembersSettings />);

    await userEvent.type(
      await screen.findByLabelText('New member username or e-mail'),
      'ghost@example.test',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        'If an account matches ghost@example.test, it is now a member of this workspace.',
      ),
    );
  });
});
