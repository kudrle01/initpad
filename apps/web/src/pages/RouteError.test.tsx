// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RouteError from './RouteError';

const mocks = vi.hoisted(() => ({
  error: new Error('none'),
  reload: vi.fn<() => boolean>(),
}));

vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useRouteError: () => mocks.error,
}));
vi.mock('@/lib/stale-build', async (original) => ({
  ...(await original<typeof import('@/lib/stale-build')>()),
  reloadForNewBuild: () => mocks.reload(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const staleChunk = new TypeError(
  'Failed to fetch dynamically imported module: https://x/assets/Dashboard-Bfodxi2V.js',
);

describe('RouteError after a release replaced the web bundle (ADR-169)', () => {
  it('reloads once to open the new version', () => {
    mocks.error = staleChunk;
    mocks.reload.mockReturnValue(true);
    render(<RouteError />);

    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Loading the new version…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reload/ })).not.toBeInTheDocument();
  });

  it('offers a manual reload instead of looping when the reload just happened', () => {
    mocks.error = staleChunk;
    mocks.reload.mockReturnValue(false);
    render(<RouteError />);

    expect(screen.getByText('InitPad was updated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload/ })).toBeInTheDocument();
  });
});
