import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsLifecycleService } from './projects-lifecycle.service';
import { ProjectsController } from './projects.controller';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ProvisioningService } from './provisioning.service';
import { ProvisioningController } from './provisioning.controller';
import { ActivityController } from './activity.controller';
import { AppConfigService } from './app-config.service';
import { AppConfigController } from './app-config.controller';
import { CiController } from './ci.controller';
import { ScmWebhookController } from './scm-webhook.controller';
import { config } from '../config';
import { TemplatesModule } from '../templates/templates.module';
import { GeneratorModule } from '../generator/generator.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { TargetsModule } from '../targets/targets.module';
import { GitHubCoreModule } from '../scm/github/github-core.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { AuditEventsModule } from '../audit/audit-events.module';
import { ControlPlaneLeaseService } from '../common/control-plane-lease.service';

@Module({
  imports: [
    TemplatesModule,
    GeneratorModule,
    DeploymentModule,
    TargetsModule,
    GitHubCoreModule,
    AuthModule,
    WorkspacesModule,
    ArtifactsModule,
    AuditEventsModule,
  ],
  providers: [
    ProjectsService,
    ProjectsLifecycleService,
    ControlPlaneLeaseService,
    ImportService,
    ProvisioningService,
    AppConfigService,
  ],
  controllers: [
    ProjectsController,
    ImportController,
    ProvisioningController,
    ActivityController,
    AppConfigController,
    CiController,
    // Gitea system webhooks only exist where InitPad runs Gitea (ADR-153).
    ...(config.edition === 'self-hosted' ? [ScmWebhookController] : []),
  ],
  exports: [AppConfigService],
})
export class ProjectsModule {}
