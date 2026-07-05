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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {actions}
      </div>
      {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
