import { Module } from '@nestjs/common';
import { GitHubAppService } from './github-app.service';
import { GitHubOAuthService } from './github-oauth.service';
import { GitHubInstallationService } from './github-installation.service';
import { GitHubScmProvider } from './github-scm.provider';
import { ScmRegistry } from './scm-registry';
import { GitHubAuthController } from './github-auth.controller';
import { GitHubWebhookController } from './github-webhook.controller';
import { GitHubStatusController } from './github-status.controller';
import { AuthModule } from '../../auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { ScmModule } from '../scm.module';

// GitHub App integration for the hosted edition. Inert without credentials.
// AuthModule provides AuthService + JwtService; IdentityModule provides
// ExternalIdentityService; ScmModule provides the Gitea adapter the registry
// selects alongside the GitHub one.
@Module({
  imports: [AuthModule, IdentityModule, ScmModule],
  controllers: [GitHubAuthController, GitHubWebhookController, GitHubStatusController],
  providers: [
    GitHubAppService,
    GitHubOAuthService,
    GitHubInstallationService,
    GitHubScmProvider,
    ScmRegistry,
  ],
  exports: [GitHubAppService, GitHubOAuthService, GitHubInstallationService, GitHubScmProvider, ScmRegistry],
})
export class GitHubModule {}
