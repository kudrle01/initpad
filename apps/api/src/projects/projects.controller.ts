import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
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
import { RollbackProjectDto } from './dto/rollback-project.dto';
import { RequestWorkloadDiagnosticDto } from './dto/request-workload-diagnostic.dto';
import { EnvName } from '../domain/types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuditEventsService, type AuditDetailValue } from '../audit/audit-events.service';
import type { Project } from '../domain/types';
import {
  CreateProductionDeploymentRequestDto,
  ReviewProductionDeploymentRequestDto,
} from './dto/production-deployment-request.dto';

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
  constructor(
    private readonly projects: ProjectsService,
    @Inject(AuditEventsService)
    private readonly auditEvents: Pick<AuditEventsService, 'record'> = {
      record: () => Promise.resolve(),
    },
  ) {}

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

  @Get(':id/production-request')
  productionRequest(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.projects.latestProductionRequest(id, userId);
  }

  @Post(':id/production-request')
  createProductionRequest(
    @Param('id') id: string,
    @Body() dto: CreateProductionDeploymentRequestDto,
    @CurrentUser() userId: string,
  ) {
    return this.projects.requestProductionDeployment(id, userId, dto);
  }

  @Post(':id/production-request/:requestId/approve')
  approveProductionRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewProductionDeploymentRequestDto,
    @CurrentUser() userId: string,
  ) {
    return this.projects.approveProductionDeployment(id, requestId, userId, dto.note);
  }

  @Post(':id/production-request/:requestId/reject')
  rejectProductionRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewProductionDeploymentRequestDto,
    @CurrentUser() userId: string,
  ) {
    return this.projects.rejectProductionDeployment(id, requestId, userId, dto.note);
  }

  @Post(':id/production-request/:requestId/cancel')
  cancelProductionRequest(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @CurrentUser() userId: string,
  ) {
    return this.projects.cancelProductionDeployment(id, requestId, userId);
  }

  @Post()
  async create(
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
    return this.projects.promote(id, env, userId);
  }

  @Post(':id/redeploy/:env')
  async redeploy(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.redeploy(id, env, userId);
  }

  @Get(':id/rollback/:env')
  async rollbackPreview(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'maintain');
    return this.projects.rollbackPreview(id, env);
  }

  @Post(':id/rollback/:env')
  async rollback(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @Body() dto: RollbackProjectDto,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'maintain');
    return this.projects.rollback(id, env, dto.candidateOperationId, dto.stateToken, userId);
  }

  // Application logs may contain sensitive business data even after secrets
  // are masked elsewhere. Viewer/read access is therefore intentionally not
  // sufficient for either reading or refreshing workload diagnostics.
  @Get(':id/diagnostics/:env')
  async workloadDiagnostic(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.workloadDiagnostic(id, env);
  }

  @Post(':id/diagnostics/:env')
  async requestWorkloadDiagnostic(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @Body() dto: RequestWorkloadDiagnosticDto,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    const diagnostic = await this.projects.requestWorkloadDiagnostic(
      id,
      env,
      userId,
      dto.requestId,
    );
    const project = await this.projects.get(id);
    await this.recordProject(project, userId, 'environment.diagnostic_requested', {
      environment: env,
    });
    return diagnostic;
  }

  @Post(':id/run-again')
  async runAgain(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.runAgain(id, userId);
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
    return this.projects.stopEnv(id, env, userId);
  }

  @Post(':id/start/:env')
  async startEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.startEnv(id, env, userId);
  }

  @Post(':id/teardown/:env')
  async removeEnv(
    @Param('id') id: string,
    @Param('env') env: EnvName,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'write');
    return this.projects.removeEnv(id, env, userId);
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
    const project = await this.projects.bindTarget(id, env, dto.targetId);
    await this.recordProject(project, userId, 'environment.target_changed', {
      environment: env,
      targetId: dto.targetId,
    });
    return project;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Body() dto: DeleteProjectDto,
    @CurrentUser() userId: string,
  ) {
    await this.projects.assertAccess(id, userId, 'maintain');
    const project = await this.projects.get(id);
    await this.projects.remove(id, {
      deleteRemoteRepo: dto?.deleteRepository === true,
      confirmProduction: dto?.confirmProduction === true,
      confirmCleanupDebt: dto?.confirmCleanupDebt === true,
    });
    await this.recordProject(project, userId, 'project.deleted', {
      repositoryDeleted: dto?.deleteRepository === true,
    });
  }

  private recordProject(
    project: Project,
    actorUserId: string,
    action: string,
    details?: Record<string, AuditDetailValue>,
  ) {
    return this.auditEvents.record({
      workspaceId: project.workspaceId,
      actorUserId,
      action,
      resourceType: 'project',
      resourceId: project.id,
      resourceName: project.name,
      details,
    });
  }
}
