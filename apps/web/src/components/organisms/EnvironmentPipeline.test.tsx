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

function project(environments: Environment[], overrides: Partial<Project> = {}): Project {
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
    pipelinePreset: 'dev-test-prod',
    latestVerifiedArtifact: null,
    environments,
    ...overrides,
  };
}

function renderPipeline(environments: Environment[], overrides: Partial<Project> = {}) {
  render(
    <MemoryRouter>
      <EnvironmentPipeline
        project={project(environments, overrides)}
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

describe('EnvironmentPipeline presets', () => {
  it('renders the complete default pipeline in configured order', () => {
    renderPipeline([environment(), environment({ name: 'test' }), environment({ name: 'prod' })]);

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['dev', 'test', 'prod']);
  });

  it('derives the next stage from the configured environment list', () => {
    renderPipeline(
      [
        environment({ status: 'running', version: 'a'.repeat(40) }),
        environment({ name: 'prod', target: { ...environment().target!, id: 'target-prod' } }),
      ],
      { pipelinePreset: 'dev-prod' },
    );

    expect(screen.getByTitle(/request va+ from dev for production/i)).toBeInTheDocument();
    expect(screen.queryByText(/^test$/i)).not.toBeInTheDocument();
  });

  it('shows the latest verified build as the only production source for prod-only', () => {
    renderPipeline([environment({ name: 'prod' })], {
      pipelinePreset: 'prod-only',
      latestVerifiedArtifact: {
        id: 'artifact-1',
        version: 'b'.repeat(40),
        provider: 'github-actions',
        digest: 'd'.repeat(64),
        runId: 'run-1',
      },
    });

    expect(screen.getByText('Verified build')).toBeInTheDocument();
    expect(screen.getByText(`v${'b'.repeat(7)}`)).toBeInTheDocument();
    expect(screen.getByTitle(/request this verified build for production/i)).toBeEnabled();
  });
});

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
