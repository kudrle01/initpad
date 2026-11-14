// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RollbackPreview } from '@/types';
import { RollbackDialog } from './RollbackDialog';

afterEach(cleanup);

describe('RollbackDialog', () => {
  it('shows the complete verified rollback digest', () => {
    const digest = `sha256:${'b'.repeat(64)}`;
    const preview: RollbackPreview = {
      candidateOperationId: 'operation-1',
      environment: 'prod',
      target: 'Production cluster',
      currentVersion: '1111111111111111111111111111111111111111',
      rollbackVersion: '2222222222222222222222222222222222222222',
      currentArtifact: null,
      rollbackArtifact: {
        id: 'artifact-2',
        provider: 'github',
        digest,
        runId: 'run-2',
      },
      sourceDeployedAt: '2026-09-22T10:00:00.000Z',
      stateToken: 'state-token',
    };

    render(
      <RollbackDialog preview={preview} busy={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.getByText(digest)).toBeInTheDocument();
  });

  it('lets the user pick an older candidate and confirms with its id', () => {
    const onConfirm = vi.fn();
    const preview: RollbackPreview = {
      candidateOperationId: 'operation-2',
      environment: 'dev',
      target: 'Lab',
      currentVersion: '3'.repeat(40),
      rollbackVersion: '2'.repeat(40),
      currentArtifact: null,
      rollbackArtifact: null,
      sourceDeployedAt: '2026-09-22T10:00:00.000Z',
      stateToken: 'state-token',
      candidates: [
        {
          candidateOperationId: 'operation-2',
          version: '2'.repeat(40),
          artifact: null,
          deployedAt: '2026-09-22T10:00:00.000Z',
        },
        {
          candidateOperationId: 'operation-1',
          version: '1'.repeat(40),
          artifact: null,
          deployedAt: '2026-09-20T10:00:00.000Z',
        },
      ],
    };
    render(
      <RollbackDialog
        preview={preview}
        busy={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBeChecked();
    fireEvent.click(radios[1]);
    fireEvent.click(screen.getByRole('button', { name: /Roll back dev/ }));
    expect(onConfirm).toHaveBeenCalledWith('operation-1');
  });

  it('keeps the default candidate when the API sends no list', () => {
    const onConfirm = vi.fn();
    render(
      <RollbackDialog
        preview={{
          candidateOperationId: 'operation-9',
          environment: 'test',
          target: 'Lab',
          currentVersion: null,
          rollbackVersion: '9'.repeat(40),
          currentArtifact: null,
          rollbackArtifact: null,
          sourceDeployedAt: '2026-09-22T10:00:00.000Z',
          stateToken: 'token',
        }}
        busy={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Roll back test/ }));
    expect(onConfirm).toHaveBeenCalledWith('operation-9');
  });
});
