import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Search } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ProjectRow } from '@/components/molecules/ProjectRow';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { useAuth } from '@/auth';
import { useLoadable } from '@/hooks/useLoadable';
import type { Project, TemplateManifest } from '@/types';

export default function Projects() {
  const [query, setQuery] = useState('');
  const { activeWorkspace } = useAuth();
  const workspaceId = activeWorkspace?.id;
  const loadProjects = useCallback(async () => {
    if (!workspaceId) return { projects: [], templates: {} };
    const [projects, templateRows] = await Promise.all([api.listProjects(), api.listTemplates()]);
    return {
      projects,
      templates: Object.fromEntries(templateRows.map((template) => [template.id, template])),
    };
  }, [workspaceId]);
  const {
    data: { projects, templates },
    loading,
    error,
    reload,
  } = useLoadable<{ projects: Project[]; templates: Record<string, TemplateManifest> }>(
    loadProjects,
    { projects: [], templates: {} },
  );

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

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label="Loading projects" />
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
