import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon, GitCommit } from 'lucide-react';
import { api } from '@/api';
import { Card } from '@/components/ui/card';
import { List, ListRow } from '@/components/molecules/List';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { StatusDot } from '@/components/atoms/StatusDot';
import { useAuth } from '@/auth';
import { useLoadable } from '@/hooks/useLoadable';
import type { ActivityEvent } from '@/types';
import { t, relativeTime } from '@/i18n';

export default function Activity() {
  const { activeWorkspace } = useAuth();
  const workspaceId = activeWorkspace?.id;
  const loadEvents = useCallback(
    () => (workspaceId ? api.getActivity() : Promise.resolve([])),
    [workspaceId],
  );
  const { data: events, loading, error, reload } = useLoadable<ActivityEvent[]>(loadEvents, []);

  return (
    <div>
      <PageHeader
        title={t('Development activity')}
        description={t('Recent commits and their pipeline runs across this workspace.')}
      />

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label={t('Loading activity')} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title={t('No activity yet')}
          description={t('Commits and CI runs across your projects will show up here.')}
        />
      ) : (
        <Card className="overflow-hidden">
          <List>
            {events.map((e) => (
              <ListRow key={`${e.projectId}-${e.sha}`} className="items-start">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <GitCommit className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <Link
                      to={`/projects/${e.projectId}`}
                      className="text-link min-w-0 truncate text-sm font-medium"
                      title={e.projectName}
                    >
                      {e.projectName}
                    </Link>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {e.sha !== 'initial' ? e.sha.slice(0, 7) : '—'}
                    </span>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {relativeTime(e.date)}
                    </span>
                  </div>
                  <div className="truncate text-sm" title={e.message}>
                    {e.message}
                  </div>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {e.pipeline.map((s) => {
                      const inner = (
                        <>
                          <StatusDot status={s.status} kind="ci" /> {s.name}
                        </>
                      );
                      return s.source === 'platform' ? (
                        <Link
                          key={s.name}
                          to={`/projects/${e.projectId}/deployments`}
                          title={t('View InitPad deployment history')}
                          className="text-link flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {inner}
                        </Link>
                      ) : s.url ? (
                        <a
                          key={s.name}
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-link flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {inner}
                        </a>
                      ) : (
                        <span
                          key={s.name}
                          className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground"
                        >
                          {inner}
                        </span>
                      );
                    })}
                    <span className="min-w-0 truncate text-muted-foreground" title={e.author}>
                      · {e.author}
                    </span>
                  </div>
                </div>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
