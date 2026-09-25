// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { ConfirmationProvider } from '@/confirmation';
import { EnvVarsDialog } from './EnvVarsDialog';

const mocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/api', () => ({
  api: {
    listConfigVars: vi.fn(),
    upsertConfigVar: vi.fn(),
    deleteConfigVar: vi.fn(),
  },
}));

vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

function renderDialog(onChanged = vi.fn()) {
  render(
    <ConfirmationProvider>
      <EnvVarsDialog
        projectId="project-1"
        env="prod"
        canManage
        onOpenChange={() => undefined}
        onChanged={onChanged}
      />
    </ConfirmationProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(cleanup);

describe('EnvVarsDialog', () => {
  it('refreshes the project after saving configuration', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listConfigVars).mockResolvedValue([]);
    vi.mocked(api.upsertConfigVar).mockResolvedValue({
      key: 'FEATURE_FLAG',
      value: 'enabled',
      isSecret: false,
      hasValue: true,
      updatedAt: '2026-09-25T00:00:00.000Z',
    });
    const onChanged = renderDialog();

    expect(await screen.findByText('No variables yet.')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('KEY'), 'feature_flag');
    await user.type(screen.getByPlaceholderText('value'), 'enabled');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(api.upsertConfigVar).toHaveBeenCalledWith('project-1', 'prod', 'FEATURE_FLAG', {
      value: 'enabled',
      isSecret: false,
    });
  });

  it('refreshes the project after deleting configuration', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listConfigVars)
      .mockResolvedValueOnce([
        {
          key: 'REMOVE_ME',
          value: 'temporary',
          isSecret: false,
          hasValue: true,
          updatedAt: '2026-09-25T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);
    vi.mocked(api.deleteConfigVar).mockResolvedValue(undefined);
    const onChanged = renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Delete REMOVE_ME' }));
    await user.click(screen.getByRole('button', { name: 'Delete variable' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(api.deleteConfigVar).toHaveBeenCalledWith('project-1', 'prod', 'REMOVE_ME');
  });
});
