import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<NoticeTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'tint-neutral border-border', icon: 'text-muted-foreground', Icon: Info },
  success: { box: 'tint-success border-success/25', icon: 'text-success', Icon: CheckCircle2 },
  warning: {
    box: 'tint-warning border-warning/30',
    icon: 'text-warning',
    Icon: AlertTriangle,
  },
  danger: {
    box: 'tint-danger border-destructive/25',
    icon: 'text-destructive',
    Icon: ShieldAlert,
  },
};

interface Props {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons or links that resolve the notice. */
  actions?: ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  role?: 'alert' | 'status';
  'aria-live'?: 'polite' | 'assertive';
  className?: string;
}

/** Inline callout for a state the reader should notice before continuing. */
export function Notice({
  tone = 'info',
  title,
  children,
  actions,
  icon,
  iconClassName,
  role,
  'aria-live': ariaLive,
  className,
}: Props) {
  const style = TONE[tone];
  const Icon = icon ?? style.Icon;
  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border p-3.5 text-sm sm:flex-row sm:items-start',
        style.box,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon
          className={cn('mt-0.5 h-4 w-4 shrink-0', style.icon, iconClassName)}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          {title && <p className="break-words font-medium text-foreground">{title}</p>}
          {children && (
            <div
              className={cn(
                'break-words text-[13px] leading-relaxed text-muted-foreground',
                title && 'mt-0.5',
              )}
            >
              {children}
            </div>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2 sm:self-center">{actions}</div>}
    </div>
  );
}
