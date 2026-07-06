import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { CiController } from './ci.controller';
import { ScmWebhookController } from './scm-webhook.controller';
import { TemplatesModule } from '../templates/templates.module';
import { GeneratorModule } from '../generator/generator.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { ScmModule } from '../scm/scm.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TemplatesModule, GeneratorModule, DeploymentModule, ScmModule, AuthModule],
  providers: [ProjectsService],
  controllers: [ProjectsController, CiController, ScmWebhookController],
})
export class ProjectsModule {}
