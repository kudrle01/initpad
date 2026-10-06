import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { api } from '@/api';
import { useAuth } from '@/auth';
import { ContentLoading } from '@/components/molecules/ContentLoading';
import { LoadErrorState } from '@/components/molecules/LoadErrorState';
import { SettingsSection } from '@/components/molecules/SettingsSection';
import { cn } from '@/lib/utils';
import type { WorkspaceCapacity } from '@/types';

function meter(label: string, used: number, limit: number) {
  return {
    label,
    value: `${used} / ${limit}`,
    percentage: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100,
  };
}

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

  const meters = capacity
    ? [
        meter('Projects', capacity.usage.projects, capacity.limits.projects),
        meter('Members', capacity.usage.members, capacity.limits.members),
        meter('Servers', capacity.usage.targets, capacity.limits.targets),
        meter(
          'Active operations',
          capacity.usage.concurrentOperations,
          capacity.limits.concurrentOperations,
        ),
        {
          label: 'Artifact storage',
          value: `${bytesLabel(capacity.usage.artifactBytes)} / ${bytesLabel(capacity.limits.artifactBytes)}`,
          percentage: Math.min(
            100,
            Number(
              (BigInt(capacity.usage.artifactBytes) * 100n) / BigInt(capacity.limits.artifactBytes),
            ),
          ),
        },
      ]
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
        <>
          <dl className="grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
            {meters.map(({ label, value, percentage }) => (
              <div key={label} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="truncate text-sm font-medium">{label}</dt>
                  <dd className="shrink-0 text-xs tabular-nums text-muted-foreground">{value}</dd>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
                  role="presentation"
                >
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width]',
                      percentage >= 100
                        ? 'bg-destructive'
                        : percentage >= 85
                          ? 'bg-warning'
                          : 'bg-primary',
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            Platform administrators manage these limits. Reaching one blocks only new work; existing
            projects and workloads are preserved.
          </p>
        </>
      )}
    </SettingsSection>
  );
}
