// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitList } from './CommitList';

afterEach(cleanup);

describe('CommitList', () => {
  it('lists the steps of each job, linked to the step log', () => {
    render(
      <CommitList
        commits={[
          {
            sha: 'c'.repeat(40),
            message: 'Add tests',
            author: 'Ada',
            date: '2026-09-28T12:00:00Z',
            pipeline: [
              {
                name: 'build',
                status: 'failed',
                url: 'https://github.com/acme/app/actions/runs/1/job/2',
                steps: [
                  { name: 'test', status: 'failed', url: 'https://github.com/x#step:3:1' },
                  { name: 'build image', status: 'pending', url: null },
                ],
              },
              { name: 'lint', status: 'success' },
            ],
          },
        ]}
        repoUrl="https://github.com/acme/app"
        scmProvider="github"
        openSha={'c'.repeat(40)}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('Steps of build')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'test' })).toHaveAttribute(
      'href',
      'https://github.com/x#step:3:1',
    );
    expect(screen.getByText('build image')).toBeInTheDocument();
    expect(screen.queryByText('Steps of lint')).not.toBeInTheDocument();
  });

  it('offers a re-run only for a commit whose CI failed, without toggling it', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onRerun = vi.fn();
    const commit = (sha: string, status: 'failed' | 'success') => ({
      sha,
      message: `Commit ${status}`,
      author: 'Ada',
      date: '2026-09-28T12:00:00Z',
      pipeline: [{ name: 'build', status }],
    });

    render(
      <CommitList
        commits={[commit('a'.repeat(40), 'failed'), commit('b'.repeat(40), 'success')]}
        repoUrl="https://github.com/acme/app"
        scmProvider="github"
        openSha={null}
        onToggle={onToggle}
        onRerun={onRerun}
      />,
    );

    const buttons = screen.getAllByRole('button', { name: /re-run failed jobs of/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('title', 'Re-run failed jobs on GitHub');

    await user.click(buttons[0]);
    expect(onRerun).toHaveBeenCalledWith('a'.repeat(40));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('keeps the disclosure and external commit link as separate controls', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <CommitList
        commits={[
          {
            sha: 'abcdef0123456789',
            message: 'Make deployment accessible',
            author: 'Ada',
            date: '2026-09-28T12:00:00Z',
            pipeline: [{ name: 'build', status: 'success' }],
          },
        ]}
        repoUrl="https://github.com/acme/app"
        scmProvider="github"
        openSha={null}
        onToggle={onToggle}
      />,
    );

    const disclosure = screen.getByRole('button', {
      name: /expand commit abcdef0: make deployment accessible/i,
    });
    const commitLink = screen.getByRole('link', { name: 'abcdef0' });

    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveAttribute('aria-controls');
    expect(disclosure).not.toContainElement(commitLink);

    await user.click(disclosure);
    expect(onToggle).toHaveBeenCalledWith('abcdef0123456789');
  });
});
