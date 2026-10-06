import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'brand' | 'warning' | 'danger';

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  brand: 'bg-secondary text-secondary-foreground',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

// Molecule: a single headline figure — quiet label, large number, optional
// supporting line.
export function StatCard({
  label,
  value,
  hint,
  icon: I,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm leading-5 text-muted-foreground">{label}</span>
        {I && (
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              ICON_TONE[tone],
            )}
          >
            <I className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-1 text-3xl font-bold leading-9 tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
