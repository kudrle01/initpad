import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TemplatesModule } from './templates/templates.module';
import { ProjectsModule } from './projects/projects.module';
import { GeneratorModule } from './generator/generator.module';
import { DeploymentModule } from './deployment/deployment.module';
import { TargetsModule } from './targets/targets.module';
import { OidcModule } from './oauth/oidc.module';
import { MeModule } from './me/me.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { AdminModule } from './admin/admin.module';
import { IdentityModule } from './identity/identity.module';
import { GitHubModule } from './scm/github/github.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AgentsModule } from './agents/agents.module';
import { AuditEventsModule } from './audit/audit-events.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { UpdatesModule } from './updates/updates.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OidcModule,
    TemplatesModule,
    GeneratorModule,
    DeploymentModule,
    TargetsModule,
    ProjectsModule,
    MeModule,
    WorkspacesModule,
    AdminModule,
    IdentityModule,
    GitHubModule,
    ArtifactsModule,
    AgentsModule,
    AuditEventsModule,
    UpdatesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
