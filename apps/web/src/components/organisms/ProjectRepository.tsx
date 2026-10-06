import { Link } from 'react-router-dom';
import { ExternalLink, GitBranch } from 'lucide-react';
import { CopyField } from '@/components/molecules/CopyField';
import { DetailSection } from '@/components/molecules/DetailSection';
import { scmLink } from '@/lib/utils';
import type { Project } from '@/types';

export function ProjectRepository({ project }: { project: Project }) {
  const cloneUrl = project.repoUrl ? `${project.repoUrl}.git` : null;

  return (
    <DetailSection title="Repository">
      <div className="flex min-w-0 flex-col gap-3">
        {project.repoUrl && (
          <a
            href={scmLink(project.repoUrl, project.scm.provider)}
            target="_blank"
            rel="noreferrer"
            title={project.repoUrl}
            className="text-link flex min-w-0 items-center gap-2 text-sm font-medium"
          >
            <GitBranch className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{project.scm.fullName}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        )}
        {cloneUrl && <CopyField command={`git clone ${cloneUrl}`} />}
        {project.scm.provider === 'github' ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Private GitHub repository — open it in a browser signed into an authorized GitHub
            account. For cloning, use your normal GitHub credential manager, SSH key or{' '}
            <code className="font-mono">gh auth login</code>.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Private repository — first time?{' '}
            <Link to="/settings/account" className="text-link">
              Connect Git
            </Link>{' '}
            once and cloning works without a password.
          </p>
        )}
      </div>
    </DetailSection>
  );
}
