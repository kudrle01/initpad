import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GiteaService } from '../scm/gitea.service';
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
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  private readonly logger = new Logger('MeController');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitea: GiteaService,
  ) {}

  @Get('git-access')
  async gitAccess(@CurrentUser() userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let token = decryptSecret(user.accessToken);

    // The stored token may not be a usable PAT (SSO accounts store an OAuth2
    // JWT, which git-over-HTTP rejects). In that case issue a fresh PAT and
    // persist it for next time.
    if (!isPat(token)) {
      try {
        token = await this.gitea.issueCloneToken(user.username);
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
