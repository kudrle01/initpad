import { Body, Controller, Get, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ImportService } from './import.service';
import { ProjectsService } from './projects.service';
import { ImportPreflightDto, ImportProjectDto } from './dto/import-project.dto';
import { AuditEventsService } from '../audit/audit-events.service';

// A distinct base path ('projects/import') keeps these off the ':id' routes of
// ProjectsController so 'repos'/'preflight' are never read as a project id.
@Controller('projects/import')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly projects: ProjectsService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: async () => undefined,
    },
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
  async create(
    @Body() dto: ImportProjectDto,
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    const project = await this.projects.importExisting(dto, userId, workspaceId);
    await this.auditEvents.record({
      workspaceId: project.workspaceId,
      actorUserId: userId,
      action: 'project.imported',
      resourceType: 'project',
      resourceId: project.id,
      resourceName: project.name,
      details: { provider: project.scm.provider },
    });
    return project;
  }
}
