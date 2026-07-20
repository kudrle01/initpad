import { Fragment } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { StatusDot } from '@/components/atoms/StatusDot';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { cn, scmLink } from '@/lib/utils';
import type { Commit } from '@/types';

// Aggregated commit state derived from its pipeline stages.
function commitStatus(pipeline: { status: string }[]): { label: string; dot: string } {
  if (pipeline.some((s) => s.status === 'failed')) return { label: 'failed', dot: 'failed' };
  if (pipeline.length > 0 && pipeline.every((s) => s.status === 'success'))
    return { label: 'passed', dot: 'success' };
  if (pipeline.some((s) => s.status === 'running')) return { label: 'running', dot: 'running' };
  return { label: 'awaiting CI', dot: 'pending' };
}

interface Props {
  commits: Commit[];
  repoUrl: string | null;
  scmProvider: 'gitea' | 'github';
  openSha: string | null;
  onToggle: (sha: string) => void;
}

export function CommitList({ commits, repoUrl, scmProvider, openSha, onToggle }: Props) {
  if (commits.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground">
        No commits yet — clone the repository and push to trigger the CI/CD pipeline.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {commits.map((c) => {
        const open = openSha === c.sha;
        const ci = commitStatus(c.pipeline);
        return (
          <div key={c.sha}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onToggle(c.sha)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onToggle(c.sha);
              }}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
            >
              <ChevronRight
                className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
              />
              {repoUrl && c.sha !== 'initial' ? (
                <a
                  href={scmLink(`${repoUrl}/commit/${c.sha}`, scmProvider)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={`View commit in ${scmProvider === 'github' ? 'GitHub' : 'Gitea'}`}
                  className="text-link shrink-0 font-mono text-xs"
                >
                  {c.sha.slice(0, 7)}
                </a>
              ) : (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.sha.slice(0, 7)}</span>
              )}
              <span className="flex-1 truncate text-sm">{c.message}</span>
              <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{c.author}</span>
              <StatusBadge status={ci.dot} label={ci.label} kind="ci" className="hidden sm:inline-flex" />
            </div>

            {open && (
              <div className="border-t border-border bg-secondary/30 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {c.pipeline.map((s, i) => (
                    <Fragment key={s.name}>
                      {s.url ? (
                        <a
                          href={scmLink(s.url, scmProvider)}
                          target="_blank"
                          rel="noreferrer"
                          title={`View job log in ${scmProvider === 'github' ? 'GitHub' : 'Gitea'}`}
                          className="text-link inline-flex items-center gap-1.5 rounded-md border border-current/25 bg-card px-2.5 py-1 text-xs font-medium hover:bg-secondary"
                        >
                          <StatusDot status={s.status} kind="ci" /> {s.name}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs">
                          <StatusDot status={s.status} kind="ci" /> {s.name}
                        </span>
                      )}
                      {i < c.pipeline.length - 1 && (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Fragment>
                  ))}
                </div>
                {(() => {
                  const runUrl =
                    c.pipeline.find((s) => s.url)?.url ?? (repoUrl ? `${repoUrl}/actions` : null);
                  if (ci.label === 'awaiting CI') {
                    return (
                      <p className="mt-2.5 text-xs text-muted-foreground">
                        Waiting for the {scmProvider === 'github' ? 'GitHub Actions' : 'Gitea Actions'} runner to pick up this commit.
                      </p>
                    );
                  }
                  return runUrl ? (
                    <a
                      href={scmLink(runUrl, scmProvider)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-link mt-2.5 inline-flex items-center gap-1 text-xs font-medium"
                    >
                      View run &amp; logs in {scmProvider === 'github' ? 'GitHub' : 'Gitea'}{' '}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
