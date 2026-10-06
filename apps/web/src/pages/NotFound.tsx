import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';
import { t } from '@/i18n';

// Rendered inside the layout for unknown paths (catch-all route).
export default function NotFound() {
  return (
    <div>
      <PageHeader title={t('Page not found')} />
      <EmptyState
        icon={Layers}
        title={t('Nothing here')}
        description={t('This page doesn’t exist or may have moved.')}
        action={
          <Button asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" /> {t('Back to dashboard')}
            </Link>
          </Button>
        }
      />
    </div>
  );
}
