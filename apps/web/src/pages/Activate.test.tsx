// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Activate from './Activate';
import LegacyLinkRedirect from './LegacyLinkRedirect';
import VerifyEmail from './VerifyEmail';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  api: { activateAccount: vi.fn(), verifyEmail: vi.fn() },
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/auth', () => ({ useAuth: () => ({ signIn: mocks.signIn }) }));

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      { path: '/activate', element: <Activate /> },
      { path: '/activate/:token', element: <LegacyLinkRedirect to="/activate" /> },
      { path: '/verify-email', element: <VerifyEmail /> },
      { path: '/', element: <p>Home</p> },
      { path: '/login', element: <p>Sign in</p> },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function activate() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Password'), 'a-brand-new-password');
  await user.type(screen.getByLabelText('Confirm password'), 'a-brand-new-password');
  await user.click(screen.getByRole('button', { name: 'Activate and sign in' }));
}

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe('single-use links (ADR-143)', () => {
  it('reads the token from the fragment and removes it from the address', async () => {
    mocks.api.activateAccount.mockResolvedValue({ id: 'u1' });
    const router = renderAt('/activate#link-token');

    await waitFor(() => expect(router.state.location.hash).toBe(''));
    expect(router.state.location.pathname).toBe('/activate');
    await activate();

    expect(mocks.api.activateAccount).toHaveBeenCalledWith('link-token', 'a-brand-new-password');
    expect(await screen.findByText('Home')).toBeInTheDocument();
  });

  it('still opens a link issued with the token in the path', async () => {
    mocks.api.activateAccount.mockResolvedValue({ id: 'u1' });
    const router = renderAt('/activate/older-token');

    await waitFor(() => expect(router.state.location.pathname).toBe('/activate'));
    await activate();

    expect(mocks.api.activateAccount).toHaveBeenCalledWith('older-token', 'a-brand-new-password');
  });

  it('asks for the whole link again when the token is missing', async () => {
    renderAt('/verify-email');

    expect(
      await screen.findByText(
        'The link is missing its code. Open the whole link again from the message you received.',
      ),
    ).toBeInTheDocument();
    expect(mocks.api.verifyEmail).not.toHaveBeenCalled();
  });
});
