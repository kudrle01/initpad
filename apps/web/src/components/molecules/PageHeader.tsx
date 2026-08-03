import type { ReactNode } from 'react';

// Molecule: page header — title on the left, actions on the right, optional
// subtitle below.
export function PageHeader({
  title,
  actions,
  subtitle,
}: {
  title: string;
  actions?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="break-words text-xl font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">{actions}</div>}
      </div>
      {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
