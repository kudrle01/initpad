import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DeploymentActivity } from '@/components/organisms/DeploymentActivity';
import type { DeploymentOperation, Project } from '@/types';

const HISTORY_LIMIT = 100;

export default function ProjectDeployments() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [operations, setOperations] = useState<DeploymentOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (!id) return;
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const [projectRow, operationRows] = await Promise.all([
        api.getProject(id),
        api.getDeployments(id, HISTORY_LIMIT),
      ]);
      setProject(projectRow);
      setOperations(operationRows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setProject(null);
    setOperations([]);
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!project || error) return;
    const active = operations.some((operation) => operation.status === 'running');
    const timer = setTimeout(load, active ? 2500 : 10_000);
    return () => clearTimeout(timer);
  }, [project, operations, error, load]);

  return (
    <div>
      <Link
        to={id ? `/projects/${id}` : '/projects'}
        className="text-link mb-4 inline-flex items-center gap-1 text-sm font-medium"
      >
        <ArrowLeft className="h-4 w-4" /> Back to project
      </Link>

      <PageHeader
        title={project ? `${project.name} · deployments` : 'Deployment history'}
        subtitle={`The ${HISTORY_LIMIT} most recent deployment operations. CI build links are grouped by source artifact because multiple deployments can reuse the same verified build.`}
      />

      {error && (
        <LoadErrorState
          className="mb-4"
          message={error}
          onRetry={() => void load(true)}
        />
      )}
      {loading ? (
        <ContentLoading label="Loading deployment history" />
      ) : project ? (
        <DeploymentActivity
          operations={operations}
          repoUrl={project.repoUrl}
          scmProvider={project.scm.provider}
        />
      ) : null}
    </div>
  );
}
