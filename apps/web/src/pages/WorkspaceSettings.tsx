import { useAuth } from '@/auth';
import { PageHeader } from '@/components/molecules/PageHeader';
import { WorkspaceAdministrationSettings } from '@/components/organisms/settings/WorkspaceAdministrationSettings';
import { WorkspaceMembersSettings } from '@/components/organisms/settings/WorkspaceMembersSettings';
import { WorkspaceCapacitySettings } from '@/components/organisms/settings/WorkspaceCapacitySettings';

export default function WorkspaceSettings() {
  const { activeWorkspace } = useAuth();
  return (
    <div>
      <PageHeader
        title="Workspace settings"
        description={
          activeWorkspace ? `Members, policy and limits of ${activeWorkspace.name}.` : undefined
        }
      />
      {/* People and policy are the working area; capacity is reference data. */}
      <div className="grid items-start gap-4 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <WorkspaceMembersSettings />
          <WorkspaceAdministrationSettings />
        </div>
        <WorkspaceCapacitySettings />
      </div>
    </div>
  );
}
