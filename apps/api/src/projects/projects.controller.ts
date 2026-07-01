import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { EnvName } from '../domain/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.projects.list(userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Get(':id/commits')
  commits(@Param('id') id: string) {
    return this.projects.getCommits(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() userId: string) {
    return this.projects.create(dto, userId);
  }

  @Post(':id/promote/:env')
  promote(@Param('id') id: string, @Param('env') env: EnvName) {
    return this.projects.promote(id, env);
  }

  @Post(':id/redeploy/:env')
  redeploy(@Param('id') id: string, @Param('env') env: EnvName) {
    return this.projects.redeploy(id, env);
  }

  @Get(':id/logs/:env')
  async logs(@Param('id') id: string, @Param('env') env: EnvName) {
    return { logs: await this.projects.envLogs(id, env) };
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.projects.remove(id, userId);
  }
}
