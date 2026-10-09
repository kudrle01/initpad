// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '@/types';
import { PlatformAuditCard } from './PlatformAuditCard';

const mocks = vi.hoisted(() => ({
  api: { adminListAuditEvents: vi.fn() },
}));

vi.mock('@/api', () => ({ api: mocks.api }));

function event(over: Partial<AuditEvent>): AuditEvent {
  return {
    id: 'e1',
    actor: { userId: 'u1', username: 'alice', displayName: 'Alice' },
    action: 'auth.signed_in',
    outcome: 'succeeded',
    resource: { type: 'user', id: 'u1', name: 'alice' },
    operation: null,
    details: { method: 'password' },
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function renderCard() {
  render(
    <MemoryRouter>
      <PlatformAuditCard />
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('PlatformAuditCard (ADR-142)', () => {
  it('shows sign-ins, names a signed-out actor and pages older events', async () => {
    mocks.api.adminListAuditEvents
      .mockResolvedValueOnce({
        items: [
          event({}),
          event({
            id: 'e2',
            action: 'auth.sign_in_failed',
            outcome: 'failed',
            actor: { userId: null, username: 'anonymous', displayName: 'Signed-out visitor' },
            resource: { type: 'user', id: null, name: null },
            details: { reason: 'unknown_account' },
          }),
        ],
        nextCursor: 'e2',
      })
      .mockResolvedValueOnce({
        items: [event({ id: 'e3', action: 'user.deactivated', details: null })],
        nextCursor: null,
      });
    const user = userEvent.setup();
    renderCard();

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Signed in')).toBeInTheDocument();
    expect(within(list).getByText('Sign-in failed')).toBeInTheDocument();
    expect(within(list).getByText('Signed-out visitor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(list).findByText('Account deactivated')).toBeInTheDocument();
    expect(mocks.api.adminListAuditEvents).toHaveBeenLastCalledWith({
      action: undefined,
      cursor: 'e2',
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows who deleted a workspace and how much history went with it', async () => {
    mocks.api.adminListAuditEvents.mockResolvedValue({
      items: [
        event({
          action: 'workspace.deleted',
          resource: { type: 'workspace', id: 'w1', name: 'Old Team' },
          details: { auditEventsRemoved: 42 },
        }),
      ],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /Workspace deleted/ }));
    expect(screen.getByText(/Old Team/)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('filters by a platform action', async () => {
    mocks.api.adminListAuditEvents.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    renderCard();

    expect(await screen.findByText('No security events yet.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by action'), 'auth.sign_in_failed');
    await waitFor(() =>
      expect(mocks.api.adminListAuditEvents).toHaveBeenLastCalledWith({
        action: 'auth.sign_in_failed',
      }),
    );
  });
});
