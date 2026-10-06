import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Molecule: label + input + optional hint / error message. Composes the Label
// and Input atoms and wires them together via a derived id.
interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
}

export function FormField({ label, hint, error, id, ...props }: FormFieldProps) {
  const generatedId = React.useId();
  const fieldId = id ?? `field-${generatedId}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const describedBy =
    [props['aria-describedby'], hint ? hintId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        {...props}
        id={fieldId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
