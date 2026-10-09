import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Cloud, Container, Layers, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/api';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { EnvironmentStatusList } from '@/components/molecules/EnvironmentStatusList';
import { SegmentedControl } from '@/components/molecules/SegmentedControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, externalHref } from '@/lib/utils';
import { useAuth } from '@/auth';
import { useLoadable } from '@/hooks/useLoadable';
import type { EnvName, Environment, ProviderKind, Project } from '@/types';
import { t } from '@/i18n';
import { AppUrlLink } from '@/components/molecules/AppUrlLink';

const KIND_ICON: Record<ProviderKind, LucideIcon> = {
  docker: Container,
  sftp: Cloud,
};

const ENV_ORDER: Record<EnvName, number> = { dev: 0, test: 1, prod: 2 };
const FILTERS: (EnvName | 'all')[] = ['all', 'dev', 'test', 'prod'];

const FILTER_OPTIONS = FILTERS.map((value) => ({
  value,
  label: value === 'all' ? t('All') : value,
}));

// One environment = one line. On a phone the version and URL wrap onto a
// second line under the server name; from `md` up everything shares one row.
function EnvironmentRow({ environment }: { environment: Environment }) {
  const Icon = KIND_ICON[environment.provider] ?? Server;
  const targetName = environment.target?.name ?? environment.provider;
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6 md:grid-cols-[3rem_minmax(0,1fr)_7.5rem_5.5rem_minmax(0,1fr)]">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {environment.name}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate" title={targetName}>
          {targetName}
        </span>
        {environment.target?.scope === 'user' && <Badge className="px-2 py-0">{t('yours')}</Badge>}
      </span>
      <StatusBadge status={environment.status} className="justify-self-end md:justify-self-start" />
      <div
        className={cn(
          'col-span-2 col-start-2 min-w-0 items-center gap-3 text-xs text-muted-foreground md:contents',
          // Nothing deployed yet: skip the otherwise empty second line on a phone.
          environment.version || environment.url ? 'flex' : 'hidden',
        )}
      >
        <span className="shrink-0 font-mono">
          {environment.version ? `v${environment.version.slice(0, 7)}` : '—'}
        </span>
        {externalHref(environment.url) ? (
          <AppUrlLink url={environment.url} className="md:text-sm" />
        ) : (
          <span className="hidden md:inline">—</span>
        )}
      </div>
    </li>
  );
}

export default function Environments() {
  const { activeWorkspace } = useAuth();
  const workspaceId = activeWorkspace?.id;
  const [filter, setFilter] = useState<EnvName | 'all'>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const loadProjects = useCallback(
    () => (workspaceId ? api.listProjects() : Promise.resolve([])),
    [workspaceId],
  );
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
      <PageHeader
        title={t('Deployments')}
        description={t('Where every project is running right now, grouped by project.')}
      />

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label={t('Loading environments')} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('No environments yet')}
          description={t(
            'Create a project and its configured deployment environments will appear here.',
          )}
        />
      ) : (
        <>
          <SegmentedControl
            label={t('Filter by environment')}
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
            className="mb-4 capitalize"
          />

          {groups.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={t('No {filter} environments', { filter: filter })}
              description={t(
                "None of this workspace's projects currently has a {filter} environment.",
                { filter: filter },
              )}
            />
          ) : (
            <Card className="divide-y divide-border/70 overflow-hidden">
              {groups.map(({ project, envs }) => {
                const open = !collapsed.has(project.id);
                return (
                  <section
                    key={project.id}
                    aria-label={t('{name} environments', { name: project.name })}
                  >
                    <div className="flex min-w-0 items-center gap-2 bg-muted/50 py-1 pl-2 pr-2 sm:pl-4 sm:pr-4">
                      <button
                        type="button"
                        onClick={() => toggle(project.id)}
                        aria-expanded={open}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-10"
                      >
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            !open && '-rotate-90',
                          )}
                        />
                        <span className="truncate text-sm font-semibold" title={project.name}>
                          {project.name}
                        </span>
                      </button>
                      {!open && (
                        <EnvironmentStatusList
                          environments={envs}
                          className="hidden shrink-0 sm:flex"
                        />
                      )}
                      <Button asChild variant="ghost" size="icon-sm" className="rounded-full">
                        <Link
                          to={`/projects/${project.id}`}
                          title={t('Open project')}
                          aria-label={t('Open {name}', { name: project.name })}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>

                    {open && (
                      <ul className="divide-y divide-border/70 border-t border-border/70">
                        {envs.map((environment) => (
                          <EnvironmentRow key={environment.name} environment={environment} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
