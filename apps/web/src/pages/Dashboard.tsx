import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers, Play, Plus, Server } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { ProjectRow } from '@/components/molecules/ProjectRow';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { Project, TemplateManifest } from '@/types';

const RECENT_LIMIT = 6;

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Record<string, TemplateManifest>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message));
    api
      .listTemplates()
      .then((all) => setTemplates(Object.fromEntries(all.map((t) => [t.id, t]))))
      .catch(() => {});
  }, []);

  const running = projects.reduce(
    (n, p) => n + p.environments.filter((e) => e.status === 'running').length,
    0,
  );
  const recent = projects.slice(0, RECENT_LIMIT);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your projects and their environments."
        actions={
          <Button asChild>
            <Link to="/new">
              <Plus className="h-4 w-4" /> New project
            </Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Projects" value={projects.length} icon={Layers} />
        <StatCard label="Running deploys" value={running} icon={Play} />
        <StatCard label="Environments" value={3} icon={Server} />
      </div>

      <div className="mb-3 flex items-baseline justify-between gap-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent projects
        </p>
        {projects.length > 0 && (
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No projects yet"
          description="Create your first project from a template — you'll get a Git repository, CI/CD pipeline and a running dev environment out of the box."
          action={
            <Button asChild>
              <Link to="/new">
                <Plus className="h-4 w-4" /> New project
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              templateName={templates[p.templateId]?.name ?? p.templateId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
