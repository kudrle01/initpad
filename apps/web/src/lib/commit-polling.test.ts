import { describe, expect, it } from 'vitest';
import type { Commit } from '@/types';
import { mergeCommitHead } from './commit-polling';

function commit(sha: string): Commit {
  return { sha, message: sha, author: 'tester', date: '2026-01-01', pipeline: [] };
}

describe('mergeCommitHead', () => {
  it('prepends a new head, removes the placeholder and respects the limit', () => {
    const result = mergeCommitHead(
      [commit('initial'), commit('old-1'), commit('old-2')],
      [commit('new')],
      3,
    );
    expect(result.map(({ sha }) => sha)).toEqual(['new', 'old-1', 'old-2']);
  });

  it('does not duplicate an unchanged head', () => {
    const result = mergeCommitHead([commit('head'), commit('old')], [commit('head')], 5);
    expect(result.map(({ sha }) => sha)).toEqual(['head', 'old']);
  });

  it('preserves the current page when the provider returns no commits', () => {
    const current = [commit('head')];
    expect(mergeCommitHead(current, [], 5)).toBe(current);
  });
});
