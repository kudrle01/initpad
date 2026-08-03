import { Link } from 'react-router-dom';
import { ArrowLeft, GitBranch, MoreHorizontal, Trash2 } from 'lucide-react';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, scmLink } from '@/lib/utils';
import type { Project, ProvisioningStatus, TemplateManifest } from '@/types';

interface Props {
  project: Project;
  template: TemplateManifest | null;
  provisioning: ProvisioningStatus | null;
  canMaintain: boolean;
  onDelete: () => void;
}

export function ProjectSummary({
  project,
  template,
  provisioning,
  canMaintain,
  onDelete,
}: Props) {
  const created = new Date(project.createdAt).toLocaleDateString('en-GB');

  return (
    <>
      <Link
        to="/projects"
        className="text-link mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium sm:mb-4 sm:min-h-0"
      >
        <ArrowLeft className="h-4 w-4" /> Projects
      </Link>

      <div className="flex items-start justify-between gap-3 sm:items-center sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TemplateIcon templateId={project.templateId} language={template?.language} />
          <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {project.repoUrl && (
            <Button asChild variant="secondary" size="icon" className="sm:w-auto sm:px-4">
              <a
                href={scmLink(project.repoUrl, project.scm.provider)}
                target="_blank"
                rel="noreferrer"
                aria-label="Open repository"
              >
                <GitBranch className="h-4 w-4" />
                <span className="hidden sm:inline">Open repo</span>
              </a>
            </Button>
          )}
          {canMaintain && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem destructive onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" /> Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {template?.name ?? project.templateId} · created {created}
      </p>

      <ProvisioningNotice provisioning={provisioning} />
    </>
  );
}

function ProvisioningNotice({ provisioning }: { provisioning: ProvisioningStatus | null }) {
  if (!provisioning || provisioning.status === 'succeeded') return null;
  const failed = ['failed', 'interrupted'].includes(provisioning.status);

  return (
    <div
      className={cn(
        'mt-4 rounded-md border p-3 text-sm',
        failed
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-border bg-secondary/50 text-muted-foreground',
      )}
      role={failed ? 'alert' : 'status'}
    >
      {failed
        ? `Setup (${provisioning.kind}) failed at the ${provisioning.step} step${provisioning.message ? `: ${provisioning.message}` : '.'}`
        : `Setting up (${provisioning.kind})… current step: ${provisioning.step}.`}
      {provisioning.effects.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-current/15 pt-2 text-xs">
          {provisioning.effects.map((effect) => (
            <li key={effect.key} className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-3">
              <span>{effect.kind === 'collaborator' ? 'Repository access' : effect.kind}</span>
              <span className="break-words font-mono sm:text-right">
                {['compensation_failed', 'reconciliation_required'].includes(effect.status)
                  ? 'cleanup required'
                  : effect.status.replaceAll('_', ' ')}
                {effect.error ? ` — ${effect.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
