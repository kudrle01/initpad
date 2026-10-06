import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/**
 * Label row of a form field with an optional help trigger. The row has a fixed
 * minimum height so fields sitting side by side keep their inputs aligned
 * whether or not a neighbor carries a help icon.
 */
export function FieldLabel({
  htmlFor,
  children,
  help,
}: {
  htmlFor?: string;
  children: ReactNode;
  /** Usually an <InfoTip />. */
  help?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-1">
      <Label htmlFor={htmlFor} className="min-w-0">
        {children}
      </Label>
      {help}
    </div>
  );
}
