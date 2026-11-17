import { useCallback, useState } from 'react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { useConfirmation } from '@/confirmation';
import { useToast } from '@/toast';
import { t } from '@/i18n';
import type { Project } from '@/types';

/**
 * Re-runs the failed jobs of a commit's GitHub Actions run after confirmation.
 * Returns no handler when the viewer may not do it, so the list hides the button.
 */
export function useCommitRerun(project: Project | null, onStarted: () => void) {
  const { workspaces } = useAuth();
  const confirmAction = useConfirmation();
  const toast = useToast();
  const [rerunning, setRerunning] = useState<string | null>(null);
  const role = workspaces.find((workspace) => workspace.id === project?.workspaceId)?.role;
  const projectId = project?.id;

  const rerun = useCallback(
    async (sha: string) => {
      if (!projectId) return;
      const confirmed = await confirmAction({
        title: t('Re-run failed jobs of {sha}?', { sha: sha.slice(0, 7) }),
        description: t(
          'GitHub runs the failed jobs of this commit again. When they pass, the build reports to InitPad like any other run.',
        ),
        confirmLabel: t('Re-run failed jobs'),
      });
      if (!confirmed) return;
      setRerunning(sha);
      try {
        const { runId } = await api.rerunCommitFailedJobs(projectId, sha);
        toast.success(t('GitHub is re-running failed jobs from run {runId}.', { runId }));
        onStarted();
      } catch (error) {
        toast.error((error as Error).message);
      } finally {
        setRerunning(null);
      }
    },
    [projectId, confirmAction, toast, onStarted],
  );

  const allowed = project?.scm.provider === 'github' && role !== undefined && role !== 'viewer';
  return { onRerun: allowed ? rerun : undefined, rerunning };
}
