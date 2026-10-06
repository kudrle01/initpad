import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommitList } from '@/components/organisms/CommitList';
import { DeploymentActivity } from '@/components/organisms/DeploymentActivity';
import { DetailSection } from '@/components/molecules/DetailSection';
import type { Commit, DeploymentOperation, Project } from '@/types';

const DEPLOYMENT_PREVIEW = 4;
const COMMIT_PREVIEW = 5;

interface Props {
  project: Project;
  commits: Commit[];
  deployments: DeploymentOperation[];
  openSha: string | null;
  onToggleCommit: (sha: string) => void;
}

function ViewAll({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm">
      <Link to={to}>
        {label} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </Button>
  );
}

export function ProjectHistory({ project, commits, deployments, openSha, onToggleCommit }: Props) {
  return (
    <>
      <DetailSection
        title="Deployment activity"
        flush
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
        actions={
          deployments.length > DEPLOYMENT_PREVIEW && (
            <ViewAll to={`/projects/${project.id}/deployments`} label="Show all deployments" />
          )
        }
      >
        <DeploymentActivity
          operations={deployments}
          repoUrl={project.repoUrl}
          scmProvider={project.scm.provider}
          limit={DEPLOYMENT_PREVIEW}
        />
      </DetailSection>

      <DetailSection
        title="Commits"
        flush
        actions={
          commits.length > COMMIT_PREVIEW && (
            <ViewAll to={`/projects/${project.id}/commits`} label="Show all commits" />
          )
        }
      >
        <CommitList
          commits={commits}
          repoUrl={project.repoUrl}
          scmProvider={project.scm.provider}
          openSha={openSha}
          onToggle={onToggleCommit}
          limit={COMMIT_PREVIEW}
          dense
          deploymentHistoryUrl={`/projects/${project.id}/deployments`}
        />
      </DetailSection>
    </>
  );
}
