import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';

// Molecule: a single statistic (label + large number) in a card, with an
// optional icon.
export function StatCard({
  label,
  value,
  icon: I,
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="flex items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </div>
      {I && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary/70 text-muted-foreground">
          <I className="h-[18px] w-[18px]" />
        </span>
      )}
    </Card>
  );
}
