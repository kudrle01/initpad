import { History, ShieldCheck } from 'lucide-react';
import { Spinner } from '@/components/atoms/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RollbackPreview } from '@/types';

interface Props {
  preview: RollbackPreview | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function short(value: string | null): string {
  return value ? value.slice(0, 7) : 'none';
}

export function RollbackDialog({ preview, busy, onOpenChange, onConfirm }: Props) {
  return (
    <Dialog
      open={preview !== null}
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-lg" hideClose={busy}>
        {preview && (
          <>
            <DialogHeader>
              <DialogTitle>
                <History className="h-[18px] w-[18px] text-warning" /> Roll back {preview.environment}
              </DialogTitle>
              <DialogDescription>
                Publish the previous verified version to the currently assigned target. InitPad
                will not run CI or build new application code.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <span className="text-muted-foreground">Environment</span>
                <span className="text-right font-medium uppercase">{preview.environment}</span>
                <span className="text-muted-foreground">Target</span>
                <span className="break-words text-right font-medium">{preview.target}</span>
                <span className="text-muted-foreground">Current version</span>
                <span className="text-right font-mono">{short(preview.currentVersion)}</span>
                <span className="text-muted-foreground">Rollback version</span>
                <span className="text-right font-mono font-semibold text-warning">
                  {short(preview.rollbackVersion)}
                </span>
                <span className="text-muted-foreground">Verified output</span>
                <span className="break-all text-right font-mono text-xs">
                  {preview.rollbackArtifact
                    ? `sha256:${preview.rollbackArtifact.digest.slice(0, 12)}`
                    : `OCI tag ${short(preview.rollbackVersion)}`}
                </span>
              </div>
            </div>

            <div
              className={
                preview.environment === 'prod'
                  ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm'
                  : 'rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm'
              }
            >
              <p className="font-medium">Impact</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The selected target will replace its current workload with version{' '}
                <span className="font-mono">{short(preview.rollbackVersion)}</span>. Publication
                still has to pass the target health check. Stable-routing targets keep their URL
                and a managed gateway keeps the last healthy revision online until that succeeds;
                a direct-port target may allocate a new port. Current environment variables and
                secrets stay in place; rollback changes application code, not configuration.
              </p>
            </div>

            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                Source deployment succeeded on{' '}
                {new Date(preview.sourceDeployedAt).toLocaleString()}. Any target or environment
                or configuration change after this dialog opened will cancel the request for
                review.
              </span>
            </div>

            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant={preview.environment === 'prod' ? 'destructive' : 'default'}
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <History className="h-4 w-4" />}
                Roll back {preview.environment}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
