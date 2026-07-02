import { Terminal, RefreshCw } from 'lucide-react';
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
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function EnvLogsDialog({
  env,
  projectName,
  status,
  logsText,
  logsLoading,
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
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              disabled={logsLoading}
              title="Refresh"
              className="ml-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogHeader>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs leading-relaxed text-foreground/90">
          {logsLoading ? 'Loading…' : logsText}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
