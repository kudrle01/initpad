import type { Commit } from '@/types';

export const ACTIVE_PROJECT_POLL_MS = 4_000;
export const IDLE_PROJECT_POLL_MS = 30_000;

export function mergeCommitHead(
  current: Commit[],
  incoming: Commit[],
  limit: number,
): Commit[] {
  const head = incoming[0];
  if (!head) return current;
  return [
    head,
    ...current.filter((commit) => commit.sha !== head.sha && commit.sha !== 'initial'),
  ].slice(0, limit);
}
