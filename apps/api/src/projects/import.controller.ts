import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ImportService } from './import.service';
import { ProjectsService } from './projects.service';
import { ImportPreflightDto, ImportProjectDto } from './dto/import-project.dto';

// A distinct base path ('projects/import') keeps these off the ':id' routes of
// ProjectsController so 'repos'/'preflight' are never read as a project id.
@Controller('projects/import')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('repos')
  repos(@CurrentUser() userId: string, @Headers('x-workspace-id') workspaceId?: string) {
    return this.imports.listImportable(userId, workspaceId);
  }

  @Post('preflight')
  preflight(
    @Body() dto: ImportPreflightDto,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.imports.preflight(userId, workspaceId, dto);
  }

  @Post()
  create(
    @Body() dto: ImportProjectDto,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.projects.importExisting(dto, userId, workspaceId);
  }
}
