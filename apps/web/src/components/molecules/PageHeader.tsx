import type { ReactNode } from 'react';
import { InfoTip, type InfoTipItem } from '@/components/molecules/InfoTip';

export function PageHeader({
  title,
  actions,
  help,
  helpLabel,
}: {
  title: string;
  actions?: ReactNode;
  help?: InfoTipItem[];
  helpLabel?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="break-words text-xl font-semibold tracking-tight">{title}</h1>
          {help && <InfoTip label={helpLabel ?? `About ${title}`} items={help} />}
        </div>
        {actions && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">{actions}</div>
        )}
      </div>
    </div>
  );
}
