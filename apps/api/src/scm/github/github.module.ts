import { Module } from '@nestjs/common';
import { GitHubAppService } from './github-app.service';
import { GitHubOAuthService } from './github-oauth.service';
import { GitHubAuthController } from './github-auth.controller';
import { AuthModule } from '../../auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';

// GitHub App integration for the hosted edition. Inert without credentials.
// AuthModule provides AuthService + JwtService (session issuing/verification);
// IdentityModule provides ExternalIdentityService (immutable-id linking).
@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [GitHubAuthController],
  providers: [GitHubAppService, GitHubOAuthService],
  exports: [GitHubAppService, GitHubOAuthService],
})
export class GitHubModule {}
