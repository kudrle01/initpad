import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Section } from '@/components/molecules/Section';
import type { InfoTipItem } from '@/components/molecules/InfoTip';
import { cn } from '@/lib/utils';

interface Props {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  help?: InfoTipItem[];
  helpLabel?: string;
  /** Controls aligned with the heading (Refresh, Add…). */
  actions?: ReactNode;
  children?: ReactNode;
  /** Children run edge to edge (lists bring their own row padding). */
  flush?: boolean;
  tone?: 'default' | 'warning';
}

/** Shared visual frame for one independently managed Settings domain. */
export function SettingsSection({ icon: Icon, tone = 'default', ...section }: Props) {
  return (
    <Section
      {...section}
      className={tone === 'warning' ? 'tint-warning border-warning/40' : undefined}
      media={
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            tone === 'warning'
              ? 'bg-warning/15 text-warning'
              : 'bg-secondary text-secondary-foreground',
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      }
    />
  );
}
