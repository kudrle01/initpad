import { Layers, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import type { TargetAllocation } from '@/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Props {
  allocation: TargetAllocation;
  busy: boolean;
  canManage: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

export function AllocationCard({
  allocation,
  busy,
  canManage,
  onEdit,
  onToggle,
  onDelete,
}: Props) {
  const disabled = allocation.status === 'disabled';

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            <Layers className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{allocation.targetName}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">
              namespace: {allocation.namespace}
            </div>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            disabled ? 'bg-muted text-muted-foreground' : 'bg-success/10 text-success'
          }`}
        >
          {disabled ? 'disabled' : 'active'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allocation.capabilities.map((capability) => (
          <span
            key={capability}
            className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
          >
            {capability}
          </span>
        ))}
      </div>

      <div className="min-w-0 font-mono text-xs text-muted-foreground">
        {allocation.inUse} / {allocation.maxEnvironments} environments
        {allocation.publicUrl && <div className="truncate">{allocation.publicUrl}</div>}
      </div>

      {canManage && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit allocation"
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={onToggle}>
            {disabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
            {disabled ? 'Enable' : 'Disable'}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete allocation"
            disabled={busy || allocation.inUse > 0}
            title={allocation.inUse > 0 ? 'In use by an environment' : 'Delete allocation'}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Card>
  );
}
