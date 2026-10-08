import { useCallback, useEffect, useId, useState } from 'react';
import { ChevronDown, Gauge, RefreshCw } from 'lucide-react';
import { api } from '@/api';
import { useConfirmation } from '@/confirmation';
import { useToast } from '@/toast';
import type { WorkspaceCapacity, WorkspaceCapacityUpdate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { List, listRowClassName, listRowInteractiveClassName } from '@/components/molecules/List';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { Spinner } from '@/components/atoms/Spinner';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

function artifactGiB(value: string): number {
  return Number(BigInt(value) / (1024n * 1024n * 1024n));
}

function initialValues(capacity: WorkspaceCapacity): WorkspaceCapacityUpdate {
  return {
    maxProjects: capacity.limits.projects,
    maxMembers: capacity.limits.members,
    maxTargets: capacity.limits.targets,
    maxConcurrentOperations: capacity.limits.concurrentOperations,
    maxArtifactStorageGiB: artifactGiB(capacity.limits.artifactBytes),
  };
}

export function WorkspaceCapacityCard() {
  const [items, setItems] = useState<WorkspaceCapacity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.adminListWorkspaceCapacity());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SettingsSection
      icon={Gauge}
      title={t('Workspace limits')}
      description={t('Tenant-wide limits for control-plane work and artifact storage.')}
      flush={!error && !loading && items.length > 0}
      actions={
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> {t('Refresh')}
        </Button>
      }
    >
      {error ? (
        <LoadErrorState message={error} onRetry={load} />
      ) : loading ? (
        <ContentLoading label={t('Loading workspace limits')} count={2} />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No workspaces found.')}</p>
      ) : (
        <List>
          {items.map((capacity) => (
            <CapacityEditor
              key={capacity.workspaceId}
              capacity={capacity}
              // A single workspace has nothing to scan past — show its limits.
              defaultOpen={items.length === 1}
              onSaved={(updated) =>
                setItems((rows) =>
                  rows.map((row) => (row.workspaceId === updated.workspaceId ? updated : row)),
                )
              }
            />
          ))}
        </List>
      )}
    </SettingsSection>
  );
}

function CapacityEditor({
  capacity,
  defaultOpen,
  onSaved,
}: {
  capacity: WorkspaceCapacity;
  defaultOpen: boolean;
  onSaved: (updated: WorkspaceCapacity) => void;
}) {
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [values, setValues] = useState(() => initialValues(capacity));
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  // Reset the draft when the saved limits change. This happens during render
  // because an effect also runs after mount, and React may flush it only after
  // the first edit, which it would then overwrite.
  const [syncedCapacity, setSyncedCapacity] = useState(capacity);
  if (syncedCapacity !== capacity) {
    setSyncedCapacity(capacity);
    setValues(initialValues(capacity));
  }

  const original = initialValues(capacity);
  const changed = (Object.keys(original) as Array<keyof WorkspaceCapacityUpdate>).some(
    (key) => original[key] !== values[key],
  );
  const valid = Object.values(values).every((value) => Number.isInteger(value) && value >= 1);

  async function save() {
    const belowCurrentUsage =
      values.maxProjects < capacity.usage.projects ||
      values.maxMembers < capacity.usage.members ||
      values.maxTargets < capacity.usage.targets ||
      values.maxConcurrentOperations < capacity.usage.concurrentOperations ||
      BigInt(values.maxArtifactStorageGiB) * 1024n * 1024n * 1024n <
        BigInt(capacity.usage.artifactBytes);
    if (belowCurrentUsage) {
      const confirmed = await confirmAction({
        title: t('Put {workspaceName} over its new limit?', {
          workspaceName: capacity.workspaceName,
        }),
        description: t(
          'Existing resources remain available, but new work in the affected category will be blocked.',
        ),
        confirmLabel: t('Apply lower limit'),
        tone: 'warning',
      });
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const updated = await api.adminUpdateWorkspaceCapacity(capacity.workspaceId, values);
      onSaved(updated);
      toast.success(
        t('Updated limits for {workspaceName}', { workspaceName: capacity.workspaceName }),
      );
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{
    key: keyof WorkspaceCapacityUpdate;
    label: string;
    used: number | string;
  }> = [
    { key: 'maxProjects', label: t('Projects'), used: capacity.usage.projects },
    { key: 'maxMembers', label: t('Members'), used: capacity.usage.members },
    { key: 'maxTargets', label: t('Servers'), used: capacity.usage.targets },
    {
      key: 'maxConcurrentOperations',
      label: t('Active operations'),
      used: capacity.usage.concurrentOperations,
    },
    {
      key: 'maxArtifactStorageGiB',
      label: t('Artifact GiB'),
      used: artifactGiB(capacity.usage.artifactBytes),
    },
  ];

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(listRowClassName, listRowInteractiveClassName, 'w-full text-left')}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={capacity.workspaceName}>
            {capacity.workspaceName}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {capacity.workspaceId}
          </span>
        </span>
        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground md:inline">
          {t('{projects} projects · {members} members · {servers} servers', {
            projects: `${capacity.usage.projects}/${capacity.limits.projects}`,
            members: `${capacity.usage.members}/${capacity.limits.members}`,
            servers: `${capacity.usage.targets}/${capacity.limits.targets}`,
          })}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={panelId} className="bg-muted/50 px-4 pb-4 pt-3 sm:px-6 sm:pb-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {fields.map(({ key, label, used }) => (
              <label key={key} className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{label}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {t('({used} used)', { used: used })}
                  </span>
                </span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={values[key]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [key]: Number(event.target.value) }))
                  }
                  className="font-mono tabular-nums"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" disabled={!changed || !valid || saving} onClick={() => void save()}>
              {saving && <Spinner className="h-3.5 w-3.5" />} {t('Save limits')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
