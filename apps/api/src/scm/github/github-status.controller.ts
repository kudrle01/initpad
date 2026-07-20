import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { config } from '../../config';
import { ExternalIdentityService } from '../../identity/external-identity.service';
import { GitHubInstallationService } from './github-installation.service';
import { GitHubAppService } from './github-app.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { GitHubUserCredentialService } from './github-user-credential.service';

// Connection status for the signed-in user's create/import preflight (ADR-030):
// is GitHub enabled, is an identity linked, and is the App installed on that
// account. A GitHub project can be created/imported only when all hold.
@Controller('scm/github')
@UseGuards(JwtAuthGuard)
export class GitHubStatusController {
  constructor(
    private readonly identities: ExternalIdentityService,
    private readonly installations: GitHubInstallationService,
    private readonly app: GitHubAppService,
    private readonly workspaces: WorkspacesService,
    private readonly credentials: GitHubUserCredentialService,
  ) {}

  @Get('status')
  async status(
    @CurrentUser() userId: string,
    @Headers('x-workspace-id') requestedWorkspaceId?: string,
  ) {
    const enabled = Boolean(
      config.github.clientId && config.github.clientSecret && config.github.callbackUrl,
    );
    const appConfigured = this.app.isConfigured() && Boolean(config.github.appSlug);
    const linked = (await this.identities.listForUser(userId)).find((i) => i.provider === 'github') ?? null;
    const workspace = await this.workspaces.resolve(userId, requestedWorkspaceId);
    const accesses = await this.installations.listForWorkspace(workspace.id);
    const rows = accesses.map(({ githubInstallation: record }) => ({
      id: record.id,
      accountId: record.accountId,
      accountLogin: record.accountLogin,
      accountType: record.accountType,
      repositorySelection: record.repositorySelection,
      suspended: record.suspendedAt != null,
      canCreate:
        record.accountType === 'Organization' ||
        (record.accountId != null && linked?.providerUserId === record.accountId),
    }));
    const present = rows.length > 0;
    const suspended = present && rows.every((row) => row.suspended);
    const credentialReady = linked
      ? await this.credentials.isReadyForUser(userId)
      : false;
    return {
      enabled,
      appConfigured,
      linked: Boolean(linked),
      login: linked?.username ?? null,
      credentialReady,
      canInstall: Boolean(linked) && appConfigured && ['owner', 'admin'].includes(workspace.role),
      installation: { present, suspended },
      installations: rows,
    };
  }
}
