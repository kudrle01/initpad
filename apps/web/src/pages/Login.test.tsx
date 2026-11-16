// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api';
import Login from './Login';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  api: {
    authConfig: vi.fn(),
    register: vi.fn(),
    signin: vi.fn(),
    resendRegistrationConfirmation: vi.fn(),
  },
}));

vi.mock('@/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api')>();
  return { ...original, api: mocks.api };
});

vi.mock('@/auth', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: mocks.signIn }),
}));

function authConfig(bootstrapRequired: boolean, docsUrl: string | null = null) {
  return {
    registrationAvailable: true,
    registrationMode: 'admin-provisioned',
    bootstrapRequired,
    githubEnabled: false,
    edition: 'self-hosted' as const,
    docsUrl,
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
    await user.type(screen.getByLabelText('Confirm password'), 'long-password-1');
    await user.type(token, ' printed-setup-token ');
    await user.click(submitButton('Create account'));

    await waitFor(() =>
      expect(mocks.api.register).toHaveBeenCalledWith(
        'admin',
        'admin@example.test',
        'long-password-1',
        'printed-setup-token',
        'long-password-1',
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

describe('Login user guide link (ADR-156)', () => {
  it('links the getting-started chapter when the instance publishes a guide', async () => {
    mocks.api.authConfig.mockResolvedValue(authConfig(false, 'https://docs.example.test'));
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /Read the guide/ });
    expect(link).toHaveAttribute('href', 'https://docs.example.test/en/#getting-started');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows no guide link when the instance has none', async () => {
    mocks.api.authConfig.mockResolvedValue(authConfig(false));
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    // The password field appears only once the auth config has loaded.
    await screen.findByLabelText('Password');
    expect(screen.queryByRole('link', { name: /Read the guide/ })).not.toBeInTheDocument();
  });
});

describe('SaaS registration confirmed by e-mail (ADR-188)', () => {
  const saasConfig = {
    ...authConfig(false),
    registrationAvailable: true,
    edition: 'saas' as const,
    githubEnabled: true,
    emailDeliveryEnabled: true,
    emailConfirmationRequired: true,
  };

  async function openRegistration() {
    mocks.api.authConfig.mockResolvedValue(saasConfig);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await screen.findByLabelText('Password');
    const toggle = screen
      .getAllByRole('button', { name: 'Create account' })
      .find((candidate) => candidate.getAttribute('type') === 'button');
    await user.click(toggle!);
    await user.type(screen.getByLabelText('Username'), 'alice');
    await user.type(screen.getByLabelText('E-mail'), 'alice@example.test');
    await user.type(screen.getByLabelText('Password'), 'long-password-1');
    return user;
  }

  it('refuses mismatched passwords before calling the API', async () => {
    const user = await openRegistration();
    await user.type(screen.getByLabelText('Confirm password'), 'long-password-2');
    await user.click(submitButton('Create account'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    expect(mocks.api.register).not.toHaveBeenCalled();
  });

  it('waits for the e-mail confirmation instead of signing in', async () => {
    mocks.api.register.mockResolvedValue({
      verificationRequired: true,
      email: 'alice@example.test',
    });
    mocks.api.resendRegistrationConfirmation.mockResolvedValue({ ok: true });
    const user = await openRegistration();
    await user.type(screen.getByLabelText('Confirm password'), 'long-password-1');
    await user.click(submitButton('Create account'));

    expect(
      await screen.findByText(/We sent a confirmation link to alice@example.test/),
    ).toBeVisible();
    expect(mocks.signIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send the link again' }));
    expect(mocks.api.resendRegistrationConfirmation).toHaveBeenCalledWith('alice@example.test');
  });

  it('offers a new confirmation link when sign-in waits for it', async () => {
    mocks.api.authConfig.mockResolvedValue(saasConfig);
    mocks.api.signin.mockRejectedValue(
      new ApiError(
        'Confirm your e-mail address before signing in.',
        403,
        'Confirm your e-mail address before signing in. Open the link we sent you or send it again.',
      ),
    );
    mocks.api.resendRegistrationConfirmation.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await user.type(await screen.findByLabelText('Username or e-mail'), 'alice');
    await user.type(screen.getByLabelText('Password'), 'long-password-1');
    await user.click(submitButton('Sign in'));

    await user.click(
      await screen.findByRole('button', { name: 'Send the confirmation link again' }),
    );
    expect(mocks.api.resendRegistrationConfirmation).toHaveBeenCalledWith('alice');
  });
});
