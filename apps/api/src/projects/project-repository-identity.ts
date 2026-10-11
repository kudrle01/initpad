import { Logger } from '@nestjs/common';
import { AuditEventsService } from '../audit/audit-events.service';
import { hashToken } from '../common/token';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProjectScmFields,
  ScmActor,
  ScmRepositoryIdentity,
  repositoryRef,
} from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { artifactImageRef, deploymentSlug, registryImageRef } from './project-deployment-identity';

// The same rule project creation and import apply to a new name.
const PROJECT_NAME = /^[a-z][a-z0-9-]{1,40}$/;

type IdentityRow = ProjectScmFields & { id: string };
type ResolveActor = (row: never) => ScmActor;

export type RepositoryRefresh = 'missing' | 'unknown' | 'current' | 'updated';

/**
 * Keeps a project's repository coordinates in step with the provider
 * (ADR-155). The immutable repository ID is the only identity: owner, name
 * and URL follow a rename, while the workload key and the image reference of
 * every existing build are frozen first so that nothing already deployed
 * changes its name.
 */
export class ProjectRepositoryIdentity {
  private readonly logger = new Logger('ProjectRepositoryIdentity');

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly resolveActor: ResolveActor,
    private readonly auditEvents?: Pick<AuditEventsService, 'record'>,
  ) {}

  /** Asks the provider by immutable ID and stores coordinates that changed. */
  async refresh(row: IdentityRow): Promise<RepositoryRefresh> {
    const repository = repositoryRef(row);
    const resolution = await this.workspaceScm
      .provider(repository.provider)
      .resolveRepository(repository, this.resolveActor(row as never));
    if (resolution.state !== 'found') return resolution.state;
    return (await this.apply(row.id, resolution.repository)) ? 'updated' : 'current';
  }

  /**
   * Stores coordinates the provider confirmed. Returns false when nothing
   * changed or when they belong to a different repository than the project's.
   */
  async apply(projectId: string, current: ScmRepositoryIdentity): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      if (!project || project.scmProvider !== current.provider) return false;
      if (project.scmRepositoryId && project.scmRepositoryId !== current.repositoryId) {
        return false;
      }
      const renamed =
        project.scmOwner !== current.owner || project.scmRepositoryName !== current.name;
      if (
        !renamed &&
        project.scmRepositoryId === current.repositoryId &&
        project.scmFullName === current.fullName &&
        project.scmDefaultBranch === current.defaultBranch &&
        project.repoUrl === current.repoUrl
      ) {
        return false;
      }

      const previous = repositoryRef(project);
      if (renamed) {
        // Builds made so far are tagged with the previous name. Give each its
        // own reference before the coordinates stop producing it.
        const unpinned = await tx.buildArtifact.findMany({
          where: { projectId, imageRef: null },
          select: { id: true, sourceProvider: true, commitSha: true, providerRunId: true },
        });
        for (const artifact of unpinned) {
          await tx.buildArtifact.update({
            where: { id: artifact.id },
            data: {
              imageRef:
                artifact.sourceProvider === 'github-actions'
                  ? artifactImageRef(previous, artifact)
                  : registryImageRef(previous, artifact.commitSha),
            },
          });
        }
      }

      // The project is named after its repository. It follows the rename when
      // the new name is a valid and free project name; otherwise it keeps its
      // own and only the repository coordinates change.
      let name = project.name;
      if (renamed && project.name === previous.name && PROJECT_NAME.test(current.name)) {
        const taken = await tx.project.findFirst({
          where: { workspaceId: project.workspaceId, name: current.name, NOT: { id: projectId } },
          select: { id: true },
        });
        if (!taken) name = current.name;
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          name,
          scmRepositoryId: current.repositoryId,
          scmOwner: current.owner,
          scmRepositoryName: current.name,
          scmFullName: current.fullName,
          scmDefaultBranch: current.defaultBranch,
          repoUrl: current.repoUrl,
          // A row written before the key was stored still derives it from the
          // coordinates that are about to change.
          deploymentKey: project.deploymentKey || deploymentSlug(previous),
        },
      });
      if (renamed) {
        await this.auditEvents?.record(
          {
            workspaceId: project.workspaceId,
            action: 'project.repository_renamed',
            resourceType: 'project',
            resourceId: projectId,
            resourceName: name,
            details: { previousRepository: previous.fullName, repository: current.fullName },
          },
          tx,
        );
        this.logger.log(`Repository ${previous.fullName} is now ${current.fullName}`);
      }
      return true;
    });
  }

  /**
   * A CI callback under a name no project carries: the workflow already runs
   * in the renamed repository. The token identifies the project, but the new
   * name is accepted only after the provider confirms it for the same ID.
   */
  async findRenamedByCiToken(repo: string, token: string) {
    if (!token) return null;
    const row = await this.prisma.project.findFirst({
      where: { ciDeployTokenHash: hashToken(token) },
      include: { owner: true },
    });
    if (!row) return null;
    if (row.scmFullName === repo) return row;
    const state = await this.refresh(row);
    if (state !== 'updated' && state !== 'current') return null;
    const fresh = await this.prisma.project.findUnique({ where: { id: row.id } });
    return fresh?.scmFullName === repo ? fresh : null;
  }

  /**
   * A renamed user or organization keeps its installation, and every
   * repository of an installation belongs to its account. The signed webhook
   * has already corrected the installation, so its projects follow without
   * asking the provider about each of them.
   */
  async followRenamedInstallationAccounts(): Promise<number> {
    const projects = await this.prisma.project.findMany({
      where: { scmProvider: 'github', scmInstallationId: { not: null } },
      include: { scmInstallation: { select: { accountLogin: true, deletedAt: true } } },
    });
    let followed = 0;
    for (const project of projects) {
      const login = project.scmInstallation?.accountLogin;
      if (!login || project.scmInstallation?.deletedAt || !project.scmRepositoryId) continue;
      if (login === project.scmOwner) continue;
      try {
        const applied = await this.apply(project.id, {
          provider: 'github',
          repositoryId: project.scmRepositoryId,
          owner: login,
          name: project.scmRepositoryName,
          fullName: `${login}/${project.scmRepositoryName}`,
          defaultBranch: project.scmDefaultBranch,
          repoUrl: `${config.github.oauthBaseUrl.replace(/\/+$/, '')}/${login}/${project.scmRepositoryName}`,
          installationId: project.scmInstallationId,
        });
        if (applied) followed += 1;
      } catch (error) {
        this.logger.warn(
          `Account rename was not applied to project ${project.id}: ${(error as Error).message}`,
        );
      }
    }
    return followed;
  }
}
