import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { TemplatesService } from '../templates/templates.service';
import { ScmProvider, ScmActor, SCM_PROVIDER } from '../scm/scm-provider';
import { templateRuntime } from '../domain/capability';
import { decryptSecret } from '../common/secret';
import { ImportPreflightDto } from './dto/import-project.dto';

const PROJECT_NAME = /^[a-z][a-z0-9-]{1,40}$/;

export interface ImportableRepo {
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  empty: boolean;
  alreadyImported: boolean;
}

export interface ImportPreflight {
  repo: string;
  branch: string;
  runtime: string;
  hasDockerfile: boolean;
  alreadyImported: boolean;
  canImport: boolean;
  warnings: string[];
}

/**
 * Importing an existing repository (Phase 3). Import never rewrites application
 * code: it lists the user's repositories, runs a preflight against the chosen
 * template's runtime contract, and (separately) records the project pointing at
 * the existing repo. Goes through the ScmProvider, so it is edition-neutral.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly templates: TemplatesService,
    @Inject(SCM_PROVIDER) private readonly scm: ScmProvider,
  ) {}

  private async actorFor(userId: string): Promise<ScmActor> {
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { username: owner.username, token: decryptSecret(owner.accessToken) };
  }

  async listImportable(userId: string, requestedWorkspaceId?: string): Promise<ImportableRepo[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspaceId, 'read');
    const actor = await this.actorFor(userId);
    const repos = await this.scm.listRepositories(actor);
    const existing = new Set(
      (await this.prisma.project.findMany({ where: { workspaceId }, select: { name: true } })).map(
        (p) => p.name,
      ),
    );
    return repos.map((r) => ({ ...r, alreadyImported: existing.has(r.name) }));
  }

  async preflight(
    userId: string,
    requestedWorkspaceId: string | undefined,
    dto: ImportPreflightDto,
  ): Promise<ImportPreflight> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspaceId, 'write');
    const template = this.templates.get(dto.templateId);
    const actor = await this.actorFor(userId);

    const repo = (await this.scm.listRepositories(actor)).find((r) => r.name === dto.repo);
    if (!repo) throw new NotFoundException(`Repository '${dto.repo}' not found`);

    const runtime = templateRuntime(template);
    const warnings: string[] = [];
    if (repo.empty) warnings.push('The repository is empty — push code before importing.');

    const dockerfile = repo.empty
      ? null
      : await this.scm.readFile(dto.repo, 'Dockerfile', repo.defaultBranch, actor);
    const hasDockerfile = dockerfile != null;
    // Runtime contract: everything but a static site builds from a Dockerfile.
    if (!hasDockerfile && runtime !== 'static') {
      warnings.push(
        `No Dockerfile on '${repo.defaultBranch}' — the '${template.name}' template builds the image from one.`,
      );
    }

    const nameTaken =
      (await this.prisma.project.findFirst({ where: { workspaceId, name: dto.repo } })) != null;
    if (nameTaken) warnings.push(`This workspace already has a project named '${dto.repo}'.`);
    const nameValid = PROJECT_NAME.test(dto.repo);
    if (!nameValid) {
      warnings.push(
        `'${dto.repo}' is not a valid project name (lowercase letters, digits and hyphens, 2–41 chars).`,
      );
    }

    return {
      repo: repo.fullName,
      branch: repo.defaultBranch,
      runtime,
      hasDockerfile,
      alreadyImported: nameTaken,
      canImport: !repo.empty && !nameTaken && nameValid,
      warnings,
    };
  }
}
