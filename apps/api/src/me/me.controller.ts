import { Controller, Get, Header, Inject, Logger, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScmProvider, SCM_PROVIDER } from '../scm/scm-provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../common/secret';

// A Gitea personal access token (PAT) is 40 hex characters. Anything else
// (e.g. an OAuth2 JWT stored after an SSO login) cannot be used for
// git-over-HTTP authentication.
const isPat = (t: string) => /^[0-9a-f]{40}$/i.test(t);

/**
 * Account endpoints for the signed-in user. "git-access" issues a personal
 * Gitea token (PAT) for git-over-HTTP, so the developer can configure
 * credentials once and clone private repositories without password prompts.
 * The token can clone and push code only (ADR-134).
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  private readonly logger = new Logger('MeController');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCM_PROVIDER) private readonly scm: ScmProvider,
  ) {}

  @Get('git-access')
  @Header('Cache-Control', 'private, no-store')
  async gitAccess(@CurrentUser() userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // GitHub-only (SaaS) accounts have no embedded-Gitea credential.
    if (user.giteaId == null) {
      return { username: user.username, token: null, giteaUrl: config.gitea.url };
    }
    let token = user.accessToken ? decryptSecret(user.accessToken) : '';

    // The stored token may be missing (revoked by a password reset) or not a
    // usable PAT (SSO accounts store an OAuth2 JWT, which git-over-HTTP
    // rejects). In that case issue a fresh PAT and persist it for next time.
    if (!isPat(token)) {
      try {
        token = await this.scm.issueCloneToken(user.username);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { accessToken: encryptSecret(token) },
        });
      } catch (e) {
        this.logger.warn(`Could not issue git token for ${user.username}: ${(e as Error).message}`);
        return { username: user.username, token: null, giteaUrl: config.gitea.url };
      }
    }

    return { username: user.username, token, giteaUrl: config.gitea.url };
  }
}
