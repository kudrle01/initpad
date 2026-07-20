import { Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ProjectsService } from './projects.service';
import { ProvisioningService } from './provisioning.service';

// Workspace-wide visibility is essential for failures that happen before a
// Project row exists. Mutations retain the same RBAC boundary as project work:
// write to retry, maintain to clean external state.
@Controller('provisioning')
@UseGuards(JwtAuthGuard)
export class ProvisioningController {
  constructor(
    private readonly provisioning: ProvisioningService,
    private readonly projects: ProjectsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async list(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') requestedWorkspaceId?: string,
  ) {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspaceId, 'read');
    return this.provisioning.listWorkspace(workspaceId, userId);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.projects.retryProvisioning(id, userId);
  }

  @Post(':id/cleanup')
  @HttpCode(204)
  cleanup(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.projects.cleanupProvisioning(id, userId);
  }
}
