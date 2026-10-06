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
import { t, rich, formatDateTime } from '@/i18n';

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
                <History className="h-[18px] w-[18px] text-warning" />{' '}
                {preview.environment === 'prod'
                  ? t('Request production rollback')
                  : t('Roll back {environment}', { environment: preview.environment })}
              </DialogTitle>
              <DialogDescription>
                {preview.environment === 'prod'
                  ? t(
                      'Create a reviewable request for the previous verified version. Nothing is published until an authorized reviewer approves the unchanged request.',
                    )
                  : t(
                      'Publish the previous verified version to the currently assigned target. InitPad will not run CI or build new application code.',
                    )}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg bg-muted p-3.5 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                <span className="text-muted-foreground">{t('Environment')}</span>
                <span className="text-right font-medium uppercase">{preview.environment}</span>
                <span className="text-muted-foreground">{t('Target')}</span>
                <span className="break-words text-right font-medium">{preview.target}</span>
                <span className="text-muted-foreground">{t('Current version')}</span>
                <span className="text-right font-mono">{short(preview.currentVersion)}</span>
                <span className="text-muted-foreground">{t('Rollback version')}</span>
                <span className="text-right font-mono font-semibold text-primary">
                  {short(preview.rollbackVersion)}
                </span>
                <span className="text-muted-foreground">{t('Verified output')}</span>
                <span className="break-all text-right font-mono text-xs">
                  {preview.rollbackArtifact
                    ? preview.rollbackArtifact.digest
                    : t('OCI tag {rollbackVersion}', {
                        rollbackVersion: short(preview.rollbackVersion),
                      })}
                </span>
              </div>
            </div>

            <div
              className={
                preview.environment === 'prod'
                  ? 'tint-danger rounded-lg border border-destructive/25 p-3 text-sm'
                  : 'tint-warning rounded-lg border border-warning/30 p-3 text-sm'
              }
            >
              <p className="font-medium">{t('Impact')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {rich(
                  'The selected target will replace its current workload with version <span>{rollbackVersion}</span>. Publication still has to pass the target health check. Stable-routing targets keep their URL and a managed gateway keeps the last healthy revision online until that succeeds; a direct-port target may allocate a new port. Current environment variables and secrets stay in place; rollback changes application code, not configuration.',
                  {
                    rollbackVersion: short(preview.rollbackVersion),
                    span: (chunk) => <span className="font-mono">{chunk}</span>,
                  },
                )}
              </p>
            </div>

            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                {t(
                  'Source deployment succeeded on {date}. Any target or environment or configuration change after this dialog opened will cancel the request for review.',
                  { date: formatDateTime(preview.sourceDeployedAt) },
                )}
              </span>
            </div>

            <DialogFooter>
              <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                {t('Cancel')}
              </Button>
              <Button
                variant={preview.environment === 'prod' ? 'danger' : 'default'}
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <History className="h-4 w-4" />}
                {preview.environment === 'prod'
                  ? t('Submit rollback request')
                  : t('Roll back {environment}', { environment: preview.environment })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
