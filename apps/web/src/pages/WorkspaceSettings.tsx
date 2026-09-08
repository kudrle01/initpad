import { PageHeader } from '@/components/molecules/PageHeader';
import { WorkspaceAdministrationSettings } from '@/components/organisms/settings/WorkspaceAdministrationSettings';
import { WorkspaceMembersSettings } from '@/components/organisms/settings/WorkspaceMembersSettings';

export default function WorkspaceSettings() {
  return (
    <div>
      <PageHeader title="Workspace settings" />
      <div className="flex max-w-2xl flex-col gap-6">
        <WorkspaceMembersSettings />
        <WorkspaceAdministrationSettings />
      </div>
    </div>
  );
}
