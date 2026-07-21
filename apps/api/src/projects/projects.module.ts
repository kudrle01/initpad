import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningController } from './provisioning.controller';
import { ActivityController } from './activity.controller';
import { CiController } from './ci.controller';
import { ScmWebhookController } from './scm-webhook.controller';
import { TemplatesModule } from '../templates/templates.module';
import { GeneratorModule } from '../generator/generator.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { TargetsModule } from '../targets/targets.module';
import { GitHubCoreModule } from '../scm/github/github-core.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';

@Module({
  imports: [TemplatesModule, GeneratorModule, DeploymentModule, TargetsModule, GitHubCoreModule, AuthModule, WorkspacesModule, ArtifactsModule],
  providers: [ProjectsService, ImportService, ProvisioningService],
  controllers: [ProjectsController, ImportController, ProvisioningController, ActivityController, CiController, ScmWebhookController],
})
export class ProjectsModule {}
