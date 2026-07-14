import { Module } from '@nestjs/common';
import { GitHubAppService } from './github-app.service';

// GitHub App integration for the hosted edition. Inert without credentials; the
// GitHub ScmProvider adapter and OAuth flow build on GitHubAppService.
@Module({
  providers: [GitHubAppService],
  exports: [GitHubAppService],
})
export class GitHubModule {}
