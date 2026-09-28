// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommitList } from './CommitList';

afterEach(cleanup);

describe('CommitList', () => {
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
