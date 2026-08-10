import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthRateLimitGuard } from '../auth/auth-rate-limit.guard';
import { AgentsService } from './agents.service';
import { EnrollAgentDto } from './dto/enroll-agent.dto';

@Controller('agent')
export class AgentEnrollmentController {
  constructor(private readonly agents: AgentsService) {}

  @Post('enroll')
  @UseGuards(AuthRateLimitGuard)
  enroll(@Body() dto: EnrollAgentDto) {
    return this.agents.enroll(dto);
  }
}
