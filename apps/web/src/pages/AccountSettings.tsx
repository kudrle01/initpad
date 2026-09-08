import { PageHeader } from '@/components/molecules/PageHeader';
import { EmailVerificationSettings } from '@/components/organisms/settings/EmailVerificationSettings';
import { GitAccessSettings } from '@/components/organisms/settings/GitAccessSettings';
import { GitHubIntegrationSettings } from '@/components/organisms/settings/GitHubIntegrationSettings';

export default function AccountSettings() {
  return (
    <div>
      <PageHeader title="Account settings" />
      <div className="flex max-w-2xl flex-col gap-6">
        <EmailVerificationSettings />
        <GitAccessSettings />
        <GitHubIntegrationSettings />
      </div>
    </div>
  );
}
