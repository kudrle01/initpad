import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AgentEnrollmentController } from './agent-enrollment.controller';
import { AgentJobsService } from './agent-jobs.service';
import { AgentManagementController } from './agent-management.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [AuthModule, WorkspacesModule, ArtifactsModule],
  controllers: [AgentEnrollmentController, AgentManagementController],
  providers: [AgentsService, AgentJobsService],
  exports: [AgentsService, AgentJobsService],
})
export class AgentsModule {}
