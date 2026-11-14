import { Link } from 'react-router-dom';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { plural } from '@/i18n';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { EnvironmentStatusList } from '@/components/molecules/EnvironmentStatusList';
import { listRowClassName, listRowInteractiveClassName } from '@/components/molecules/List';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

// Molecule: project row in a list (template icon, name, environment status).
export function ProjectRow({
  project,
  templateName,
  pendingApprovals = 0,
}: {
  project: Project;
  templateName: string;
  pendingApprovals?: number;
}) {
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className={cn(listRowClassName, listRowInteractiveClassName, 'group')}
      >
        <TemplateIcon templateId={project.templateId} language={templateName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium" title={project.name}>
              {project.name}
            </span>
            {pendingApprovals > 0 && (
              <Badge variant="warning" className="shrink-0">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {plural('{count} approvals', pendingApprovals)}
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{templateName}</div>
          <EnvironmentStatusList environments={project.environments} className="mt-1.5 sm:hidden" />
        </div>
        <EnvironmentStatusList
          environments={project.environments}
          className="hidden shrink-0 justify-end sm:flex"
        />
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </Link>
    </li>
  );
}
