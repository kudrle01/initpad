// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceAdministrationSettings } from './WorkspaceAdministrationSettings';

const mocks = vi.hoisted(() => ({
  activeWorkspace: {
    current: {
      id: 'workspace-1',
      name: 'Team Alpha',
      slug: 'team-alpha',
      type: 'team' as const,
      role: 'owner',
      productionApprovalPolicy: 'separate-reviewer',
      createdAt: '2026-09-26T10:00:00.000Z',
    },
  },
  refreshWorkspaces: vi.fn(() => Promise.resolve()),
  confirmAction: vi.fn(() => Promise.resolve(true)),
  toast: { success: vi.fn(), error: vi.fn() },
  api: {
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    updateProductionApprovalPolicy: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/auth', () => ({
  useAuth: () => ({
    activeWorkspace: mocks.activeWorkspace.current,
    refreshWorkspaces: mocks.refreshWorkspaces,
  }),
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/confirmation', () => ({ useConfirmation: () => mocks.confirmAction }));
vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

afterEach(cleanup);

describe('WorkspaceAdministrationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeWorkspace.current.role = 'owner';
  });

  it('lets only the owner change the production approval policy', async () => {
    render(<WorkspaceAdministrationSettings />);

    const select = screen.getByLabelText('Production approval');
    expect(select).toBeEnabled();
    fireEvent.change(select, { target: { value: 'self-review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update policy' }));

    await waitFor(() =>
      expect(mocks.api.updateProductionApprovalPolicy).toHaveBeenCalledWith(
        'workspace-1',
        'self-review',
      ),
    );
    expect(mocks.confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          'A requester who is an owner, admin or maintainer will be able to approve their own production request.',
      }),
    );
  });

  it.each(['admin', 'maintainer', 'member', 'viewer'] as const)(
    'shows the current policy as read-only to a %s',
    (role) => {
      mocks.activeWorkspace.current.role = role;
      render(<WorkspaceAdministrationSettings />);

      expect(screen.getByLabelText('Production approval')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Update policy' })).not.toBeInTheDocument();
      expect(
        screen.getByText('Only the workspace owner can change this policy.'),
      ).toBeInTheDocument();
    },
  );
});
