import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '@/api';
import { Card } from '@/components/ui/card';
import { BackLink } from '@/components/molecules/BackLink';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DeploymentActivity } from '@/components/organisms/DeploymentActivity';
import type { DeploymentOperation, Project } from '@/types';

const HISTORY_LIMIT = 100;

export default function ProjectDeployments() {
  const { id } = useParams();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [operations, setOperations] = useState<DeploymentOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openedFromAudit =
    (location.state as { deploymentHistoryOrigin?: unknown } | null)?.deploymentHistoryOrigin ===
    'audit';
  const backLink = openedFromAudit
    ? { to: '/audit', label: 'Back to audit log' }
    : { to: id ? `/projects/${id}` : '/projects', label: 'Back to project' };

  const load = useCallback(
    async (showLoading = false) => {
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
    },
    [id],
  );

  useEffect(() => {
    setProject(null);
    setOperations([]);
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!project || error) return;
    const active = operations.some((operation) => operation.status === 'running');
    const timer = setTimeout(() => void load(), active ? 2500 : 10_000);
    return () => clearTimeout(timer);
  }, [project, operations, error, load]);

  return (
    <div>
      <BackLink to={backLink.to}>{backLink.label}</BackLink>

      <PageHeader
        title="Deployment history"
        description={project?.name}
        help={[
          {
            title: 'History',
            description: `The ${HISTORY_LIMIT} most recent deployment operations.`,
          },
          {
            title: 'Build reuse',
            description: 'Several deployments can publish the same verified source artifact.',
          },
        ]}
      />

      {error && <LoadErrorState className="mb-4" message={error} onRetry={() => void load(true)} />}
      {loading ? (
        <ContentLoading label="Loading deployment history" />
      ) : project ? (
        <Card className="overflow-hidden">
          <DeploymentActivity
            operations={operations}
            repoUrl={project.repoUrl}
            scmProvider={project.scm.provider}
          />
        </Card>
      ) : null}
    </div>
  );
}
