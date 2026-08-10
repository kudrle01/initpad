import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentEnrollmentController } from './agent-enrollment.controller';
import { AgentManagementController } from './agent-management.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [AgentEnrollmentController, AgentManagementController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
