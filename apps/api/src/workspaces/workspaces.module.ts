import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { GitHubCoreModule } from '../scm/github/github-core.module';
import { AuditEventsModule } from '../audit/audit-events.module';

@Module({
  imports: [AuthModule, GitHubCoreModule, AuditEventsModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
