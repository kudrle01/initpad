import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AuthCard } from '@/components/molecules/AuthCard';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

// Router errorElement — catches 404s and unexpected errors and shows a friendly page.
export default function RouteError() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const message = isRouteErrorResponse(error)
    ? error.statusText || t('Something went wrong')
    : error instanceof Error
      ? error.message
      : t('Something went wrong');

  return (
    <AuthCard
      align="center"
      title={is404 ? t('Page not found') : t('Something went wrong')}
      description={is404 ? t('This page doesn’t exist or may have moved.') : message}
    >
      <Button asChild className="mt-6 w-full">
        <Link to="/">
          <ArrowLeft className="h-4 w-4" /> {t('Back to dashboard')}
        </Link>
      </Button>
    </AuthCard>
  );
}
