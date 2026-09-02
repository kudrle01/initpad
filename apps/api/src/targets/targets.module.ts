import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';
import { TargetAllocationsService } from './target-allocations.service';
import { TargetAllocationsController } from './target-allocations.controller';
import { DeploymentModule } from '../deployment/deployment.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { GatewayRoutesService } from './gateway-routes.service';
import { AuditEventsModule } from '../audit/audit-events.module';

@Module({
  imports: [DeploymentModule, AuthModule, WorkspacesModule, AuditEventsModule],
  providers: [TargetsService, TargetAllocationsService, GatewayRoutesService],
  controllers: [TargetsController, TargetAllocationsController],
  exports: [TargetsService, TargetAllocationsService, GatewayRoutesService],
})
export class TargetsModule {}
