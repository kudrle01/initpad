import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/molecules/Notice';
import { t } from '@/i18n';

interface Props {
  message: string;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

/** Recoverable data-loading error. Form validation and action errors stay inline. */
export function LoadErrorState({ message, onRetry, title, className }: Props) {
  return (
    <Notice
      tone="danger"
      role="alert"
      title={title ?? t('Could not load this content')}
      className={className}
      actions={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" /> {t('Try again')}
          </Button>
        )
      }
    >
      {message}
    </Notice>
  );
}
