import { useEffect, useState } from 'react';
import { api } from '@/api';

export interface PendingApprovals {
  total: number;
  byProject: Record<string, number>;
}

const EMPTY: PendingApprovals = { total: 0, byProject: {} };
export const PENDING_APPROVALS_POLL_MS = 60_000;

/**
 * Production requests waiting for review in the active workspace, read from
 * the portfolio. Refreshes while the tab is visible; failures keep the last
 * known value because the badge is only a pointer, not the source of truth.
 */
export function usePendingApprovals(workspaceId: string | undefined): PendingApprovals {
  const [state, setState] = useState<PendingApprovals>(EMPTY);

  useEffect(() => {
    setState(EMPTY);
    if (!workspaceId) return;
    let current = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .getWorkspacePortfolio(workspaceId)
        .then((portfolio) => {
          if (!current) return;
          const byProject: Record<string, number> = {};
          for (const project of portfolio.projects) {
            if (project.pendingApprovals > 0) byProject[project.id] = project.pendingApprovals;
          }
          setState({ total: portfolio.stats.pendingApprovals, byProject });
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, PENDING_APPROVALS_POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [workspaceId]);

  return state;
}
