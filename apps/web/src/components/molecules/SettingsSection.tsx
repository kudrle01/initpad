import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  tone?: 'default' | 'warning';
}

/** Shared visual frame for one independently managed Settings domain. */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  tone = 'default',
}: Props) {
  return (
    <section
      className={cn(
        'rounded-lg border p-5 sm:p-6',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/5'
          : 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-md',
            tone === 'warning'
              ? 'bg-warning/10 text-warning'
              : 'bg-secondary text-muted-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        </div>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}
