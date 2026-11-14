// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { ImportPreflight } from '@/types';
import { PREFLIGHT_DEBOUNCE_MS, useImportPreflight } from './useImportPreflight';

vi.mock('@/api', () => ({ api: { importPreflight: vi.fn() } }));

function result(repo: string): ImportPreflight {
  return {
    repo,
    branch: 'main',
    runtime: 'node',
    hasDockerfile: true,
    hasCompatibleWorkflow: true,
    canImport: true,
    warnings: [],
  } as unknown as ImportPreflight;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.importPreflight).mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useImportPreflight (race of import preflight)', () => {
  it('runs automatically after the selection settles', async () => {
    vi.mocked(api.importPreflight).mockResolvedValue(result('acme/a'));
    const { result: hook } = renderHook(() => useImportPreflight('a', 'node'));
    expect(hook.current.checking).toBe(true);
    expect(api.importPreflight).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFLIGHT_DEBOUNCE_MS);
    });
    expect(api.importPreflight).toHaveBeenCalledTimes(1);
    expect(hook.current.preflight?.repo).toBe('acme/a');
    expect(hook.current.checking).toBe(false);
  });

  it('never lets a slow answer for an earlier repository unlock the current one', async () => {
    const slow = deferred<ImportPreflight>();
    const fast = deferred<ImportPreflight>();
    vi.mocked(api.importPreflight)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);

    const { result: hook, rerender } = renderHook(({ repo }) => useImportPreflight(repo, 'node'), {
      initialProps: { repo: 'a' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFLIGHT_DEBOUNCE_MS);
    });

    rerender({ repo: 'b' });
    expect(hook.current.preflight).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFLIGHT_DEBOUNCE_MS);
    });

    await act(async () => {
      slow.resolve(result('acme/a'));
      await Promise.resolve();
    });
    expect(hook.current.preflight).toBeNull();
    expect(hook.current.checking).toBe(true);

    await act(async () => {
      fast.resolve(result('acme/b'));
      await Promise.resolve();
    });
    expect(hook.current.preflight?.repo).toBe('acme/b');
  });

  it('does not call the API before both choices are made', async () => {
    renderHook(() => useImportPreflight('', 'node'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREFLIGHT_DEBOUNCE_MS * 2);
    });
    expect(api.importPreflight).not.toHaveBeenCalled();
  });
});
