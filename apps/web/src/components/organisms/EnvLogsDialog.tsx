import { Terminal, RefreshCw, ScrollText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import type { EnvName } from '@/types';

interface Props {
  env: EnvName | null;
  projectName: string;
  status?: string;
  logsText: string;
  logsLoading: boolean;
  // Link to the CI runner logs (Gitea Actions) for the latest run — the build
  // and deploy pipeline output, distinct from the running app's own logs.
  runnerUrl?: string | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function EnvLogsDialog({
  env,
  projectName,
  status,
  logsText,
  logsLoading,
  runnerUrl,
  onOpenChange,
  onRefresh,
}: Props) {
  return (
    <Dialog open={!!env} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-6">
            <DialogTitle className="min-w-0">
              <Terminal className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {projectName} · {env}
              </span>
            </DialogTitle>
            {status && <StatusBadge status={status} />}
            {runnerUrl && (
              <Button asChild variant="secondary" size="sm" className="ml-auto">
                <a href={runnerUrl} target="_blank" rel="noreferrer" title="Build & deploy logs from the CI runner">
                  <ScrollText className="h-3.5 w-3.5" /> Runner logs
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              disabled={logsLoading}
              title="Refresh"
              className={runnerUrl ? '' : 'ml-auto'}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogHeader>
        <p className="mb-1.5 text-xs text-muted-foreground">
          Application output. For build &amp; deploy steps see{' '}
          {runnerUrl ? (
            <a href={runnerUrl} target="_blank" rel="noreferrer" className="text-link">
              the runner logs
            </a>
          ) : (
            'the runner logs in Gitea'
          )}
          .
        </p>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs leading-relaxed text-foreground/90">
          {logsLoading ? 'Loading…' : logsText}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
