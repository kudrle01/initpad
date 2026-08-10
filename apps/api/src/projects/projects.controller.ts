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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { SetTargetDto } from './dto/set-target.dto';
import { DeleteProjectDto } from './dto/delete-project.dto';
import { EnvName } from '../domain/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

function historyLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 100);
}

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
    // Detail reads trigger a throttled background fail-safe for SCM events
    // missed by webhooks. The current response stays independent of SCM latency;
    // once cleanup finishes, subsequent reads return 404.
    await this.projects.reconcileProject(id);
    return this.projects.get(id);
  }

  @Get(':id/commits')
  async commits(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Query('limit') rawLimit?: string,
  ) {
    await this.projects.assertAccess(id, userId, 'read');
    return this.projects.getCommits(id, historyLimit(rawLimit, 20));
  }

  @Get(':id/deployments')
  async deployments(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Query('limit') rawLimit?: string,
  ) {
    await this.projects.assertAccess(id, userId, 'read');
    return this.projects.deploymentHistory(id, historyLimit(rawLimit, 30));
  }

  @Get(':id/provisioning')
  async provisioning(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'read');
    return this.projects.latestProvisioning(id);
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

  @Post(':id/run-again')
  async runAgain(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.runAgain(id);
  }

  @Post(':id/rerun-failed-jobs')
  async rerunFailedJobs(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.rerunFailedJobs(id);
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

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Body() dto: DeleteProjectDto,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'maintain');
    return this.projects.remove(id, {
      deleteRemoteRepo: dto?.deleteRepository === true,
      confirmProduction: dto?.confirmProduction === true,
      confirmCleanupDebt: dto?.confirmCleanupDebt === true,
    });
  }
}
