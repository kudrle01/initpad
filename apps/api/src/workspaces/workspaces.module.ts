import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { ScmModule } from '../scm/scm.module';

@Module({
  imports: [AuthModule, ScmModule],
  controllers: [WorkspacesController, InvitationsController],
  providers: [WorkspacesService, InvitationsService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
