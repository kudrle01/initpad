import { Notice } from '@/components/molecules/Notice';
import { t } from '@/i18n';

interface Props {
  builtInAppsShareSession: boolean;
}

/** Warns that built-in applications receive the InitPad session (ADR-137). */
export function SessionExposureNotice({ builtInAppsShareSession }: Props) {
  if (!builtInAppsShareSession) return null;
  return (
    <Notice tone="warning" role="status" title={t('Deployed applications can read sessions')}>
      {t(
        'Applications on the built-in Docker server use this InitPad host name over HTTP, so browsers send them the InitPad session of anyone who opens them. Serve InitPad over HTTPS (server profile) or set INITPAD_DEPLOY_PUBLIC_HOST to a different host name before other people deploy here.',
      )}
    </Notice>
  );
}
