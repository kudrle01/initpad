import { GitBranch, MoreHorizontal, Trash2 } from 'lucide-react';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BackLink } from '@/components/molecules/BackLink';
import { Notice } from '@/components/molecules/Notice';
import { scmLink } from '@/lib/utils';
import type { Project, ProvisioningStatus, TemplateManifest } from '@/types';
import { t, formatDate } from '@/i18n';
import { statusLabel, termLabel } from '@/i18n/labels';

interface Props {
  project: Project;
  template: TemplateManifest | null;
  provisioning: ProvisioningStatus | null;
  canMaintain: boolean;
  onDelete: () => void;
}

export function ProjectSummary({ project, template, provisioning, canMaintain, onDelete }: Props) {
  const created = formatDate(project.createdAt);

  return (
    <div>
      <BackLink to="/projects">{t('Projects')}</BackLink>

      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <TemplateIcon templateId={project.templateId} language={template?.language} size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
              {project.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('{template} · created {date}', {
                template: template?.name ?? project.templateId,
                date: created,
              })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {project.repoUrl && (
            <Button asChild variant="secondary" size="icon" className="sm:w-auto sm:px-4">
              <a
                href={scmLink(project.repoUrl, project.scm.provider)}
                target="_blank"
                rel="noreferrer"
                aria-label={t('Open repository')}
              >
                <GitBranch className="h-4 w-4" />
                <span className="hidden sm:inline">{t('Open repo')}</span>
              </a>
            </Button>
          )}
          {canMaintain && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label={t('More actions')}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem destructive onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" /> {t('Delete project')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ProvisioningNotice provisioning={provisioning} />
    </div>
  );
}

function ProvisioningNotice({ provisioning }: { provisioning: ProvisioningStatus | null }) {
  if (!provisioning || provisioning.status === 'succeeded') return null;
  const failed = ['failed', 'interrupted'].includes(provisioning.status);

  return (
    <Notice
      tone={failed ? 'danger' : 'info'}
      role={failed ? 'alert' : 'status'}
      className="mt-5"
      title={
        failed
          ? t('Setup ({kind}) failed at the {step} step', {
              kind: termLabel(provisioning.kind),
              step: provisioning.step,
            })
          : t('Setting up ({kind})…', { kind: termLabel(provisioning.kind) })
      }
    >
      {failed
        ? (provisioning.message ?? t('No further detail was recorded.'))
        : t('Current step: {step}.', { step: provisioning.step })}
      {provisioning.effects.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-current/15 pt-2">
          {provisioning.effects.map((effect) => (
            <li
              key={effect.key}
              className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-3"
            >
              <span>
                {effect.kind === 'collaborator' ? t('Repository access') : termLabel(effect.kind)}
              </span>
              <span className="break-words font-mono sm:text-right">
                {['compensation_failed', 'reconciliation_required'].includes(effect.status)
                  ? t('cleanup required')
                  : statusLabel(effect.status).replaceAll('_', ' ')}
                {effect.error ? ` — ${effect.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}
