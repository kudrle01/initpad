import { Body, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard';
import { AgentsService } from './agents.service';
import { AgentJobsService } from './agent-jobs.service';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import {
  AgentClaimJobDto,
  AgentJobCompleteDto,
  AgentJobProgressDto,
  AgentLeaseDto,
} from './dto/agent-job.dto';
import { EnrollAgentDto } from './dto/enroll-agent.dto';

@Controller('agent')
export class AgentEnrollmentController {
  constructor(
    private readonly agents: AgentsService,
    private readonly jobs: AgentJobsService,
  ) {}

  @Post('enroll')
  @UseGuards(AuthRateLimitGuard)
  enroll(@Body() dto: EnrollAgentDto) {
    return this.agents.enroll(dto);
  }

  @Post('heartbeat')
  heartbeat(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: AgentHeartbeatDto,
  ) {
    return this.agents.heartbeat(authorization, dto);
  }

  @Post('jobs/claim')
  claimJob(
    @Headers('authorization') authorization: string | undefined,
    @Body() _dto: AgentClaimJobDto,
  ) {
    return this.jobs.claim(authorization);
  }

  @Post('jobs/:jobId/lease')
  renewJobLease(
    @Headers('authorization') authorization: string | undefined,
    @Param('jobId') jobId: string,
    @Body() dto: AgentLeaseDto,
  ) {
    return this.jobs.renew(authorization, jobId, dto.leaseToken);
  }

  @Post('jobs/:jobId/progress')
  reportJobProgress(
    @Headers('authorization') authorization: string | undefined,
    @Param('jobId') jobId: string,
    @Body() dto: AgentJobProgressDto,
  ) {
    return this.jobs.progress(authorization, jobId, dto);
  }

  @Post('jobs/:jobId/complete')
  completeJob(
    @Headers('authorization') authorization: string | undefined,
    @Param('jobId') jobId: string,
    @Body() dto: AgentJobCompleteDto,
  ) {
    return this.jobs.complete(authorization, jobId, dto);
  }
}
