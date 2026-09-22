// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
});
