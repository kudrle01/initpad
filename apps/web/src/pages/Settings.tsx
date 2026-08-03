import { PageHeader } from '@/components/molecules/PageHeader';
import { EmailVerificationSettings } from '@/components/organisms/settings/EmailVerificationSettings';
import { GitAccessSettings } from '@/components/organisms/settings/GitAccessSettings';
import { GitHubIntegrationSettings } from '@/components/organisms/settings/GitHubIntegrationSettings';
import { WorkspaceAdministrationSettings } from '@/components/organisms/settings/WorkspaceAdministrationSettings';
import { WorkspaceMembersSettings } from '@/components/organisms/settings/WorkspaceMembersSettings';

export default function Settings() {
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="flex max-w-2xl flex-col gap-6">
        <EmailVerificationSettings />
        <GitAccessSettings />
        <GitHubIntegrationSettings />
        <WorkspaceMembersSettings />
        <WorkspaceAdministrationSettings />
      </div>
    </div>
  );
}
