import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgentsService } from './agents.service';
import { AgentJobsService } from './agent-jobs.service';
import {
  CreateAgentLifecycleTestDto,
  CreateAgentProbeJobDto,
  CreateGatewayPreflightDto,
} from './dto/agent-job.dto';
import { AgentUpdatesService } from './agent-updates.service';

@Controller('targets/:targetId/agent')
@UseGuards(JwtAuthGuard)
export class AgentManagementController {
  constructor(
    private readonly agents: AgentsService,
    private readonly jobs: AgentJobsService,
    private readonly updates: AgentUpdatesService,
  ) {}

  @Get()
  get(@Param('targetId') targetId: string, @CurrentUser() userId: string) {
    return this.agents.getForTarget(targetId, userId);
  }

  @Get('update')
  updateStatus(@Param('targetId') targetId: string, @CurrentUser() userId: string) {
    return this.updates.status(targetId, userId);
  }

  @Post('enrollment')
  issueEnrollment(@Param('targetId') targetId: string, @CurrentUser() userId: string) {
    return this.agents.issueEnrollment(targetId, userId);
  }

  @Delete()
  @HttpCode(204)
  disable(@Param('targetId') targetId: string, @CurrentUser() userId: string) {
    return this.agents.disable(targetId, userId);
  }

  @Get('jobs')
  listJobs(@Param('targetId') targetId: string, @CurrentUser() userId: string) {
    return this.jobs.list(targetId, userId);
  }

  @Post('jobs/probe')
  createProbeJob(
    @Param('targetId') targetId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateAgentProbeJobDto,
  ) {
    return this.jobs.createProbe(targetId, userId, dto);
  }

  @Post('jobs/lifecycle-test')
  createLifecycleTest(
    @Param('targetId') targetId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateAgentLifecycleTestDto,
  ) {
    return this.jobs.createLifecycleTest(targetId, userId, dto);
  }

  @Post('jobs/gateway-preflight')
  createGatewayPreflight(
    @Param('targetId') targetId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateGatewayPreflightDto,
  ) {
    return this.jobs.createGatewayPreflight(targetId, userId, dto);
  }
}
