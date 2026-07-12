import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cloud, Container, ExternalLink, Layers, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/api';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { cn } from '@/lib/utils';
import type { EnvName, Environment, ProviderKind, Project } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

const ENV_ORDER: Record<EnvName, number> = { dev: 0, test: 1, prod: 2 };
const FILTERS: (EnvName | 'all')[] = ['all', 'dev', 'test', 'prod'];

interface Row {
  project: Project;
  env: Environment;
}

export default function Environments() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EnvName | 'all'>('all');

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo<Row[]>(() => {
    const all = projects.flatMap((p) =>
      p.environments.map((env) => ({ project: p, env })),
    );
    return all
      .filter((r) => filter === 'all' || r.env.name === filter)
      .sort(
        (a, b) =>
          a.project.name.localeCompare(b.project.name) ||
          ENV_ORDER[a.env.name] - ENV_ORDER[b.env.name],
      );
  }, [projects, filter]);

  return (
    <div>
      <PageHeader
        title="Environments"
        subtitle="Every project environment and the target it runs on — across dev, test and prod."
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {!loading && projects.length === 0 && (
        <EmptyState
          icon={Layers}
          title="No environments yet"
          description="Create a project and its dev/test/prod environments will appear here."
        />
      )}

      {!loading && projects.length > 0 && (
        <>
          <div className="mb-4 flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                  filter === f
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Env</th>
                  <th className="px-4 py-2.5 font-medium">Target</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Version</th>
                  <th className="px-4 py-2.5 font-medium">URL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ project, env }) => {
                  const Icon = KIND_ICON[env.provider] ?? Server;
                  return (
                    <tr key={`${project.id}-${env.name}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">
                        <Link to={`/projects/${project.id}`} className="font-medium text-primary hover:underline">
                          {project.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {env.name}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{env.target?.name ?? env.provider}</span>
                          {env.target?.scope === 'user' && (
                            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              yours
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={env.status} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {env.version ? `v${env.version.slice(0, 7)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {env.url ? (
                          <a
                            href={env.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="max-w-[200px] truncate">{env.url.replace(/^https?:\/\//, '')}</span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
