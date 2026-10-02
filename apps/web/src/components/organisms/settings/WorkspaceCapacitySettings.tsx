import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import type { WorkspaceCapacity } from '@/types';

function bytesLabel(value: string): string {
  const gib = Number(BigInt(value)) / 1024 ** 3;
  return `${gib.toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`;
}

export function WorkspaceCapacitySettings() {
  const { activeWorkspace } = useAuth();
  const [capacity, setCapacity] = useState<WorkspaceCapacity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const workspaceId = activeWorkspace?.id;

  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    setCapacity(null);
    setError(null);
    api
      .getWorkspaceCapacity(workspaceId)
      .then((value) => {
        if (!disposed) setCapacity(value);
      })
      .catch((cause) => {
        if (!disposed) setError((cause as Error).message);
      });
    return () => {
      disposed = true;
    };
  }, [workspaceId, reloadKey]);

  if (!workspaceId) return null;

  const rows = capacity
    ? ([
        ['Projects', capacity.usage.projects, capacity.limits.projects],
        ['Members', capacity.usage.members, capacity.limits.members],
        ['Servers', capacity.usage.targets, capacity.limits.targets],
        [
          'Active operations',
          capacity.usage.concurrentOperations,
          capacity.limits.concurrentOperations,
        ],
      ] as const)
    : [];

  return (
    <SettingsSection
      icon={Gauge}
      title="Workspace capacity"
      help={[
        {
          title: 'Control-plane limits',
          description:
            'Projects, members, servers and simultaneous provisioning or deployment operations share this workspace policy.',
        },
        {
          title: 'Server limits',
          description:
            'CPU, memory, process and environment limits remain specific to each server access.',
        },
      ]}
    >
      {error ? (
        <LoadErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />
      ) : !capacity ? (
        <ContentLoading label="Loading workspace capacity" count={2} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map(([label, used, limit]) => {
            const percentage = Math.min(100, Math.round((used / limit) * 100));
            return (
              <div key={label} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {used} / {limit}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
          <div className="rounded-md border border-border p-3 sm:col-span-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>Artifact storage</span>
              <span className="font-mono text-xs text-muted-foreground">
                {bytesLabel(capacity.usage.artifactBytes)} /{' '}
                {bytesLabel(capacity.limits.artifactBytes)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${Math.min(
                    100,
                    Number(
                      (BigInt(capacity.usage.artifactBytes) * 100n) /
                        BigInt(capacity.limits.artifactBytes),
                    ),
                  )}%`,
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Platform administrators manage these limits. Reaching one blocks only new work; existing
            projects and workloads are preserved.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
