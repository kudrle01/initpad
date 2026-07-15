import { Injectable } from '@nestjs/common';
import { GiteaService } from '../gitea.service';
import { ScmProvider } from '../scm-provider';
import { GitHubScmProvider } from './github-scm.provider';

export type ScmKind = 'gitea' | 'github';

// Selects the SCM adapter by kind. The self-contained edition keeps Gitea as the
// default SCM_PROVIDER binding; the registry is how a caller reaches the GitHub
// adapter for a repository hosted there (ADR-030), behind the same interface.
@Injectable()
export class ScmRegistry {
  constructor(
    private readonly gitea: GiteaService,
    private readonly github: GitHubScmProvider,
  ) {}

  for(kind: ScmKind): ScmProvider {
    return kind === 'github' ? this.github : this.gitea;
  }
}
