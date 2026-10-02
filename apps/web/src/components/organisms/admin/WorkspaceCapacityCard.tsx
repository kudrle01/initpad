import { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { api } from '@/api';
import { useConfirmation } from '@/confirmation';
import { useToast } from '@/toast';
import type { WorkspaceCapacity, WorkspaceCapacityUpdate } from '@/types';
import { Button } from '@/components/ui/button';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { Spinner } from '@/components/atoms/Spinner';

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
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Gauge className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold">Workspace limits</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tenant-wide limits for control-plane work and artifact storage.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {error ? (
        <LoadErrorState className="mt-4" message={error} onRetry={load} />
      ) : loading ? (
        <ContentLoading className="mt-4" label="Loading workspace limits" count={2} />
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((capacity) => (
            <CapacityEditor
              key={capacity.workspaceId}
              capacity={capacity}
              onSaved={(updated) =>
                setItems((rows) =>
                  rows.map((row) => (row.workspaceId === updated.workspaceId ? updated : row)),
                )
              }
            />
          ))}
          {items.length === 0 && (
            <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              No workspaces found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CapacityEditor({
  capacity,
  onSaved,
}: {
  capacity: WorkspaceCapacity;
  onSaved: (updated: WorkspaceCapacity) => void;
}) {
  const toast = useToast();
  const confirmAction = useConfirmation();
  const [values, setValues] = useState(() => initialValues(capacity));
  const [saving, setSaving] = useState(false);

  useEffect(() => setValues(initialValues(capacity)), [capacity]);

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
        title: `Put ${capacity.workspaceName} over its new limit?`,
        description:
          'Existing resources remain available, but new work in the affected category will be blocked.',
        confirmLabel: 'Apply lower limit',
        tone: 'warning',
      });
      if (!confirmed) return;
    }
    setSaving(true);
    try {
      const updated = await api.adminUpdateWorkspaceCapacity(capacity.workspaceId, values);
      onSaved(updated);
      toast.success(`Updated limits for ${capacity.workspaceName}`);
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
    { key: 'maxProjects', label: 'Projects', used: capacity.usage.projects },
    { key: 'maxMembers', label: 'Members', used: capacity.usage.members },
    { key: 'maxTargets', label: 'Servers', used: capacity.usage.targets },
    {
      key: 'maxConcurrentOperations',
      label: 'Active operations',
      used: capacity.usage.concurrentOperations,
    },
    {
      key: 'maxArtifactStorageGiB',
      label: 'Artifact GiB',
      used: artifactGiB(capacity.usage.artifactBytes),
    },
  ];

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{capacity.workspaceName}</span>
        <span className="font-mono text-xs text-muted-foreground">{capacity.workspaceId}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {fields.map(({ key, label, used }) => (
          <label key={key} className="text-xs text-muted-foreground">
            {label} <span className="font-mono">({used} used)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={values[key]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [key]: Number(event.target.value) }))
              }
              className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 font-mono text-sm text-foreground"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!changed || !valid || saving} onClick={() => void save()}>
          {saving && <Spinner className="h-4 w-4" />} Save limits
        </Button>
      </div>
    </div>
  );
}
