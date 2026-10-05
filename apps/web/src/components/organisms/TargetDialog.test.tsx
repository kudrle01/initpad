// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { ConfirmationProvider } from '@/confirmation';
import { TargetFormDialog } from './TargetDialog';
import type { Target } from '@/types';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api', () => ({
  api: { inspectTargetHostKey: vi.fn() },
}));

vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('TargetFormDialog SSH host trust', () => {
  it('retrieves the public key before credentials and saves it only after confirmation', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    vi.mocked(api.inspectTargetHostKey).mockResolvedValue({
      host: 'sftp.example.test',
      port: 22,
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
    });

    render(
      <ConfirmationProvider>
        <TargetFormDialog
          open
          target={null}
          busy={false}
          onOpenChange={() => undefined}
          onSubmit={onSubmit}
        />
      </ConfirmationProvider>,
    );

    await user.selectOptions(screen.getByLabelText('Connection method'), 'sftp');
    await user.type(screen.getByLabelText('Host'), 'sftp.example.test');
    await user.click(screen.getByRole('button', { name: 'Get fingerprint' }));

    await waitFor(() =>
      expect(api.inspectTargetHostKey).toHaveBeenCalledWith({
        host: 'sftp.example.test',
        port: 22,
      }),
    );
    expect(screen.getByText('ssh-ed25519')).toBeInTheDocument();
    expect(screen.getByText(/OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/)).toBeInTheDocument();
    expect(screen.getByLabelText('Host key fingerprint')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Trust and save' }));
    expect(screen.getByLabelText('Host key fingerprint')).toHaveValue(
      'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not trust a discovered key when the user cancels', async () => {
    const user = userEvent.setup();
    vi.mocked(api.inspectTargetHostKey).mockResolvedValue({
      host: 'sftp.example.test',
      port: 22,
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg',
    });

    render(
      <ConfirmationProvider>
        <TargetFormDialog
          open
          target={null}
          busy={false}
          onOpenChange={() => undefined}
          onSubmit={() => undefined}
        />
      </ConfirmationProvider>,
    );

    await user.selectOptions(screen.getByLabelText('Connection method'), 'sftp');
    await user.type(screen.getByLabelText('Host'), 'sftp.example.test');
    await user.click(screen.getByRole('button', { name: 'Get fingerprint' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByLabelText('Host key fingerprint')).toHaveValue('');
  });

  it('shows a stronger warning before replacing an existing server identity', async () => {
    const user = userEvent.setup();
    const existingFingerprint = 'SHA256:OQnj8QkyP0DwPcCH2RppMp1ARe0QOs/7G8aFAdhEErg';
    const target: Target = {
      id: 'target-1',
      name: 'Shared hosting',
      kind: 'sftp',
      scope: 'user',
      capabilities: ['static', 'php'],
      host: 'sftp.example.test',
      port: 22,
      username: 'student',
      auth: 'password',
      hostKeyFingerprint: existingFingerprint,
      remotePath: '/www',
      publicUrl: 'https://student.example.test',
      managementState: 'active',
      managementStateChangedAt: null,
      routingMode: 'direct-port',
      gatewayPreflight: null,
      verifiedAt: '2026-10-01T12:00:00.000Z',
      credentialConfigured: true,
    };
    const replacementFingerprint = `SHA256:${'A'.repeat(43)}`;
    vi.mocked(api.inspectTargetHostKey).mockResolvedValue({
      host: target.host!,
      port: target.port!,
      algorithm: 'ssh-ed25519',
      fingerprint: replacementFingerprint,
    });

    render(
      <ConfirmationProvider>
        <TargetFormDialog
          open
          target={target}
          busy={false}
          onOpenChange={() => undefined}
          onSubmit={() => undefined}
        />
      </ConfirmationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Check identity' }));
    expect(await screen.findByText('The server identity has changed')).toBeInTheDocument();
    expect(screen.getByText(existingFingerprint)).toBeInTheDocument();
    expect(screen.getByText(replacementFingerprint)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replace trusted key' }));
    expect(screen.getByLabelText('Host key fingerprint')).toHaveValue(replacementFingerprint);
  });
});
