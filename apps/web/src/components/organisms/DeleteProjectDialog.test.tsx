// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Environment, EnvName } from '@/types';
import { DeleteProjectDialog } from './DeleteProjectDialog';

afterEach(cleanup);

function environment(
  name: EnvName,
  status: Environment['status'],
  statusReason: string | null = null,
): Environment {
  return {
    name,
    provider: 'docker',
    status,
    version: status === 'running' ? 'a'.repeat(40) : null,
    url: status === 'running' ? `https://${name}.example.test` : null,
    statusReason,
    deploymentRequired: false,
    artifact: null,
    workspaceAccessStatus: null,
    target: null,
  };
}

describe('DeleteProjectDialog', () => {
  it('requires every applicable acknowledgement before destructive deletion', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteProjectDialog
        open
        onOpenChange={() => undefined}
        projectName="billing-api"
        environments={[
          environment('prod', 'running'),
          environment('test', 'empty', 'Cleanup pending: remove /srv/quarantine/billing-api'),
        ]}
        hasRepository
        deleting={false}
        onConfirm={onConfirm}
      />,
    );

    const deleteButton = screen.getByRole('button', { name: /^delete project$/i });
    await user.type(screen.getByPlaceholderText('billing-api'), 'billing-api');
    expect(deleteButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /remove the production deployment/i }));
    expect(deleteButton).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', {
        name: /delete the initpad record with protected cleanup still pending/i,
      }),
    );
    await user.click(screen.getByRole('checkbox', { name: /also delete the source repository/i }));

    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({
      deleteRepository: true,
      confirmProduction: true,
      confirmCleanupDebt: true,
    });
  });

  it('does not retain a previous confirmation after cancel and reopen', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <DeleteProjectDialog
            open={open}
            onOpenChange={setOpen}
            projectName="billing-api"
            environments={[]}
            hasRepository
            deleting={false}
            onConfirm={() => undefined}
          />
        </>
      );
    }

    render(<Harness />);
    await user.type(screen.getByPlaceholderText('billing-api'), 'billing-api');
    await user.click(screen.getByRole('checkbox', { name: /also delete the source repository/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await user.click(screen.getByRole('button', { name: /reopen/i }));

    expect(screen.getByPlaceholderText('billing-api')).toHaveValue('');
    expect(
      screen.getByRole('checkbox', { name: /also delete the source repository/i }),
    ).not.toBeChecked();
  });
});
