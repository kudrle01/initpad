import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

// errorElement routeru – zachytí 404 i neočekávané chyby a ukáže přívětivou stránku.
export default function RouteError() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const message = isRouteErrorResponse(error)
    ? error.statusText || 'Something went wrong'
    : error instanceof Error
      ? error.message
      : 'Something went wrong';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card p-9 text-center shadow-sm">
        <div className="text-4xl font-bold text-primary">{is404 ? '404' : 'Oops'}</div>
        <div className="text-base font-semibold">
          {is404 ? 'Page not found' : 'Something went wrong'}
        </div>
        <p className="text-sm text-muted-foreground">
          {is404 ? 'This page doesn’t exist or may have moved.' : message}
        </p>
        <Button asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
