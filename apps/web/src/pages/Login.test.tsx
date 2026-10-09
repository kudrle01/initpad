// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  api: {
    authConfig: vi.fn(),
    register: vi.fn(),
    signin: vi.fn(),
  },
}));

vi.mock('@/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api')>();
  return { ...original, api: mocks.api };
});

vi.mock('@/auth', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: mocks.signIn }),
}));

function authConfig(bootstrapRequired: boolean) {
  return {
    registrationAvailable: true,
    registrationMode: 'admin-provisioned',
    bootstrapRequired,
    githubEnabled: false,
    edition: 'self-hosted' as const,
    passwordAuthEnabled: true,
    emailDeliveryEnabled: false,
  };
}

// The sign-in/register switch reuses the submit labels, so pick the form button.
function submitButton(name: string): HTMLElement {
  const button = screen
    .getAllByRole('button', { name })
    .find((candidate) => candidate.getAttribute('type') === 'submit');
  if (!button) throw new Error(`No submit button named ${name}`);
  return button;
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('Login first administrator setup (ADR-136)', () => {
  it('asks a new instance for the installer setup token', async () => {
    mocks.api.authConfig.mockResolvedValue(authConfig(true));
    mocks.api.register.mockResolvedValue({ id: 'u1' });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    const token = await screen.findByLabelText('Setup token');
    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('E-mail'), 'admin@example.test');
    await user.type(screen.getByLabelText('Password'), 'long-password-1');
    await user.type(token, ' printed-setup-token ');
    await user.click(submitButton('Create account'));

    await waitFor(() =>
      expect(mocks.api.register).toHaveBeenCalledWith(
        'admin',
        'admin@example.test',
        'long-password-1',
        'printed-setup-token',
      ),
    );
  });

  it('does not show the setup token once the administrator exists', async () => {
    mocks.api.authConfig.mockResolvedValue(authConfig(false));
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    await waitFor(() => expect(submitButton('Sign in')).toBeInTheDocument());
    expect(screen.queryByLabelText('Setup token')).not.toBeInTheDocument();
  });
});
