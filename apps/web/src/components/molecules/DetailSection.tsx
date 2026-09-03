import type { ReactNode } from 'react';
import { InfoTip, type InfoTipItem } from '@/components/molecules/InfoTip';

export function DetailSection({
  title,
  children,
  help,
}: {
  title: string;
  children: ReactNode;
  help?: InfoTipItem[];
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {help && <InfoTip label={`About ${title}`} items={help} />}
      </div>
      {children}
    </section>
  );
}
