import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TargetsModule } from '../targets/targets.module';
import { AgentEnrollmentController } from './agent-enrollment.controller';
import { AgentJobsService } from './agent-jobs.service';
import { AgentManagementController } from './agent-management.controller';
import { AgentsService } from './agents.service';
import { AuditEventsModule } from '../audit/audit-events.module';

@Module({
  imports: [AuthModule, WorkspacesModule, ArtifactsModule, TargetsModule, AuditEventsModule],
  controllers: [AgentEnrollmentController, AgentManagementController],
  providers: [AgentsService, AgentJobsService],
  exports: [AgentsService, AgentJobsService],
})
export class AgentsModule {}
