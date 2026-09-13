import { Body, Controller, Get, Headers, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimited } from '../auth/rate-limited.decorator';
import { RATE_LIMITS } from '../auth/rate-limit.policy';
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
import { PublicEndpoint } from '../auth/public-endpoint.decorator';

@Controller('agent')
@PublicEndpoint('agent-credential')
export class AgentEnrollmentController {
  constructor(
    private readonly agents: AgentsService,
    private readonly jobs: AgentJobsService,
  ) {}

  @Post('enroll')
  @RateLimited(RATE_LIMITS.agentEnroll)
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

  @Get('jobs/:jobId/artifact')
  async downloadJobArtifact(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-initpad-job-lease') leaseToken: string | undefined,
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const artifact = await this.jobs.openArtifact(authorization, jobId, leaseToken);
    response.setHeader('cache-control', 'private, no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-initpad-artifact-sha256', artifact.sha256);
    return new StreamableFile(artifact.stream, {
      type: 'application/x-tar',
      length: artifact.sizeBytes,
      disposition: 'attachment; filename="initpad-image.tar"',
    });
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
