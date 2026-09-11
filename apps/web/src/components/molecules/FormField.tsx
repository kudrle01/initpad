import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Molecule: label + input + optional error message. Composes the Label and
// Input atoms and wires them together via a derived id.
interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
}

export function FormField({ label, error, id, ...props }: FormFieldProps) {
  const generatedId = React.useId();
  const fieldId = id ?? `field-${generatedId}`;
  const errorId = `${fieldId}-error`;
  const describedBy = [props['aria-describedby'], error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        {...props}
        id={fieldId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
      />
      {error && <p id={errorId} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
