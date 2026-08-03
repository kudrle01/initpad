import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { TemplateIcon } from '@/components/atoms/TemplateIcon';
import { StatusDot } from '@/components/atoms/StatusDot';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import type { Project } from '@/types';

// Molecule: project row in a list (template icon, name, environment badges).
export function ProjectRow({ project, templateName }: { project: Project; templateName: string }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <TemplateIcon templateId={project.templateId} language={templateName} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="truncate text-xs text-muted-foreground">{templateName}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 sm:hidden">
          {project.environments.map((environment) => (
            <span
              key={environment.name}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              <StatusDot status={environment.status} /> {environment.name}
            </span>
          ))}
        </div>
      </div>
      <div className="hidden flex-wrap items-center justify-end gap-1.5 sm:flex">
        {project.environments.map((e) => (
          <StatusBadge
            key={e.name}
            status={e.status}
            label={`${e.name} ${e.version ? `v${e.version.slice(0, 7)}` : '—'}`}
          />
        ))}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
