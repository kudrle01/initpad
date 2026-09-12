import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CommitList } from '@/components/organisms/CommitList';
import { DeploymentActivity } from '@/components/organisms/DeploymentActivity';
import { DetailSection } from '@/components/molecules/DetailSection';
import type { Commit, DeploymentOperation, Project } from '@/types';

interface Props {
  project: Project;
  commits: Commit[];
  deployments: DeploymentOperation[];
  openSha: string | null;
  onToggleCommit: (sha: string) => void;
}

export function ProjectHistory({ project, commits, deployments, openSha, onToggleCommit }: Props) {
  return (
    <>
      <DetailSection
        title="Deployment activity"
        help={[
          {
            title: 'Source build',
            description: 'CI builds and tests one immutable artifact.',
          },
          {
            title: 'Deploy and redeploy',
            description: 'Publish that verified artifact without starting another CI runner.',
          },
        ]}
      >
        <DeploymentActivity
          operations={deployments}
          repoUrl={project.repoUrl}
          scmProvider={project.scm.provider}
          limit={4}
        />
        {deployments.length > 4 && (
          <Link
            to={`/projects/${project.id}/deployments`}
            className="text-link mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium sm:mt-3 sm:min-h-0"
          >
            Show all deployments <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </DetailSection>

      <DetailSection title="Commits">
        <CommitList
          commits={commits}
          repoUrl={project.repoUrl}
          scmProvider={project.scm.provider}
          openSha={openSha}
          onToggle={onToggleCommit}
          limit={5}
          deploymentHistoryUrl={`/projects/${project.id}/deployments`}
        />
        {commits.length > 5 && (
          <Link
            to={`/projects/${project.id}/commits`}
            className="text-link mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium sm:mt-3 sm:min-h-0"
          >
            Show all commits <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </DetailSection>
    </>
  );
}
