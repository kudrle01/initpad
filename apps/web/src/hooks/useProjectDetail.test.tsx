// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api';
import type { Project } from '@/types';
import { useProjectDetail } from './useProjectDetail';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  api: {
    getProject: vi.fn(),
    getCommits: vi.fn(),
    getProvisioning: vi.fn(),
    getDeployments: vi.fn(),
    getProductionRequest: vi.fn(),
    listTemplates: vi.fn(),
    listTargets: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'project-1' }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api')>();
  return { ...original, api: mocks.api };
});

vi.mock('@/auth', () => ({
  useAuth: () => ({
    workspaces: [{ id: 'workspace-1', role: 'owner' }],
  }),
}));

vi.mock('@/toast', () => ({ useToast: () => mocks.toast }));

afterEach(cleanup);

const project: Project = {
  id: 'project-1',
  workspaceId: 'workspace-1',
  name: 'billing-api',
  templateId: 'nestjs',
  repoPath: 'alice/billing-api',
  repoUrl: 'https://git.example.test/alice/billing-api',
  scm: {
    provider: 'gitea',
    repositoryId: '42',
    owner: 'alice',
    name: 'billing-api',
    fullName: 'alice/billing-api',
    defaultBranch: 'main',
    repoUrl: 'https://git.example.test/alice/billing-api',
    installationId: null,
  },
  createdAt: '2026-09-12T00:00:00.000Z',
  lastCommit: 'a'.repeat(40),
  environments: [],
};

function arrangeSuccessfulLoad() {
  mocks.api.getProject.mockResolvedValue(project);
  mocks.api.getCommits.mockResolvedValue([]);
  mocks.api.getProvisioning.mockResolvedValue(null);
  mocks.api.getDeployments.mockResolvedValue([]);
  mocks.api.getProductionRequest.mockResolvedValue(null);
  mocks.api.listTemplates.mockResolvedValue([]);
  mocks.api.listTargets.mockResolvedValue([]);
}

describe('useProjectDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrangeSuccessfulLoad();
  });

  it('loads the authoritative project and completes a confirmed deletion', async () => {
    mocks.api.deleteProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectDetail());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.project).toEqual(project);
    expect(result.current.readOnly).toBe(false);
    await act(async () => {
      await result.current.deleteProject({
        deleteRepository: true,
        confirmProduction: true,
        confirmCleanupDebt: false,
      });
    });

    expect(mocks.api.deleteProject).toHaveBeenCalledWith('project-1', {
      deleteRepository: true,
      confirmProduction: true,
      confirmCleanupDebt: false,
    });
    expect(mocks.toast.success).toHaveBeenCalledWith('Deleted billing-api');
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('turns an authoritative 404 into a not-found state without stale actions', async () => {
    mocks.api.getProject.mockRejectedValue(new ApiError('Project not found', 404));
    const { result } = renderHook(() => useProjectDetail());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notFound).toBe(true);
    expect(result.current.project).toBeNull();
    expect(result.current.commits).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
