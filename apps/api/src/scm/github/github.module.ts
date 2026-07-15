import { Module } from '@nestjs/common';
import { GitHubAppService } from './github-app.service';
import { GitHubOAuthService } from './github-oauth.service';
import { GitHubInstallationService } from './github-installation.service';
import { GitHubAuthController } from './github-auth.controller';
import { GitHubWebhookController } from './github-webhook.controller';
import { GitHubStatusController } from './github-status.controller';
import { AuthModule } from '../../auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';

// GitHub App integration for the hosted edition. Inert without credentials.
// AuthModule provides AuthService + JwtService (session issuing/verification);
// IdentityModule provides ExternalIdentityService (immutable-id linking).
@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [GitHubAuthController, GitHubWebhookController, GitHubStatusController],
  providers: [GitHubAppService, GitHubOAuthService, GitHubInstallationService],
  exports: [GitHubAppService, GitHubOAuthService, GitHubInstallationService],
})
export class GitHubModule {}
