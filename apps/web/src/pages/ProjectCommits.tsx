import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CommitList } from '@/components/organisms/CommitList';
import type { Commit, Project } from '@/types';

const HISTORY_LIMIT = 100;

function pipelineActive(commits: Commit[]): boolean {
  if (commits.some((commit) => commit.pipeline.some((stage) => stage.status === 'running'))) {
    return true;
  }
  const head = commits[0];
  return !!head
    && head.pipeline.some((stage) => stage.status === 'pending')
    && !head.pipeline.some((stage) => stage.status === 'failed');
}

export default function ProjectCommits() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [openSha, setOpenSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (!id) return;
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const [projectRow, commitRows] = await Promise.all([
        api.getProject(id),
        api.getCommits(id, HISTORY_LIMIT),
      ]);
      setProject(projectRow);
      setCommits(commitRows);
      setOpenSha((current) => current ?? commitRows[0]?.sha ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setProject(null);
    setCommits([]);
    setOpenSha(null);
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!project || error) return;
    const timer = setTimeout(load, pipelineActive(commits) ? 2500 : 10_000);
    return () => clearTimeout(timer);
  }, [project, commits, error, load]);

  return (
    <div>
      <Link
        to={id ? `/projects/${id}` : '/projects'}
        className="text-link mb-4 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ArrowLeft className="h-4 w-4" /> Back to project
      </Link>

      <PageHeader
        title={project ? `${project.name} · commits` : 'Commit history'}
        subtitle={`The ${HISTORY_LIMIT} most recent commits with their current CI/CD stage state and exact runner links.`}
      />

      {error && (
        <LoadErrorState
          className="mb-4"
          message={error}
          onRetry={() => void load(true)}
        />
      )}
      {loading ? (
        <ContentLoading label="Loading commit history" />
      ) : project ? (
        <CommitList
          commits={commits}
          repoUrl={project.repoUrl}
          scmProvider={project.scm.provider}
          openSha={openSha}
          onToggle={(sha) => setOpenSha((current) => (current === sha ? null : sha))}
          deploymentHistoryUrl={`/projects/${project.id}/deployments`}
        />
      ) : null}
    </div>
  );
}
