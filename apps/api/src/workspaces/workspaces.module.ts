import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { GitHubCoreModule } from '../scm/github/github-core.module';
import { AuditEventsModule } from '../audit/audit-events.module';
import { WorkspacePortfolioService } from './workspace-portfolio.service';
import { WorkspaceMetricsService } from './workspace-metrics.service';
import { WorkspaceCapacityService } from './workspace-capacity.service';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { InvitationsController } from './invitations.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, GitHubCoreModule, AuditEventsModule, MailModule],
  controllers: [WorkspacesController, InvitationsController],
  providers: [
    WorkspacesService,
    WorkspacePortfolioService,
    WorkspaceMetricsService,
    WorkspaceCapacityService,
    WorkspaceInvitationsService,
  ],
  exports: [WorkspacesService, WorkspaceCapacityService],
})
export class WorkspacesModule {}
