// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { Project } from '@/types';
import Projects from './Projects';

vi.mock('@/api', () => ({
  api: { listProjects: vi.fn(), listTemplates: vi.fn(), getWorkspacePortfolio: vi.fn() },
}));
vi.mock('@/auth', () => ({
  useAuth: () => ({ activeWorkspace: { id: 'w1', role: 'owner' }, user: { docsUrl: null } }),
}));

function project(id: string, name: string): Project {
  return { id, name, templateId: 'node', environments: [] } as unknown as Project;
}

beforeEach(() => {
  vi.mocked(api.listProjects).mockResolvedValue([project('p1', 'billing'), project('p2', 'shop')]);
  vi.mocked(api.listTemplates).mockResolvedValue([]);
  vi.mocked(api.getWorkspacePortfolio).mockResolvedValue({
    stats: { pendingApprovals: 2 },
    projects: [
      { id: 'p1', pendingApprovals: 0 },
      { id: 'p2', pendingApprovals: 2 },
    ],
  } as never);
});
afterEach(cleanup);

describe('projects waiting for production approval (P1.21)', () => {
  it('lists only projects with an open request and marks them', async () => {
    render(
      <MemoryRouter initialEntries={['/projects?filter=approvals']}>
        <Projects />
      </MemoryRouter>,
    );
    expect(await screen.findByText('2 approvals')).toBeInTheDocument();
    expect(screen.getByText('shop')).toBeInTheDocument();
    expect(screen.queryByText('billing')).not.toBeInTheDocument();
    expect(screen.getByText('Projects waiting for production approval')).toBeInTheDocument();
  });

  it('points to the filtered list from the full list', async () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Projects />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: 'Show those projects' })).toHaveAttribute(
      'href',
      '/projects?filter=approvals',
    );
    expect(screen.getByText('billing')).toBeInTheDocument();
  });
});
