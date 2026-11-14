// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from './ForgotPassword';

const mocks = vi.hoisted(() => ({
  api: { authConfig: vi.fn(), requestPasswordReset: vi.fn() },
}));

vi.mock('@/api', () => ({ api: mocks.api }));

function renderPage() {
  render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('ForgotPassword (audit P2)', () => {
  it('tells the user to ask the administrator when the instance cannot send e-mail', async () => {
    mocks.api.authConfig.mockResolvedValue({ emailDeliveryEnabled: false });
    renderPage();

    expect(await screen.findByText(/cannot send e-mail/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
    expect(mocks.api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('sends the request and reports the e-mail when delivery is enabled', async () => {
    mocks.api.authConfig.mockResolvedValue({ emailDeliveryEnabled: true });
    mocks.api.requestPasswordReset.mockResolvedValue(undefined);
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Username or e-mail'), ' alice ');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(mocks.api.requestPasswordReset).toHaveBeenCalledWith('alice');
    expect(await screen.findByText(/we sent a reset link/)).toBeInTheDocument();
  });

  it('keeps the form when the instance configuration cannot be read', async () => {
    mocks.api.authConfig.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });
});
