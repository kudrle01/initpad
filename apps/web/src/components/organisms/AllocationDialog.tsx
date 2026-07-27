import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import type { TargetAllocation, TargetAllocationInput } from '@/api';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { RuntimeKind, Target } from '@/types';

interface Props {
  open: boolean;
  allocation: TargetAllocation | null;
  targets: Target[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TargetAllocationInput) => void;
}

const CAP_LABEL: Record<RuntimeKind, string> = {
  static: 'Static',
  node: 'Node',
  php: 'PHP',
  python: 'Python',
};

const selectCls =
  'h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';

export function AllocationDialog({
  open,
  allocation,
  targets,
  busy,
  onOpenChange,
  onSubmit,
}: Props) {
  const editing = allocation !== null;
  const [targetId, setTargetId] = useState('');
  const [capabilities, setCapabilities] = useState<RuntimeKind[]>([]);
  const [maxEnvironments, setMaxEnvironments] = useState('50');
  const [publicUrl, setPublicUrl] = useState('');

  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === targetId) ?? null,
    [targetId, targets],
  );

  useEffect(() => {
    if (!open) return;
    const initialTarget =
      (allocation && targets.find((target) => target.id === allocation.targetId)) ??
      targets[0] ??
      null;
    setTargetId(initialTarget?.id ?? '');
    setCapabilities(allocation?.capabilities ?? initialTarget?.capabilities ?? []);
    setMaxEnvironments(String(allocation?.maxEnvironments ?? 50));
    setPublicUrl(allocation?.publicUrl ?? initialTarget?.publicUrl ?? '');
  }, [allocation, open, targets]);

  function selectTarget(nextId: string) {
    const next = targets.find((target) => target.id === nextId);
    setTargetId(nextId);
    setCapabilities(next?.capabilities ?? []);
    setPublicUrl(next?.publicUrl ?? '');
  }

  function toggleCapability(capability: RuntimeKind) {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((candidate) => candidate !== capability)
        : [...current, capability],
    );
  }

  const quota = Number(maxEnvironments);
  const valid =
    targetId.length > 0 &&
    capabilities.length > 0 &&
    Number.isInteger(quota) &&
    quota >= 1 &&
    quota <= 1000 &&
    /^https?:\/\//i.test(publicUrl.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Layers className="h-[18px] w-[18px]" />
            {editing ? 'Edit allocation' : 'Allocate a target'}
          </DialogTitle>
          <DialogDescription>
            Give this workspace an isolated namespace and quota on a physical target. Server
            credentials stay on the target and are never copied into the workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="allocation-target">Target</Label>
            <select
              id="allocation-target"
              className={selectCls}
              value={targetId}
              disabled={editing}
              onChange={(event) => selectTarget(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {target.kind}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The workspace namespace is derived server-side and cannot be changed here.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Allowed runtimes</Label>
            <div className="flex flex-wrap gap-1.5">
              {(selectedTarget?.capabilities ?? []).map((capability) => {
                const selected = capabilities.includes(capability);
                return (
                  <button
                    key={capability}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCapability(capability)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40',
                    )}
                  >
                    {CAP_LABEL[capability]}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              This can only narrow the capabilities offered by the target.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allocation-quota">Environment quota</Label>
              <Input
                id="allocation-quota"
                type="number"
                min={1}
                max={1000}
                value={maxEnvironments}
                onChange={(event) => setMaxEnvironments(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="allocation-url">Public application URL</Label>
              <Input
                id="allocation-url"
                value={publicUrl}
                placeholder="https://apps.example.org/team"
                onChange={(event) => setPublicUrl(event.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !valid}
            onClick={() =>
              onSubmit({
                targetId,
                capabilities,
                maxEnvironments: quota,
                publicUrl: publicUrl.trim(),
              })
            }
          >
            {busy && <Spinner className="h-4 w-4" />}
            {editing ? 'Save allocation' : 'Allocate target'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
