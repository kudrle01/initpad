import { Module } from '@nestjs/common';
import { ScmModule } from '../scm.module';
import { GitHubAppService } from './github-app.service';
import { GitHubInstallationService } from './github-installation.service';
import { GitHubOAuthService } from './github-oauth.service';
import { GitHubScmProvider } from './github-scm.provider';
import { GitHubUserCredentialService } from './github-user-credential.service';
import { ScmRegistry } from './scm-registry';
import { WorkspaceScmService } from '../workspace-scm.service';

// Provider-only module shared by projects and workspaces. It intentionally has
// no controller/domain imports, which keeps GitHub adapter selection free of
// circular dependencies with WorkspacesModule and ProjectsModule.
@Module({
  imports: [ScmModule],
  providers: [
    GitHubAppService,
    GitHubOAuthService,
    GitHubInstallationService,
    GitHubUserCredentialService,
    GitHubScmProvider,
    ScmRegistry,
    WorkspaceScmService,
  ],
  exports: [
    GitHubAppService,
    GitHubOAuthService,
    GitHubInstallationService,
    GitHubUserCredentialService,
    GitHubScmProvider,
    ScmRegistry,
    WorkspaceScmService,
  ],
})
export class GitHubCoreModule {}
