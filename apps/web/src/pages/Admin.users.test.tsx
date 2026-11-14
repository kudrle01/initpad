// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Admin from './Admin';

const mocks = vi.hoisted(() => ({
  api: {
    adminListUsers: vi.fn(),
    adminPlatformUpdateStatus: vi.fn(),
    adminSecurityStatus: vi.fn(),
    adminSetPlatformRole: vi.fn(),
    adminCreateUser: vi.fn(),
  },
  confirmAction: vi.fn(() => Promise.resolve(true)),
  toast: { success: vi.fn(), error: vi.fn() },
  // Stable identity, as in the real provider; a new object per render would
  // reload the user list on every render.
  user: { id: 'admin-1', username: 'root', edition: 'self-hosted', platformRole: 'admin' },
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/confirmation', () => ({ useConfirmation: () => mocks.confirmAction }));
vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/organisms/admin/WorkspaceCapacityCard', () => ({
  WorkspaceCapacityCard: () => null,
}));
vi.mock('@/components/organisms/admin/PlatformAuditCard', () => ({
  PlatformAuditCard: () => null,
}));
vi.mock('@/components/organisms/admin/PlatformUpdateCard', () => ({
  PlatformUpdateCard: () => null,
}));
// Radix menus need layout APIs jsdom lacks; plain buttons keep the actions reachable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

const account = (id: string, username: string, platformRole: 'admin' | 'user') => ({
  id,
  username,
  name: null,
  email: `${username}@example.test`,
  platformRole,
  active: true,
  mustChangePassword: false,
  emailVerified: true,
  createdAt: '2026-11-01T00:00:00.000Z',
});

function renderAdmin() {
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.adminListUsers.mockResolvedValue([
    account('admin-1', 'root', 'admin'),
    account('u2', 'bob', 'user'),
  ]);
  mocks.api.adminPlatformUpdateStatus.mockResolvedValue(null);
  mocks.api.adminSecurityStatus.mockResolvedValue({ builtInAppsShareSession: false });
});
afterEach(cleanup);

describe('Admin users (audit P1.19, P3)', () => {
  it('promotes another account to platform administrator', async () => {
    mocks.api.adminSetPlatformRole.mockResolvedValue(account('u2', 'bob', 'admin'));
    renderAdmin();

    await userEvent.click(await screen.findByRole('button', { name: 'Make administrator' }));

    await waitFor(() => expect(mocks.api.adminSetPlatformRole).toHaveBeenCalledWith('u2', 'admin'));
    expect(await screen.findByRole('button', { name: 'Remove administrator role' })).toBeVisible();
    // The signed-in administrator cannot demote themselves from the menu.
    expect(screen.getAllByRole('button', { name: 'Remove administrator role' })).toHaveLength(1);
  });

  it('keeps the temporary password visible when the activation link failed', async () => {
    mocks.api.adminCreateUser.mockResolvedValue({
      user: account('u3', 'carol', 'user'),
      temporaryPassword: 'temporary-secret-1',
      activationDelivery: 'manual',
      activationError: 'The account was created, but no activation link could be issued.',
    });
    renderAdmin();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Add user/ }));
    await user.type(screen.getByLabelText('Username'), 'carol');
    await user.type(screen.getByLabelText('E-mail'), 'carol@example.test');
    await user.click(screen.getByRole('button', { name: /Create user/ }));

    await waitFor(() =>
      expect(screen.getByText(/no activation link could be issued/)).toBeInTheDocument(),
    );
    expect(screen.getByText('temporary-secret-1')).toBeInTheDocument();
  });
});
