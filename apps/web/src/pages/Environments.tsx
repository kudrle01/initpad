import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Cloud,
  Container,
  ExternalLink,
  Layers,
  Server,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/api';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { StatusDot } from '@/components/atoms/StatusDot';
import { cn } from '@/lib/utils';
import type { EnvName, ProviderKind, Project } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

const ENV_ORDER: Record<EnvName, number> = { dev: 0, test: 1, prod: 2 };
const FILTERS: (EnvName | 'all')[] = ['all', 'dev', 'test', 'prod'];

export default function Environments() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EnvName | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(
    () =>
      [...projects]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((project) => ({
          project,
          envs: [...project.environments]
            .filter((e) => filter === 'all' || e.name === filter)
            .sort((a, b) => ENV_ORDER[a.name] - ENV_ORDER[b.name]),
        }))
        .filter((g) => g.envs.length > 0),
    [projects, filter],
  );

  function toggle(id: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <PageHeader
        title="Environments"
        subtitle="Every project environment and the target it runs on — grouped by project."
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

          <div className="flex flex-col gap-3">
            {groups.map(({ project, envs }) => {
              const open = !collapsed.has(project.id);
              return (
                <div key={project.id} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2 bg-secondary/40 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(project.id)}
                      aria-expanded={open}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-medium">{project.name}</span>
                    </button>
                    <div className="hidden items-center gap-2.5 sm:flex">
                      {envs.map((e) => (
                        <span
                          key={e.name}
                          className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground"
                          title={`${e.name}: ${e.status}`}
                        >
                          <StatusDot status={e.status} />
                          {e.name}
                        </span>
                      ))}
                    </div>
                    <Link
                      to={`/projects/${project.id}`}
                      title="Open project"
                      className="text-link shrink-0 p-1"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>

                  {open && (
                    <div className="overflow-x-auto" role="region" aria-label={`${project.name} environments`} tabIndex={0}>
                    <table className="min-w-[680px] w-full text-sm">
                      <tbody>
                        {envs.map((env) => {
                          const Icon = KIND_ICON[env.provider] ?? Server;
                          return (
                            <tr key={env.name} className="border-t border-border">
                              <td className="w-14 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                                    className="text-link inline-flex items-center gap-1"
                                  >
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                    <span className="max-w-[200px] truncate">
                                      {env.url.replace(/^https?:\/\//, '')}
                                    </span>
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
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
