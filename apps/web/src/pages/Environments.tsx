import { useCallback, useMemo, useState } from 'react';
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
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { StatusDot } from '@/components/atoms/StatusDot';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth';
import { useLoadable } from '@/hooks/useLoadable';
import type { EnvName, Environment, ProviderKind, Project } from '@/types';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  ssh: Server,
  sftp: Cloud,
};

const ENV_ORDER: Record<EnvName, number> = { dev: 0, test: 1, prod: 2 };
const FILTERS: (EnvName | 'all')[] = ['all', 'dev', 'test', 'prod'];

function MobileEnvironmentCard({ environment }: { environment: Environment }) {
  const Icon = KIND_ICON[environment.provider] ?? Server;
  return (
    <div className="border-t border-border p-3 md:hidden">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {environment.name}
        </span>
        <StatusBadge status={environment.status} />
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1.5 text-sm">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{environment.target?.name ?? environment.provider}</span>
        {environment.target?.scope === 'user' && (
          <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            yours
          </span>
        )}
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="shrink-0 font-mono">
          {environment.version ? `v${environment.version.slice(0, 7)}` : 'No deployment'}
        </span>
        {environment.url && (
          <a
            href={environment.url}
            target="_blank"
            rel="noreferrer"
            className="text-link flex min-w-0 items-center gap-1"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{environment.url.replace(/^https?:\/\//, '')}</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default function Environments() {
  const { activeWorkspace } = useAuth();
  const [filter, setFilter] = useState<EnvName | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const loadProjects = useCallback(() => api.listProjects(), [activeWorkspace?.id]);
  const { data: projects, loading, error, reload } = useLoadable<Project[]>(loadProjects, []);

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
      <PageHeader title="Environments" />

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label="Loading environments" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No environments yet"
          description="Create a project and its dev/test/prod environments will appear here."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
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

          {groups.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={`No ${filter} environments`}
              description={`None of this workspace's projects currently has a ${filter} environment.`}
            />
          ) : (
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
                    <div>
                      {envs.map((environment) => (
                        <MobileEnvironmentCard key={environment.name} environment={environment} />
                      ))}
                      <div className="hidden overflow-x-auto md:block" role="region" aria-label={`${project.name} environments`} tabIndex={0}>
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
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
