import { Link } from 'react-router-dom';
import { AuthCard } from '@/components/molecules/AuthCard';
import { t } from '@/i18n';

/**
 * Shown when a single-use link page opens without its token, for example after
 * a reload: the page removes the token from the address once it has read it.
 */
export function MissingLinkToken({ title }: { title: string }) {
  return (
    <AuthCard
      title={title}
      description={t(
        'The link is missing its code. Open the whole link again from the message you received.',
      )}
    >
      <Link
        to="/login"
        className="text-link mt-5 inline-flex min-h-11 items-center text-sm font-medium sm:min-h-0"
      >
        {t('Back to sign in')}
      </Link>
    </AuthCard>
  );
}
