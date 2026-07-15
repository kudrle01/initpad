import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { config } from '../../config';
import { ExternalIdentityService } from '../../identity/external-identity.service';
import { GitHubInstallationService } from './github-installation.service';

// Connection status for the signed-in user's create/import preflight (ADR-030):
// is GitHub enabled, is an identity linked, and is the App installed on that
// account. A GitHub project can be created/imported only when all hold.
@Controller('scm/github')
@UseGuards(JwtAuthGuard)
export class GitHubStatusController {
  constructor(
    private readonly identities: ExternalIdentityService,
    private readonly installations: GitHubInstallationService,
  ) {}

  @Get('status')
  async status(@CurrentUser() userId: string) {
    const enabled = Boolean(
      config.github.clientId && config.github.clientSecret && config.github.callbackUrl,
    );
    const installUrl = config.github.appSlug
      ? `${config.github.oauthBaseUrl}/apps/${config.github.appSlug}/installations/new`
      : null;
    const linked = (await this.identities.listForUser(userId)).find((i) => i.provider === 'github') ?? null;
    let installation = { present: false, suspended: false };
    if (linked?.username) {
      const record = await this.installations.findByOwner(linked.username);
      if (record) installation = { present: true, suspended: record.suspendedAt != null };
    }
    return { enabled, installUrl, linked: Boolean(linked), login: linked?.username ?? null, installation };
  }
}
