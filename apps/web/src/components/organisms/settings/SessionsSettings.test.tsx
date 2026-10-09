// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeBrowser, SessionsSettings } from './SessionsSettings';

const mocks = vi.hoisted(() => ({
  api: { listSessions: vi.fn(), endSession: vi.fn(), endOtherSessions: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const safari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function session(id: string, userAgent: string | null, current = false) {
  return { id, userAgent, createdAt: new Date().toISOString(), current };
}

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('SessionsSettings (ADR-147)', () => {
  it('names browsers from their user agent', () => {
    expect(describeBrowser(firefox)).toBe('Firefox · Linux');
    expect(describeBrowser(safari)).toBe('Safari · iOS');
    expect(describeBrowser(null)).toBe('Unknown browser');
  });

  it('signs out another browser but never offers it for the current one', async () => {
    mocks.api.listSessions
      .mockResolvedValueOnce([session('s1', firefox, true), session('s2', safari)])
      .mockResolvedValueOnce([session('s1', firefox, true)]);
    mocks.api.endSession.mockResolvedValue({ ended: 1 });
    const user = userEvent.setup();
    render(<SessionsSettings />);

    const list = await screen.findByRole('list');
    const current = within(list).getByText('This browser').closest('li')!;
    expect(within(current).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: 'Sign out' }));
    expect(mocks.api.endSession).toHaveBeenCalledWith('s2');
    expect(await screen.findByText('Firefox · Linux')).toBeInTheDocument();
    expect(screen.queryByText('Safari · iOS')).not.toBeInTheDocument();
    expect(mocks.toast.success).toHaveBeenCalledWith('1 session signed out');
  });

  it('signs out all other browsers at once', async () => {
    mocks.api.listSessions.mockResolvedValue([
      session('s1', firefox, true),
      session('s2', safari),
      session('s3', null),
    ]);
    mocks.api.endOtherSessions.mockResolvedValue({ ended: 2 });
    const user = userEvent.setup();
    render(<SessionsSettings />);

    await user.click(await screen.findByRole('button', { name: 'Sign out all others' }));
    expect(mocks.api.endOtherSessions).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).toHaveBeenCalledWith('2 sessions signed out');
  });
});
