import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Search } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ProjectRow } from '@/components/molecules/ProjectRow';
import { EmptyState } from '@/components/molecules/EmptyState';
import { useAuth } from '@/auth';
import type { Project, TemplateManifest } from '@/types';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Record<string, TemplateManifest>>({});
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { activeWorkspace } = useAuth();

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setProjects([]);
    Promise.all([api.listProjects(), api.listTemplates()])
      .then(([projectRows, templateRows]) => {
        if (!current) return;
        setProjects(projectRows);
        setTemplates(Object.fromEntries(templateRows.map((template) => [template.id, template])));
      })
      .catch((e) => current && setError((e as Error).message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [activeWorkspace?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const templateName = templates[p.templateId]?.name ?? p.templateId;
      return p.name.toLowerCase().includes(q) || templateName.toLowerCase().includes(q);
    });
  }, [projects, templates, query]);

  return (
    <div>
      <PageHeader
        title="Projects"
        actions={
          <Button asChild>
            <Link to="/new">
              <Plus className="h-4 w-4" /> New project
            </Link>
          </Button>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {!loading && projects.length > 0 && (
        <div className="relative mb-4 max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects…"
            className="pl-9"
            aria-label="Filter projects"
          />
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2" aria-label="Loading projects" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-[76px] animate-pulse rounded-lg border border-border bg-card/60"
            />
          ))}
        </div>
      ) : projects.length === 0 && !error ? (
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
      ) : filtered.length === 0 && projects.length > 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description={`No projects match “${query.trim()}”.`}
        />
      ) : projects.length > 0 ? (
        <div className="flex flex-col gap-2">
          {filtered.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              templateName={templates[p.templateId]?.name ?? p.templateId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
