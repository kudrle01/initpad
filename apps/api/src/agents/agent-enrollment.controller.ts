import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard';
import { AgentsService } from './agents.service';
import { AgentHeartbeatDto } from './dto/agent-heartbeat.dto';
import { EnrollAgentDto } from './dto/enroll-agent.dto';

@Controller('agent')
export class AgentEnrollmentController {
  constructor(private readonly agents: AgentsService) {}

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
}
