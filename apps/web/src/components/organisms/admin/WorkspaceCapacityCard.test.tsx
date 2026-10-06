// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

function updatedCapacity(values: WorkspaceCapacityUpdate): WorkspaceCapacity {
  const limits = {
    projects: values.maxProjects,
    members: values.maxMembers,
    targets: values.maxTargets,
    concurrentOperations: values.maxConcurrentOperations,
    artifactBytes: String(BigInt(values.maxArtifactStorageGiB) * 1024n * 1024n * 1024n),
  };
  return {
    ...capacity,
    limits,
    remaining: {
      projects: limits.projects - capacity.usage.projects,
      members: limits.members - capacity.usage.members,
      targets: limits.targets - capacity.usage.targets,
      concurrentOperations: limits.concurrentOperations - capacity.usage.concurrentOperations,
      artifactBytes: String(BigInt(limits.artifactBytes) - BigInt(capacity.usage.artifactBytes)),
    },
  };
}

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
      Promise.resolve(updatedCapacity(values)),
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
    await user.clear(projects);
    await user.type(projects, '60');

    const saveButton = screen.getByRole('button', { name: 'Save limits' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() =>
      expect(mocks.api.adminUpdateWorkspaceCapacity).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ maxProjects: 60, maxArtifactStorageGiB: 20 }),
      ),
    );
    expect(mocks.confirmAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith('Updated limits for Team Alpha'),
    );
  });

  it('requires confirmation before lowering a limit below current usage', async () => {
    const user = userEvent.setup();
    render(<WorkspaceCapacityCard />);

    const members = await screen.findByLabelText(/Members.*8 used/);
    await user.clear(members);
    await user.type(members, '4');

    const saveButton = screen.getByRole('button', { name: 'Save limits' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    await waitFor(() => expect(mocks.confirmAction).toHaveBeenCalledTimes(1));
    expect(mocks.confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Put Team Alpha over its new limit?',
        tone: 'warning',
      }),
    );
  });
});
