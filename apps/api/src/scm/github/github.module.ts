import { Module } from '@nestjs/common';
import { GitHubAuthController } from './github-auth.controller';
import { GitHubWebhookController } from './github-webhook.controller';
import { GitHubStatusController } from './github-status.controller';
import { AuthModule } from '../../auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { GitHubSetupController } from './github-setup.controller';
import { GitHubCoreModule } from './github-core.module';

// GitHub App integration for the hosted edition. Inert without credentials.
// AuthModule provides AuthService + JwtService; IdentityModule provides
// ExternalIdentityService. Provider services live in GitHubCoreModule so the
// project/workspace domains can use the registry without importing controllers.
@Module({
  imports: [AuthModule, IdentityModule, GitHubCoreModule, WorkspacesModule],
  controllers: [
    GitHubAuthController,
    GitHubWebhookController,
    GitHubStatusController,
    GitHubSetupController,
  ],
  exports: [GitHubCoreModule],
})
export class GitHubModule {}
