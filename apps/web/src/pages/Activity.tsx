import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity as ActivityIcon, GitCommit } from 'lucide-react';
import { api } from '@/api';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { StatusDot } from '@/components/atoms/StatusDot';
import { useAuth } from '@/auth';
import { useLoadable } from '@/hooks/useLoadable';
import type { ActivityEvent } from '@/types';

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB');
}

export default function Activity() {
  const { activeWorkspace } = useAuth();
  const loadEvents = useCallback(() => api.getActivity(), [activeWorkspace?.id]);
  const { data: events, loading, error, reload } = useLoadable<ActivityEvent[]>(loadEvents, []);

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle="Recent commits and their CI / deploy pipeline across all your projects."
      />

      {error ? (
        <LoadErrorState message={error} onRetry={reload} />
      ) : loading ? (
        <ContentLoading label="Loading activity" />
      ) : events.length === 0 ? (
        <EmptyState
          icon={ActivityIcon}
          title="No activity yet"
          description="Commits and CI runs across your projects will show up here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <div
              key={`${e.projectId}-${e.sha}`}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              <GitCommit className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    to={`/projects/${e.projectId}`}
                    className="text-link text-sm font-medium"
                  >
                    {e.projectName}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.sha !== 'initial' ? e.sha.slice(0, 7) : '—'}
                  </span>
                  <span className="ml-0 shrink-0 text-xs text-muted-foreground sm:ml-auto">
                    {relTime(e.date)}
                  </span>
                </div>
                <div className="truncate text-sm" title={e.message}>
                  {e.message}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
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
                        title="View InitPad deployment history"
                        className="text-link flex items-center gap-1 text-[11px]"
                      >
                        {inner}
                      </Link>
                    ) : s.url ? (
                      <a
                        key={s.name}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-link flex items-center gap-1 text-[11px]"
                      >
                        {inner}
                      </a>
                    ) : (
                      <span
                        key={s.name}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground"
                      >
                        {inner}
                      </span>
                    );
                  })}
                  <span className="text-[11px] text-muted-foreground">· {e.author}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
