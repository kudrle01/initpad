import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import type { TargetAllocation, TargetAllocationInput } from '@/api';
import { Spinner } from '@/components/atoms/Spinner';
import { ChoiceChip } from '@/components/molecules/ChoiceChip';
import { Disclosure } from '@/components/molecules/Disclosure';
import { FieldLabel } from '@/components/molecules/FieldLabel';
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
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { RuntimeKind, Target } from '@/types';
import { t, formatNumber } from '@/i18n';

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

const FIELD = 'flex min-w-0 flex-col gap-1';

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
  const cleanupSummary = [
    devTtlHours ? `dev ${devTtlHours}h` : '',
    testTtlHours ? `test ${testTtlHours}h` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const limitsSummary = `${t('{cpu} CPU · {memory} MB · {processes} processes', {
    cpu: formatNumber(cpu / 1000),
    memory,
    processes: pids,
  })} · ${
    cleanupSummary
      ? t('cleanup {schedule}', { schedule: cleanupSummary })
      : t('no automatic cleanup')
  }`;
  const validOptionalHours = (value: string) =>
    value === '' ||
    (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 8760);
  const valid =
    targetId.length > 0 &&
    capabilities.length > 0 &&
    Number.isInteger(quota) &&
    quota >= 1 &&
    quota <= 1000 &&
    Number.isInteger(cpu) &&
    cpu >= 100 &&
    cpu <= 64000 &&
    Number.isInteger(memory) &&
    memory >= 64 &&
    memory <= 65536 &&
    Number.isInteger(pids) &&
    pids >= 32 &&
    pids <= 32768 &&
    validOptionalHours(devTtlHours) &&
    validOptionalHours(testTtlHours) &&
    (!publicUrl.trim() || /^https?:\/\//i.test(publicUrl.trim()));

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Users className="h-[18px] w-[18px]" />
            {editing ? t('Edit workspace access') : t('Enable workspace access')}
          </DialogTitle>
          <DialogDescription>
            {t('Set this workspace’s deployment limits on the server.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className={FIELD}>
            <FieldLabel
              htmlFor="allocation-target"
              help={
                <InfoTip
                  label={t('About the workspace namespace')}
                  items={[
                    {
                      title: t('Namespace'),
                      description: t('InitPad derives an isolated namespace from the workspace.'),
                    },
                    {
                      title: t('Credentials'),
                      description: t(
                        'Server credentials stay separate and are never copied into the workspace.',
                      ),
                    },
                  ]}
                />
              }
            >
              {t('Server')}
            </FieldLabel>
            <Select
              id="allocation-target"
              value={targetId}
              disabled={editing}
              onChange={(event) => selectTarget(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {target.kind}
                </option>
              ))}
            </Select>
          </div>

          <div className={FIELD}>
            <FieldLabel
              help={
                <InfoTip label={t('About allowed runtimes')}>
                  {t('Access can use all or only some of the runtimes supported by this server.')}
                </InfoTip>
              }
            >
              {t('Allowed runtimes')}
            </FieldLabel>
            <div className="flex flex-wrap gap-2">
              {(selectedTarget?.capabilities ?? []).map((capability) => (
                <ChoiceChip
                  key={capability}
                  selected={capabilities.includes(capability)}
                  onToggle={() => toggleCapability(capability)}
                >
                  {CAP_LABEL[capability]}
                </ChoiceChip>
              ))}
            </div>
          </div>

          <div className={FIELD}>
            <FieldLabel htmlFor="allocation-quota">{t('Environment quota')}</FieldLabel>
            <Input
              id="allocation-quota"
              type="number"
              min={1}
              max={1000}
              className="sm:max-w-[12rem]"
              value={maxEnvironments}
              onChange={(event) => setMaxEnvironments(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('How many environments this workspace may run on the server.')}
            </p>
          </div>

          {/* Sensible defaults cover most workspaces; the per-environment limits,
              lifetimes and URL override open on demand. */}
          <Disclosure
            defaultOpen={editing}
            className="rounded-lg border border-border/70"
            summaryClassName="px-3.5"
            contentClassName="border-t border-border/70 p-3.5"
            summary={
              <span className="min-w-0">
                <span className="block text-foreground">{t('Limits, cleanup and address')}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {limitsSummary}
                </span>
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-3">
              <div className={FIELD}>
                <FieldLabel htmlFor="allocation-cpu">{t('CPU (millicores)')}</FieldLabel>
                <Input
                  id="allocation-cpu"
                  type="number"
                  min={100}
                  max={64000}
                  value={cpuLimitMillicores}
                  onChange={(event) => setCpuLimitMillicores(event.target.value)}
                />
              </div>
              <div className={FIELD}>
                <FieldLabel htmlFor="allocation-memory">{t('Memory (MB)')}</FieldLabel>
                <Input
                  id="allocation-memory"
                  type="number"
                  min={64}
                  max={65536}
                  value={memoryLimitMb}
                  onChange={(event) => setMemoryLimitMb(event.target.value)}
                />
              </div>
              <div className={FIELD}>
                <FieldLabel htmlFor="allocation-pids">{t('Processes')}</FieldLabel>
                <Input
                  id="allocation-pids"
                  type="number"
                  min={32}
                  max={32768}
                  value={pidsLimit}
                  onChange={(event) => setPidsLimit(event.target.value)}
                />
              </div>
              <p className="-mt-1 text-xs text-muted-foreground sm:col-span-3">
                {t('Applied to every environment of this workspace on the server.')}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
              <div className={FIELD}>
                <FieldLabel
                  htmlFor="allocation-dev-ttl"
                  help={
                    <InfoTip label={t('About automatic cleanup')}>
                      {t(
                        'Expired dev/test workloads are removed automatically. Repositories and production are never affected.',
                      )}
                    </InfoTip>
                  }
                >
                  {t('Dev lifetime (hours)')}
                </FieldLabel>
                <Input
                  id="allocation-dev-ttl"
                  type="number"
                  min={1}
                  max={8760}
                  value={devTtlHours}
                  placeholder={t('Keep until removed')}
                  onChange={(event) => setDevTtlHours(event.target.value)}
                />
              </div>
              <div className={FIELD}>
                <FieldLabel htmlFor="allocation-test-ttl">{t('Test lifetime (hours)')}</FieldLabel>
                <Input
                  id="allocation-test-ttl"
                  type="number"
                  min={1}
                  max={8760}
                  value={testTtlHours}
                  placeholder={t('Keep until removed')}
                  onChange={(event) => setTestTtlHours(event.target.value)}
                />
              </div>
              <div className={cn(FIELD, 'sm:col-span-2')}>
                <FieldLabel
                  htmlFor="allocation-url"
                  help={
                    <InfoTip label={t('About the public URL override')}>
                      {t(
                        'Leave this blank to inherit the server address. Shared platform servers add the workspace namespace automatically.',
                      )}
                    </InfoTip>
                  }
                >
                  {t('Public URL override')}
                </FieldLabel>
                <Input
                  id="allocation-url"
                  value={publicUrl}
                  placeholder={selectedTarget?.publicUrl ?? t('Derived from the server')}
                  onChange={(event) => setPublicUrl(event.target.value)}
                />
              </div>
            </div>
          </Disclosure>
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('Cancel')}
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
                ...(editing || devTtlHours
                  ? { devTtlHours: devTtlHours ? Number(devTtlHours) : null }
                  : {}),
                ...(editing || testTtlHours
                  ? { testTtlHours: testTtlHours ? Number(testTtlHours) : null }
                  : {}),
                ...(publicUrl.trim() ? { publicUrl: publicUrl.trim() } : {}),
              })
            }
          >
            {busy && <Spinner className="h-4 w-4" />}
            {editing ? t('Save access') : t('Enable access')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
