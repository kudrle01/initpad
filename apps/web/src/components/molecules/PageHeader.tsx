import type { ReactNode } from 'react';
import { InfoTip, type InfoTipItem } from '@/components/molecules/InfoTip';
import { t } from '@/i18n';

export function PageHeader({
  title,
  description,
  actions,
  help,
  helpLabel,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  help?: InfoTipItem[];
  helpLabel?: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="min-w-0 break-words text-2xl font-semibold leading-tight tracking-tight">
            {title}
          </h1>
          {help && (
            <InfoTip label={helpLabel ?? t('About {title}', { title: title })} items={help} />
          )}
        </div>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        // Actions share the row on a phone instead of stacking as full-width bars.
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      )}
    </div>
  );
}
