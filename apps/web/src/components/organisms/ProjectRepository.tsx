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
      {project.repoUrl && (
        <a
          href={scmLink(project.repoUrl, project.scm.provider)}
          target="_blank"
          rel="noreferrer"
          className="text-link mb-2 inline-flex max-w-full items-start gap-1.5 break-all text-sm font-medium"
        >
          <GitBranch className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{project.repoUrl}</span>
          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
        </a>
      )}
      {cloneUrl && <CopyField command={`git clone ${cloneUrl}`} />}
      {project.scm.provider === 'github' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Private GitHub repository — open it in a browser signed into an authorized GitHub
          account. For cloning, use your normal GitHub credential manager, SSH key or{' '}
          <code className="font-mono">gh auth login</code>.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Private repository — first time?{' '}
          <Link to="/settings/account" className="text-link">
            Connect Git
          </Link>{' '}
          once and cloning works without a password.
        </p>
      )}
    </DetailSection>
  );
}
