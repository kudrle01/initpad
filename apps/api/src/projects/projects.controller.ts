import {
  Body,
  Controller,
  Delete,
  Get,
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

// Every operation on a concrete project first verifies ownership
// (assertOwner) — knowing a UUID must not grant access to someone else's
// project.
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.projects.list(userId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertOwner(id, userId);
    // Detail reads reconcile too — refreshing the detail of a project whose
    // repository was deleted in Gitea cleans it up and returns 404.
    await this.projects.reconcileProject(id);
    return this.projects.get(id);
  }

  @Get(':id/commits')
  async commits(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertOwner(id, userId);
    return this.projects.getCommits(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() userId: string) {
    return this.projects.create(dto, userId);
  }

  @Post(':id/promote/:env')
  async promote(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.promote(id, env);
  }

  @Post(':id/redeploy/:env')
  async redeploy(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.redeploy(id, env);
  }

  @Post(':id/stop/:env')
  async stopEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.stopEnv(id, env);
  }

  @Post(':id/start/:env')
  async startEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.startEnv(id, env);
  }

  @Post(':id/teardown/:env')
  async removeEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.removeEnv(id, env);
  }

  // Configure the environment's deployment target (prod: your own server).
  @Put(':id/target/:env')
  async setTarget(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @Body() dto: SetTargetDto,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.setTarget(id, env, dto);
  }

  // Remove the user target → revert to the platform's demo target.
  @Delete(':id/target/:env')
  async clearTarget(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return this.projects.clearTarget(id, env);
  }

  @Get(':id/logs/:env')
  async logs(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertOwner(id, userId);
    return { logs: await this.projects.envLogs(id, env) };
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.projects.remove(id, userId);
  }
}
