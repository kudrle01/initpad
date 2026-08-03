import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  message: string;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

/** Recoverable data-loading error. Form validation and action errors stay inline. */
export function LoadErrorState({
  message,
  onRetry,
  title = 'Could not load this content',
  className,
}: Props) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center',
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" className="self-start sm:self-auto" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}
