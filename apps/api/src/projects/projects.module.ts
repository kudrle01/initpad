import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { TemplatesModule } from '../templates/templates.module';
import { GeneratorModule } from '../generator/generator.module';
import { DeploymentModule } from '../deployment/deployment.module';

@Module({
  imports: [TemplatesModule, GeneratorModule, DeploymentModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
})
export class ProjectsModule {}
