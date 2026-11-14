import { useEffect, useState } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { AuthCard } from '@/components/molecules/AuthCard';
import { HelpLink } from '@/components/molecules/HelpLink';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isChunkLoadError, reloadForNewBuild } from '@/lib/stale-build';

// Router errorElement — catches 404s and unexpected errors and shows a friendly page.
export default function RouteError() {
  const error = useRouteError();
  const staleBuild = isChunkLoadError(error);
  // A page of the previous release is gone after an update: reload once.
  const [reloading, setReloading] = useState(staleBuild);
  useEffect(() => {
    if (staleBuild) setReloading(reloadForNewBuild());
  }, [staleBuild]);

  if (staleBuild) {
    return (
      <AuthCard
        align="center"
        title={t('InitPad was updated')}
        description={
          reloading
            ? t('Loading the new version…')
            : t('This page belongs to the previous version. Reload to open the new one.')
        }
      >
        {!reloading && (
          <Button className="mt-6 w-full" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" /> {t('Reload')}
          </Button>
        )}
      </AuthCard>
    );
  }

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
      {!is404 && (
        <p className="mt-4 text-center text-sm">
          <HelpLink topic="troubleshooting">{t('Troubleshooting')}</HelpLink>
        </p>
      )}
    </AuthCard>
  );
}
