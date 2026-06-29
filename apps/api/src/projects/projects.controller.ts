import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { EnvName } from '../domain/types';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
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
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Post(':id/promote/:env')
  promote(@Param('id') id: string, @Param('env') env: EnvName) {
    return this.projects.promote(id, env);
  }
}
