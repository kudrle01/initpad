import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { EnvironmentStatusList } from '@/components/molecules/EnvironmentStatusList';
import { listRowClassName, listRowInteractiveClassName } from '@/components/molecules/List';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

// Molecule: project row in a list (template icon, name, environment status).
export function ProjectRow({ project, templateName }: { project: Project; templateName: string }) {
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className={cn(listRowClassName, listRowInteractiveClassName, 'group')}
      >
        <TemplateIcon templateId={project.templateId} language={templateName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={project.name}>
            {project.name}
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
