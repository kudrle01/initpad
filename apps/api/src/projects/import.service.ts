import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { TemplatesService } from '../templates/templates.service';
import { templateRuntime } from '../domain/capability';
import { ImportPreflightDto } from './dto/import-project.dto';
import { WorkspaceScmService } from '../scm/workspace-scm.service';

const PROJECT_NAME = /^[a-z][a-z0-9-]{1,40}$/;

export interface ImportableRepo {
  provider: 'gitea' | 'github';
  repositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  repoUrl: string;
  installationId: string | null;
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
  hasCompatibleWorkflow: boolean;
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
    private readonly workspaceScm: WorkspaceScmService,
  ) {}

  async listImportable(userId: string, requestedWorkspaceId?: string): Promise<ImportableRepo[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspaceId, 'read');
    const repos = await this.workspaceScm.listRepositories(userId, workspaceId);
    const existing = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { scmProvider: true, scmRepositoryId: true, scmFullName: true },
    });
    return repos.map((r) => ({
      ...r,
      alreadyImported: existing.some(
        (project) =>
          (project.scmRepositoryId != null &&
            project.scmProvider === r.provider &&
            project.scmRepositoryId === r.repositoryId) ||
          (project.scmRepositoryId == null &&
            project.scmProvider === r.provider &&
            project.scmFullName === r.fullName),
      ),
    }));
  }

  async preflight(
    userId: string,
    requestedWorkspaceId: string | undefined,
    dto: ImportPreflightDto,
  ): Promise<ImportPreflight> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    await this.workspaces.require(userId, workspaceId, 'write');
    const template = this.templates.get(dto.templateId);
    const { repo, actor } = await this.workspaceScm.repository(
      userId,
      workspaceId,
      dto.repositoryId,
    );
    const scm = this.workspaceScm.provider(repo.provider);

    const runtime = templateRuntime(template);
    const warnings: string[] = [];
    if (repo.empty) warnings.push('The repository is empty — push code before importing.');

    const dockerfile = repo.empty
      ? null
      : await scm.readFile(repo, 'Dockerfile', repo.defaultBranch, actor);
    const hasDockerfile = dockerfile != null;
    // Runtime contract: everything but a static site builds from a Dockerfile.
    if (!hasDockerfile && runtime !== 'static') {
      warnings.push(
        `No Dockerfile on '${repo.defaultBranch}' — the '${template.name}' template builds the image from one.`,
      );
    }
    const workflowPath = repo.provider === 'github'
      ? '.github/workflows/ci.yml'
      : '.gitea/workflows/ci.yml';
    const workflow = repo.empty
      ? null
      : await scm.readFile(repo, workflowPath, repo.defaultBranch, actor);
    const hasBaseWorkflow = Boolean(
      workflow?.includes('INITPAD_PLATFORM_URL') &&
      workflow.includes('INITPAD_DEPLOY_TOKEN'),
    );
    const hasArtifactHandoff = repo.provider !== 'github' || Boolean(
      workflow?.includes('artifact-id') &&
      workflow.includes('artifact-digest') &&
      workflow.includes('archive: false'),
    );
    const hasCompatibleWorkflow = hasBaseWorkflow && hasArtifactHandoff;
    if (!hasCompatibleWorkflow) {
      warnings.push(
        repo.provider === 'github' && hasBaseWorkflow
          ? `The GitHub workflow at '${workflowPath}' uses the legacy callback — add the immutable artifact id/digest handoff before importing.`
          : `No InitPad-compatible workflow at '${workflowPath}' — add the CI callback before importing.`,
      );
    }

    const nameTaken =
      (await this.prisma.project.findFirst({ where: { workspaceId, name: repo.name } })) != null;
    if (nameTaken) warnings.push(`This workspace already has a project named '${repo.name}'.`);
    const nameValid = PROJECT_NAME.test(repo.name);
    if (!nameValid) {
      warnings.push(
        `'${repo.name}' is not a valid project name (lowercase letters, digits and hyphens, 2–41 chars).`,
      );
    }

    return {
      repo: repo.fullName,
      branch: repo.defaultBranch,
      runtime,
      hasDockerfile,
      hasCompatibleWorkflow,
      alreadyImported: nameTaken,
      canImport:
        !repo.empty &&
        !nameTaken &&
        nameValid &&
        (runtime === 'static' || hasDockerfile) &&
        hasCompatibleWorkflow,
      warnings,
    };
  }
}
