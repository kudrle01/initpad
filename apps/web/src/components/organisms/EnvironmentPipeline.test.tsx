// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment, Project } from '@/types';
import { EnvironmentPipeline } from './EnvironmentPipeline';

afterEach(cleanup);

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    name: 'dev',
    provider: 'docker',
    status: 'empty',
    version: null,
    url: null,
    statusReason: null,
    deploymentRequired: false,
    artifact: null,
    workspaceAccessStatus: 'active',
    target: {
      id: 'target-1',
      name: 'InitPad Agent',
      kind: 'docker',
      scope: 'user',
      host: null,
      managementState: 'active',
    },
    ...overrides,
  };
}

function project(environments: Environment[]): Project {
  return {
    id: 'project-1',
    workspaceId: 'workspace-1',
    name: 'Example',
    templateId: 'react-vite',
    repoPath: 'acme/example',
    repoUrl: 'https://github.com/acme/example',
    scm: {
      provider: 'github',
      repositoryId: '1',
      owner: 'acme',
      name: 'example',
      fullName: 'acme/example',
      defaultBranch: 'main',
      repoUrl: 'https://github.com/acme/example',
      installationId: 'installation-1',
    },
    createdAt: '2026-09-15T10:00:00.000Z',
    lastCommit: 'Initial commit',
    environments,
  };
}

function renderPipeline(environments: Environment[]) {
  render(
    <MemoryRouter>
      <EnvironmentPipeline
        project={project(environments)}
        busy={null}
        commitsBySha={{}}
        onPromote={vi.fn()}
        onRedeploy={vi.fn()}
        onRollback={vi.fn()}
        onRunAgain={vi.fn()}
        onRerunFailedJobs={vi.fn()}
        onStop={vi.fn()}
        onStart={vi.fn()}
        onRemoveEnv={vi.fn()}
        onConfigureTarget={vi.fn()}
        onDiagnostics={vi.fn()}
        canRollback
      />
    </MemoryRouter>,
  );
}

describe('EnvironmentPipeline workspace access', () => {
  it('shows one actionable pause explanation instead of suggesting an impossible deploy', () => {
    renderPipeline([
      environment({
        status: 'failed',
        deploymentRequired: true,
        workspaceAccessStatus: 'disabled',
        statusReason: 'Workspace access to this server is paused; new deployments are disabled.',
      }),
    ]);

    expect(screen.getByText(/workspace access is paused/i)).toBeInTheDocument();
    expect(
      screen.getByText(/target change pending — resume workspace access before deploying/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/target changed — deploy to apply it/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage access/i })).toHaveAttribute(
      'href',
      '/infrastructure',
    );
  });

  it('keeps safe existing-workload controls but hides publication actions while paused', async () => {
    const user = userEvent.setup();
    renderPipeline([
      environment({
        status: 'running',
        version: 'a'.repeat(40),
        url: 'http://agent.example.test:32000',
        workspaceAccessStatus: 'disabled',
      }),
    ]);

    await user.click(screen.getByRole('button', { name: /environment actions/i }));

    expect(screen.getByRole('menuitem', { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /remove deployment/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change target/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /redeploy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /roll back/i })).not.toBeInTheDocument();
  });
});

describe('EnvironmentPipeline expiry', () => {
  it('shows scheduled cleanup before the warning window begins', () => {
    renderPipeline([
      environment({
        status: 'running',
        version: 'a'.repeat(40),
        expiresAt: '2030-01-01T12:00:00.000Z',
        expiryWarningAt: '2030-01-01T11:45:00.000Z',
      }),
    ]);

    const notice = screen.getByText(/scheduled cleanup/i).closest('div');
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveClass('text-muted-foreground');
    expect(notice).not.toHaveClass('text-warning');
  });

  it('emphasizes scheduled cleanup once the warning window begins', () => {
    renderPipeline([
      environment({
        status: 'running',
        version: 'a'.repeat(40),
        expiresAt: '2020-01-01T12:00:00.000Z',
        expiryWarningAt: '2020-01-01T11:45:00.000Z',
      }),
    ]);

    const notice = screen.getByText(/scheduled cleanup/i).closest('div');
    expect(notice).toHaveClass('text-warning');
  });
});
