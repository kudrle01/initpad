import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import type { TargetAllocation, TargetAllocationInput } from '@/api';
import { Spinner } from '@/components/atoms/Spinner';
import { InfoTip } from '@/components/molecules/InfoTip';
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
  'h-11 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9';

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
  const [cpuLimitMillicores, setCpuLimitMillicores] = useState('1000');
  const [memoryLimitMb, setMemoryLimitMb] = useState('512');
  const [pidsLimit, setPidsLimit] = useState('256');
  const [devTtlHours, setDevTtlHours] = useState('');
  const [testTtlHours, setTestTtlHours] = useState('');

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
    setPublicUrl(allocation?.publicUrl ?? '');
    setCpuLimitMillicores(String(allocation?.cpuLimitMillicores ?? 1000));
    setMemoryLimitMb(String(allocation?.memoryLimitMb ?? 512));
    setPidsLimit(String(allocation?.pidsLimit ?? 256));
    setDevTtlHours(allocation?.devTtlHours ? String(allocation.devTtlHours) : '');
    setTestTtlHours(allocation?.testTtlHours ? String(allocation.testTtlHours) : '');
  }, [allocation, open, targets]);

  function selectTarget(nextId: string) {
    const next = targets.find((target) => target.id === nextId);
    setTargetId(nextId);
    setCapabilities(next?.capabilities ?? []);
    setPublicUrl('');
  }

  function toggleCapability(capability: RuntimeKind) {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((candidate) => candidate !== capability)
        : [...current, capability],
    );
  }

  const quota = Number(maxEnvironments);
  const cpu = Number(cpuLimitMillicores);
  const memory = Number(memoryLimitMb);
  const pids = Number(pidsLimit);
  const validOptionalHours = (value: string) =>
    value === '' || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 8760);
  const valid =
    targetId.length > 0 &&
    capabilities.length > 0 &&
    Number.isInteger(quota) &&
    quota >= 1 &&
    quota <= 1000 &&
    Number.isInteger(cpu) && cpu >= 100 && cpu <= 64000 &&
    Number.isInteger(memory) && memory >= 64 && memory <= 65536 &&
    Number.isInteger(pids) && pids >= 32 && pids <= 32768 &&
    validOptionalHours(devTtlHours) && validOptionalHours(testTtlHours) &&
    (!publicUrl.trim() || /^https?:\/\//i.test(publicUrl.trim()));

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Users className="h-[18px] w-[18px]" />
            {editing ? 'Edit workspace access' : 'Enable workspace access'}
          </DialogTitle>
          <DialogDescription>
            Set this workspace’s deployment limits on the server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="allocation-target">Server</Label>
              <InfoTip
                label="About the workspace namespace"
                items={[
                  {
                    title: 'Namespace',
                    description: 'InitPad derives an isolated namespace from the workspace.',
                  },
                  {
                    title: 'Credentials',
                    description: 'Server credentials stay separate and are never copied into the workspace.',
                  },
                ]}
              />
            </div>
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
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <Label>Allowed runtimes</Label>
              <InfoTip label="About allowed runtimes">
                Access can use all or only some of the runtimes supported by this server.
              </InfoTip>
            </div>
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allocation-cpu">CPU per environment (millicores)</Label>
              <Input id="allocation-cpu" type="number" min={100} max={64000} value={cpuLimitMillicores} onChange={(event) => setCpuLimitMillicores(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allocation-memory">Memory per environment (MB)</Label>
              <Input id="allocation-memory" type="number" min={64} max={65536} value={memoryLimitMb} onChange={(event) => setMemoryLimitMb(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allocation-pids">Process limit</Label>
              <Input id="allocation-pids" type="number" min={32} max={32768} value={pidsLimit} onChange={(event) => setPidsLimit(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <Label htmlFor="allocation-dev-ttl">Dev lifetime (hours, optional)</Label>
                <InfoTip label="About automatic cleanup">Expired dev/test workloads are removed automatically. Repositories and production are never affected.</InfoTip>
              </div>
              <Input id="allocation-dev-ttl" type="number" min={1} max={8760} value={devTtlHours} placeholder="Keep until removed" onChange={(event) => setDevTtlHours(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="allocation-test-ttl">Test lifetime (hours, optional)</Label>
              <Input id="allocation-test-ttl" type="number" min={1} max={8760} value={testTtlHours} placeholder="Keep until removed" onChange={(event) => setTestTtlHours(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="allocation-url">Public URL override (optional)</Label>
                <InfoTip label="About the public URL override">
                  Leave this blank to inherit the server address. Shared platform servers add
                  the workspace namespace automatically.
                </InfoTip>
              </div>
              <Input
                id="allocation-url"
                value={publicUrl}
                placeholder={selectedTarget?.publicUrl ?? 'Derived from the server'}
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
                cpuLimitMillicores: cpu,
                memoryLimitMb: memory,
                pidsLimit: pids,
                ...(editing || devTtlHours ? { devTtlHours: devTtlHours ? Number(devTtlHours) : null } : {}),
                ...(editing || testTtlHours ? { testTtlHours: testTtlHours ? Number(testTtlHours) : null } : {}),
                ...(publicUrl.trim() ? { publicUrl: publicUrl.trim() } : {}),
              })
            }
          >
            {busy && <Spinner className="h-4 w-4" />}
            {editing ? 'Save access' : 'Enable access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
