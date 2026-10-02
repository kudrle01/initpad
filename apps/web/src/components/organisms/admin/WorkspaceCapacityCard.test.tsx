// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCapacity, WorkspaceCapacityUpdate } from '@/types';
import { WorkspaceCapacityCard } from './WorkspaceCapacityCard';

const capacity: WorkspaceCapacity = {
  workspaceId: 'workspace-1',
  workspaceName: 'Team Alpha',
  limits: {
    projects: 50,
    members: 100,
    targets: 20,
    concurrentOperations: 10,
    artifactBytes: String(20n * 1024n * 1024n * 1024n),
  },
  usage: {
    projects: 4,
    members: 8,
    targets: 2,
    concurrentOperations: 1,
    artifactBytes: String(3n * 1024n * 1024n * 1024n),
  },
  remaining: {
    projects: 46,
    members: 92,
    targets: 18,
    concurrentOperations: 9,
    artifactBytes: String(17n * 1024n * 1024n * 1024n),
  },
};

const mocks = vi.hoisted(() => ({
  api: {
    adminListWorkspaceCapacity: vi.fn(),
    adminUpdateWorkspaceCapacity: vi.fn(),
  },
  confirmAction: vi.fn(() => Promise.resolve(true)),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/confirmation', () => ({ useConfirmation: () => mocks.confirmAction }));
vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.adminListWorkspaceCapacity.mockResolvedValue([capacity]);
  mocks.api.adminUpdateWorkspaceCapacity.mockImplementation(
    (_workspaceId: string, values: WorkspaceCapacityUpdate) =>
      Promise.resolve({
        ...capacity,
        limits: {
          projects: values.maxProjects,
          members: values.maxMembers,
          targets: values.maxTargets,
          concurrentOperations: values.maxConcurrentOperations,
          artifactBytes: String(BigInt(values.maxArtifactStorageGiB) * 1024n * 1024n * 1024n),
        },
      }),
  );
});

afterEach(cleanup);

describe('WorkspaceCapacityCard', () => {
  it('loads every workspace limit and persists an integer update', async () => {
    const user = userEvent.setup();
    render(<WorkspaceCapacityCard />);

    expect(await screen.findByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('workspace-1')).toBeInTheDocument();

    const projects = screen.getByLabelText(/Projects.*4 used/);
    fireEvent.change(projects, { target: { value: '60' } });
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() =>
      expect(mocks.api.adminUpdateWorkspaceCapacity).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ maxProjects: 60, maxArtifactStorageGiB: 20 }),
      ),
    );
    expect(mocks.confirmAction).not.toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('Updated limits for Team Alpha');
  });

  it('requires confirmation before lowering a limit below current usage', async () => {
    const user = userEvent.setup();
    render(<WorkspaceCapacityCard />);

    const members = await screen.findByLabelText(/Members.*8 used/);
    fireEvent.change(members, { target: { value: '4' } });
    await user.click(screen.getByRole('button', { name: 'Save limits' }));

    await waitFor(() => expect(mocks.confirmAction).toHaveBeenCalledTimes(1));
    expect(mocks.confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Put Team Alpha over its new limit?',
        tone: 'warning',
      }),
    );
  });
});
