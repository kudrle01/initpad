import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { InfoTip, type InfoTipItem } from '@/components/molecules/InfoTip';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  description?: ReactNode;
  help?: InfoTipItem[];
  helpLabel?: string;
  actions?: ReactNode;
  /** Small leading visual (icon chip). */
  media?: ReactNode;
  className?: string;
  headingId?: string;
}

/** Title + supporting line + actions. Shared by every section so headings align. */
export function SectionHeader({
  title,
  description,
  help,
  helpLabel,
  actions,
  media,
  className,
  headingId,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex justify-between gap-3 sm:flex-row sm:items-start sm:gap-4',
        // With a description the actions wrap underneath on a phone; a bare
        // title keeps its action on the same line.
        description ? 'flex-col' : 'flex-row items-center',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {media}
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <h2
              id={headingId}
              className="min-w-0 break-words text-base font-semibold leading-snug tracking-tight"
            >
              {title}
            </h2>
            {help && <InfoTip label={helpLabel ?? `About ${title}`} items={help} />}
          </div>
          {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

interface SectionProps extends SectionHeaderProps {
  children?: ReactNode;
  /** Render children edge to edge (lists and tables bring their own row padding). */
  flush?: boolean;
  contentClassName?: string;
}

/**
 * One self-contained block of a page: a card with a heading and its content.
 * Pages are a short stack of these rather than loose headings and boxes.
 */
export function Section({ children, flush, className, contentClassName, ...header }: SectionProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <SectionHeader
        {...header}
        className={cn('p-5 sm:p-6', flush && children ? 'pb-4 sm:pb-5' : undefined)}
      />
      {children && (
        <div
          className={cn(
            flush ? 'border-t border-border/70' : 'px-5 pb-5 sm:px-6 sm:pb-6',
            contentClassName,
          )}
        >
          {children}
        </div>
      )}
    </Card>
  );
}
