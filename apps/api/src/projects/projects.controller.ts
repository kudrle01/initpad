import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { SetTargetDto } from './dto/set-target.dto';
import { EnvName } from '../domain/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Project access is derived from workspace membership. Read operations allow
// every member; mutations require a non-viewer role.
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() userId: string, @Headers('x-workspace-id') workspaceId?: string) {
    return this.projects.list(userId, workspaceId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'read');
    // Detail reads reconcile too — refreshing the detail of a project whose
    // repository was deleted in Gitea cleans it up and returns 404.
    await this.projects.reconcileProject(id);
    return this.projects.get(id);
  }

  @Get(':id/commits')
  async commits(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'read');
    return this.projects.getCommits(id);
  }

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.projects.create(dto, userId, workspaceId);
  }

  @Post(':id/promote/:env')
  async promote(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.promote(id, env);
  }

  @Post(':id/redeploy/:env')
  async redeploy(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.redeploy(id, env);
  }

  @Post(':id/stop/:env')
  async stopEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.stopEnv(id, env);
  }

  @Post(':id/start/:env')
  async startEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.startEnv(id, env);
  }

  @Post(':id/teardown/:env')
  async removeEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.removeEnv(id, env);
  }

  // Point the environment at a target (built-in infra or the user's own
  // server). Used to configure or change where an environment deploys.
  @Put(':id/target/:env')
  async setTarget(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @Body() dto: SetTargetDto,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.bindTarget(id, env, dto.targetId);
  }

  @Get(':id/logs/:env')
  async logs(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'read');
    return { logs: await this.projects.envLogs(id, env) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'maintain');
    return this.projects.remove(id);
  }
}
