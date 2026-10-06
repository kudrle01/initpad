import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/atoms/Spinner';
import type { DeleteProjectOptions } from '@/api';
import type { Environment } from '@/types';
import { t, rich } from '@/i18n';
import { statusLabel } from '@/i18n/labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  environments: Environment[];
  hasRepository: boolean;
  deleting: boolean;
  onConfirm: (options: DeleteProjectOptions) => void;
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectName,
  environments,
  hasRepository,
  deleting,
  onConfirm,
}: Props) {
  const [text, setText] = useState('');
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [confirmCleanupDebt, setConfirmCleanupDebt] = useState(false);
  const [deleteRepository, setDeleteRepository] = useState(false);
  const match = text === projectName;
  const deployed = environments.filter(
    (env) => env.status !== 'empty' || env.version !== null || env.url !== null,
  );
  const productionDeployed = deployed.some((env) => env.name === 'prod');
  const cleanupPending = environments.filter(
    (env) => env.status === 'empty' && env.statusReason?.startsWith('Cleanup pending:'),
  );
  const confirmed =
    match &&
    (!productionDeployed || confirmProduction) &&
    (!cleanupPending.length || confirmCleanupDebt);

  function confirm() {
    if (!confirmed) return;
    onConfirm({ deleteRepository, confirmProduction, confirmCleanupDebt });
  }

  function reset() {
    setText('');
    setConfirmProduction(false);
    setConfirmCleanupDebt(false);
    setDeleteRepository(false);
  }

  function close() {
    if (deleting) return;
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!deleting) {
          if (!o) reset();
          onOpenChange(o);
        }
      }}
    >
      <DialogContent hideClose>
        <DialogHeader>
          <DialogTitle>
            <Trash2 className="h-[18px] w-[18px] text-destructive" /> {t('Delete project')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'InitPad will remove every managed deployment before deleting its project record. Cleanup must succeed on every target by default. Protected leftovers can only be detached through a separate explicit acknowledgement.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">{t('Cleanup plan')}</p>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            {deployed.length ? (
              deployed.map((env) => (
                <li
                  key={env.name}
                  className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="capitalize">{t('{name} deployment', { name: env.name })}</span>
                  <span className="break-words text-xs sm:text-right">
                    {env.target?.name ?? env.provider} · {statusLabel(env.status)}
                  </span>
                </li>
              ))
            ) : (
              <li>{t('No active deployments')}</li>
            )}
            {cleanupPending.map((env) => (
              <li key={`${env.name}-cleanup`} className="text-warning">
                <span className="capitalize">
                  {t('{name} cleanup pending', { name: env.name })}
                </span>
                <span className="mt-0.5 block break-all text-xs">{env.statusReason}</span>
              </li>
            ))}
            <li className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span>{t('Generated images and packages')}</span>
              <span className="text-xs">{t('remove')}</span>
            </li>
            <li className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span>{t('InitPad project record')}</span>
              <span className="text-xs">{t('remove · release workspace name')}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('Deployment targets and unrelated server files are never deleted.')}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {productionDeployed && (
            <label className="flex cursor-pointer items-start gap-3 tint-danger rounded-lg border border-destructive/25 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-destructive"
                checked={confirmProduction}
                onChange={(e) => setConfirmProduction(e.target.checked)}
                disabled={deleting}
              />
              <span>
                <span className="block font-medium">{t('Remove the production deployment')}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t('Production will become unavailable and its deployed files will be deleted.')}
                </span>
              </span>
            </label>
          )}

          {cleanupPending.length > 0 && (
            <label className="flex cursor-pointer items-start gap-3 tint-warning rounded-lg border border-warning/30 p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-warning"
                checked={confirmCleanupDebt}
                onChange={(e) => setConfirmCleanupDebt(e.target.checked)}
                disabled={deleting}
              />
              <span>
                <span className="block font-medium">
                  {t('Delete the InitPad record with protected cleanup still pending')}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(
                    'The public application is already gone. A target administrator must still delete the listed quarantined paths. InitPad cannot retry that cleanup after this project record is deleted.',
                  )}
                </span>
              </span>
            </label>
          )}

          {hasRepository && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-destructive"
                checked={deleteRepository}
                onChange={(e) => setDeleteRepository(e.target.checked)}
                disabled={deleting}
              />
              <span>
                <span className="block font-medium">
                  {t('Also delete the source repository and release its name')}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(
                    'Optional and irreversible. If you preserve the repository, its name remains occupied in Gitea and should later be added back as an existing project. Delete it if a brand-new project must reuse the same name.',
                  )}
                </span>
              </span>
            </label>
          )}

          <p className="break-words text-sm">
            {rich('Type <b>{projectName}</b> to confirm:', {
              projectName: projectName,
              b: (chunk) => <strong className="font-semibold">{chunk}</strong>,
            })}
          </p>
          <Input
            value={text}
            autoFocus
            placeholder={projectName}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && confirmed) confirm();
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={deleting}>
            {t('Cancel')}
          </Button>
          <Button variant="danger" onClick={confirm} disabled={!confirmed || deleting}>
            {deleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
            {deleting ? t('deleting…') : t('Delete project')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
