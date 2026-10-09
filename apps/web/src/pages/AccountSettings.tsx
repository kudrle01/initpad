import { PageHeader } from '@/components/molecules/PageHeader';
import { EmailVerificationSettings } from '@/components/organisms/settings/EmailVerificationSettings';
import { GitAccessSettings } from '@/components/organisms/settings/GitAccessSettings';
import { GitHubIntegrationSettings } from '@/components/organisms/settings/GitHubIntegrationSettings';
import { SessionsSettings } from '@/components/organisms/settings/SessionsSettings';
import { t } from '@/i18n';

export default function AccountSettings() {
  return (
    <div>
      <PageHeader
        title={t('Account settings')}
        description={t('Sign-in methods, signed-in browsers and Git access for your own account.')}
      />
      <div className="flex max-w-3xl flex-col gap-4 lg:gap-6">
        <EmailVerificationSettings />
        <GitAccessSettings />
        <GitHubIntegrationSettings />
        <SessionsSettings />
      </div>
    </div>
  );
}
