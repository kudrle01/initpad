import { Module } from '@nestjs/common';
import { GiteaService } from './gitea.service';
import { SCM_PROVIDER } from './scm-provider';

// The self-contained edition binds the SCM provider to Gitea. A hosted build
// selects the GitHub adapter behind the same SCM_PROVIDER token (ADR-030).
@Module({
  providers: [GiteaService, { provide: SCM_PROVIDER, useExisting: GiteaService }],
  exports: [GiteaService, SCM_PROVIDER],
})
export class ScmModule {}
