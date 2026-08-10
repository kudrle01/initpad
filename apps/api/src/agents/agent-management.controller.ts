import { Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgentsService } from './agents.service';

@Controller('targets/:targetId/agent')
@UseGuards(JwtAuthGuard)
export class AgentManagementController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  get(@Param('targetId') targetId: string, @CurrentUser() userId: string) {
    return this.agents.getForTarget(targetId, userId);
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
}
