import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommitList } from '@/components/organisms/CommitList';
import { DeploymentActivity } from '@/components/organisms/DeploymentActivity';
import { DetailSection } from '@/components/molecules/DetailSection';
import type { Commit, DeploymentOperation, Project } from '@/types';
import { t } from '@/i18n';

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
        title={t('Deployment activity')}
        flush
        help={[
          {
            title: t('Source build'),
            description: t('CI builds and tests one immutable artifact.'),
          },
          {
            title: t('Deploy and redeploy'),
            description: t('Publish that verified artifact without starting another CI runner.'),
          },
        ]}
        actions={
          deployments.length > DEPLOYMENT_PREVIEW && (
            <ViewAll to={`/projects/${project.id}/deployments`} label={t('Show all deployments')} />
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
        title={t('Commits')}
        flush
        actions={
          commits.length > COMMIT_PREVIEW && (
            <ViewAll to={`/projects/${project.id}/commits`} label={t('Show all commits')} />
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
