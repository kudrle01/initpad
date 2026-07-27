import { Module } from '@nestjs/common';
import { TargetsService } from './targets.service';
import { TargetsController } from './targets.controller';
import { TargetAllocationsService } from './target-allocations.service';
import { TargetAllocationsController } from './target-allocations.controller';
import { DeploymentModule } from '../deployment/deployment.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [DeploymentModule, AuthModule, WorkspacesModule],
  providers: [TargetsService, TargetAllocationsService],
  controllers: [TargetsController, TargetAllocationsController],
  exports: [TargetsService, TargetAllocationsService],
})
export class TargetsModule {}
