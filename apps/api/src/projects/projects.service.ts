import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { Prisma } from '@prisma/client';
import {
  ActivityEvent,
  Commit,
  DeployStatus,
  EnvName,
  PipelineStage,
  Project,
  ProviderKind,
  RuntimeKind,
  StageStatus,
  TargetScope,
  TemplateManifest,
} from '../domain/types';
import { targetCanRun, templateRuntime } from '../domain/capability';
import { CreateProjectDto } from './dto/create-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { GeneratorService } from '../generator/generator.service';
import { DeploymentService } from '../deployment/deployment.service';
import { TargetsService, TargetRow, BUILTIN_DOCKER } from '../targets/targets.service';
import {
  ScmProvider,
  ScmActor,
  RepoArchive,
  ScmRepositoryIdentity,
  ScmRepositoryRef,
  ScmKind,
  repositoryRef,
} from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { exportVersion } from '../deployment/providers/source-export';
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../common/secret';
import { generateToken, hashToken, tokenMatches } from '../common/token';
import type { ProviderConnection } from '../deployment/deployment-provider.interface';
import { WorkspacePermission, WorkspacesService } from '../workspaces/workspaces.service';
import { ProvisioningService } from './provisioning.service';
import { prepareProtectedWebLayout, PRIVATE_APP_DIR } from '../deployment/providers/sftp-layout';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

type ProvisioningRetry = { retryOfId: string; attempt: number };

type ProjectRow = Prisma.ProjectGetPayload<{
  include: { environments: { include: { target: true } } };
}>;

/**
 * The platform's core orchestrator: template scaffolding, repository
 * provisioning, environment lifecycle and deployments. State is persisted
 * in PostgreSQL via Prisma.
 */
@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger('ProjectsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly generator: GeneratorService,
    private readonly deployment: DeploymentService,
    private readonly targets: TargetsService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly workspaces: WorkspacesService,
    private readonly provisioning: ProvisioningService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileRepositoryIdentities();
    await this.migrateLegacyCiTokens();
    await this.reconcileCiRuntimeSecrets();
    await this.recoverInterruptedOperations();
  }

  // The SQL migration can safely backfill provider + owner/name without
  // contacting an external service, but it must not invent an immutable id.
  // On startup, resolve missing ids and refresh mutable coordinates by matching
  // existing rows on provider + immutable id. An SCM outage only postpones the
  // enrichment and never blocks the API.
  private async reconcileRepositoryIdentities(): Promise<void> {
    try {
      const projects = await this.prisma.project.findMany({
        where: { scmProvider: 'gitea' },
        include: { owner: true },
      });
      const repositoriesByOwner = new Map<
        string,
        Awaited<ReturnType<ScmProvider['listRepositories']>>
      >();
      const scm = this.workspaceScm.provider('gitea');
      for (const project of projects) {
        const actor = this.actorForRepo(project);
        let repositories = repositoriesByOwner.get(actor.username);
        if (!repositories) {
          repositories = await scm.listRepositories(actor);
          repositoriesByOwner.set(actor.username, repositories);
        }
        const match = repositories.find(
          (repository) =>
            repository.provider === 'gitea' &&
            (project.scmRepositoryId
              ? repository.repositoryId === project.scmRepositoryId
              : repository.fullName === project.scmFullName ||
                (repository.owner === project.scmOwner &&
                  repository.name === project.scmRepositoryName)),
        );
        if (!match) continue;
        try {
          await this.prisma.project.update({
            where: { id: project.id },
            data: {
              scmRepositoryId: match.repositoryId,
              scmOwner: match.owner,
              scmRepositoryName: match.name,
              scmFullName: match.fullName,
              scmDefaultBranch: match.defaultBranch,
              repoUrl: match.repoUrl,
            },
          });
        } catch (error) {
          this.logger.warn(
            `SCM identity reconciliation failed for project ${project.id}: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(`SCM identity reconciliation skipped: ${(error as Error).message}`);
    }
  }

  private async reconcileCiRuntimeSecrets(): Promise<void> {
    try {
      const projects = await this.prisma.project.findMany({
        select: {
          scmProvider: true,
          scmRepositoryId: true,
          scmOwner: true,
          scmRepositoryName: true,
          scmFullName: true,
          scmDefaultBranch: true,
          scmInstallationId: true,
          repoUrl: true,
        },
      });
      await Promise.all(
        projects.map(async (project) => {
          const repository = repositoryRef(project);
          try {
            await this.workspaceScm.provider(repository.provider).configureRepoRuntimeSecrets(repository);
          } catch (error) {
            // One externally deleted/inaccessible repository must not prevent
            // configuration reconciliation for every healthy project.
            this.logger.warn(
              `CI runtime-secret reconciliation failed for ${repository.provider}:${repository.fullName}: ${(error as Error).message}`,
            );
          }
        }),
      );
    } catch (e) {
      this.logger.warn(`CI runtime-secret reconciliation skipped: ${(e as Error).message}`);
    }
  }

  private async recoverInterruptedOperations(): Promise<void> {
    try {
      const interrupted = await this.prisma.deploymentOperation.findMany({
        where: { status: { in: ['running', 'cancelled'] }, finishedAt: null },
        select: { id: true, status: true },
      });
      for (const operation of interrupted) {
        const cancelled = operation.status === 'cancelled';
        await this.prisma.$transaction([
          this.prisma.deploymentOperation.update({
            where: { id: operation.id },
            data: {
              status: cancelled ? 'cancelled' : 'failed',
              message: cancelled ? 'Cancellation completed during API restart' : 'Interrupted by API restart',
              finishedAt: new Date(),
            },
          }),
          this.prisma.environment.updateMany({
            where: { activeOperationId: operation.id },
            data: {
              activeOperationId: null,
              status: cancelled ? 'empty' : 'failed',
              statusReason: cancelled ? null : 'Deployment was interrupted by an API restart. Redeploy to retry.',
              ...(cancelled ? { version: null, url: null, allocatedPort: null } : {}),
            },
          }),
        ]);
      }
    } catch (e) {
      this.logger.warn(`Deployment operation recovery skipped: ${(e as Error).message}`);
    }
  }

  private async beginOperation(
    projectId: string,
    envName: EnvName,
    kind: string,
    version: string | null,
  ): Promise<string> {
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (!env) throw new NotFoundException(`Environment '${envName}' not found`);
    const operation = await this.prisma.deploymentOperation.create({
      data: { environmentId: env.id, kind, status: 'running', version },
    });
    const claimed = await this.prisma.environment.updateMany({
      where: { id: env.id, activeOperationId: null },
      data: {
        activeOperationId: operation.id,
        status: 'deploying',
        statusReason: kind === 'start' ? 'Starting environment' : 'Preparing deployment',
      },
    });
    if (claimed.count === 1) return operation.id;
    await this.prisma.deploymentOperation.update({
      where: { id: operation.id },
      data: { status: 'cancelled', message: 'Another operation is already active', finishedAt: new Date() },
    });
    throw new BadRequestException(`Environment '${envName}' already has an active operation`);
  }

  private async completeOperation(
    operationId: string,
    status: 'succeeded' | 'failed' | 'cancelled',
    message?: string,
  ): Promise<void> {
    await this.prisma.deploymentOperation
      .update({
        where: { id: operationId },
        data: { status, message, finishedAt: new Date() },
      })
      .catch(() => undefined);
    await this.prisma.environment.updateMany({
      where: { activeOperationId: operationId },
      data: { activeOperationId: null },
    });
  }

  private async operationCancelled(operationId: string): Promise<boolean> {
    const op = await this.prisma.deploymentOperation.findUnique({
      where: { id: operationId },
      select: { status: true },
    });
    return !op || op.status === 'cancelled';
  }

  private async scheduleDeployment(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
    kind: string,
  ): Promise<void> {
    const operationId = await this.beginOperation(projectId, envName, kind, version);
    void this.deployEnvInBackground(projectId, envName, version, useRegistry, operationId);
  }

  // Projects created before repository-specific CI credentials used a single
  // platform-wide token. Rotate those repositories on startup. Each affected
  // user receives one fresh package-capable PAT, then every project gets an
  // independent deploy secret whose plaintext lives only in Gitea Actions.
  private async migrateLegacyCiTokens(): Promise<void> {
    try {
      const legacy = await this.prisma.project.findMany({
        where: { ciDeployTokenHash: null, scmProvider: 'gitea' },
        include: { owner: true },
      });
      const byOwner = new Map<string, typeof legacy>();
      for (const project of legacy) {
        if (!project.owner) continue;
        const list = byOwner.get(project.owner.id) ?? [];
        list.push(project);
        byOwner.set(project.owner.id, list);
      }
      for (const projects of byOwner.values()) {
        const owner = projects[0].owner!;
        try {
          const scm = this.workspaceScm.provider('gitea');
          const ownerToken = await scm.issueCloneToken(owner.username);
          await this.prisma.user.update({
            where: { id: owner.id },
            data: { accessToken: encryptSecret(ownerToken) },
          });
          for (const project of projects) {
            const token = generateToken();
            await scm.configureRepoSecrets(repositoryRef(project), ownerToken, token);
            await this.prisma.project.update({
              where: { id: project.id },
              data: { ciDeployTokenHash: hashToken(token) },
            });
          }
        } catch (e) {
          this.logger.error(`CI credential migration for ${owner.username} failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      // During the first migration-aware startup the column may not exist yet.
      // The container migration step runs before the API in normal deployments.
      this.logger.warn(`CI credential migration skipped: ${(e as Error).message}`);
    }
  }

  async list(userId: string, requestedWorkspaceId?: string): Promise<Project[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    // Reconcile on read: refreshing the project list is the moment the user
    // expects reality — projects whose repositories were deleted directly in
    // Gitea are cleaned up here (the webhook remains as an instant path when
    // a Gitea version delivers it). No background timers needed.
    await this.pruneMissingRepos(workspaceId);
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      include: { environments: { include: { target: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  // Drops the owner's projects whose repositories no longer exist in Gitea.
  // A repository counts as gone ONLY on an explicit 404 (with a short request
  // timeout) — an outage never deletes anything and never blocks the list
  // for long. Checks run in parallel; cheap at per-user scale.
  private async pruneMissingRepos(workspaceId: string): Promise<void> {
    try {
      const rows = await this.prisma.project.findMany({
        where: { workspaceId },
        include: { owner: true },
      });
      await Promise.all(
        rows.map(async (row) => {
          const repository = repositoryRef(row);
          const actor = this.actorForRepo(row);
          if (await this.workspaceScm.provider(repository.provider).repoMissing(repository, actor)) {
            this.logger.log(
              `Repository ${repository.fullName} no longer exists in ${repository.provider} — cleaning up`,
            );
            await this.removeByRepo(
              repository.fullName,
              repository.provider,
              repository.repositoryId ?? undefined,
            ).catch((e) => this.logger.error(`Cleanup failed: ${(e as Error).message}`));
          }
        }),
      );
    } catch (e) {
      this.logger.warn(`Repository reconciliation skipped: ${(e as Error).message}`);
    }
  }

  // On-read reconciliation for a single project (detail view / refresh):
  // when the repository was deleted directly in Gitea, clean the project up
  // and surface 404 to the caller. Same fail-safe as the list variant —
  // only an explicit 404 from Gitea counts.
  async reconcileProject(id: string): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { owner: true },
    });
    if (!row) return; // get() reports the 404
    const repository = repositoryRef(row);
    const actor = this.actorForRepo(row);
    if (await this.workspaceScm.provider(repository.provider).repoMissing(repository, actor)) {
      this.logger.log(
        `Repository ${repository.fullName} no longer exists in ${repository.provider} — cleaning up`,
      );
      await this.removeByRepo(
        repository.fullName,
        repository.provider,
        repository.repositoryId ?? undefined,
      ).catch((e) => this.logger.error(`Cleanup failed: ${(e as Error).message}`));
      throw new NotFoundException(`Project '${id}' not found`);
    }
  }

  async get(id: string): Promise<Project> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: { include: { target: true } } },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    return this.toDomain(row);
  }

  // Central workspace authorization boundary. Internal CI/SCM flows use their
  // own scoped credentials and intentionally do not call this method.
  async assertAccess(id: string, userId: string, permission: WorkspacePermission): Promise<void> {
    await this.workspaces.requireProject(userId, id, permission);
  }

  // The most recent provisioning operation (create/import) for a project.
  latestProvisioning(id: string) {
    return this.provisioning.latestForProject(id);
  }

  async create(
    dto: CreateProjectDto,
    ownerId: string,
    requestedWorkspaceId?: string,
    retry?: ProvisioningRetry,
  ): Promise<Project> {
    const { id: workspaceId } = await this.workspaces.resolve(ownerId, requestedWorkspaceId);
    // The summary operation is accompanied by a write-ahead effect journal in
    // createInternal. External mutation is refused when its intent cannot be
    // persisted; outcome text remains best-effort and never masks the cause.
    const op = await this.provisioning.start(workspaceId, dto.name, 'create', {
      requestedById: ownerId,
      request: dto as unknown as Prisma.InputJsonValue,
      retryOfId: retry?.retryOfId,
      attempt: retry?.attempt,
    });
    try {
      const project = await this.createInternal(dto, ownerId, workspaceId, op);
      await this.provisioning.succeed(op, project.id);
      return project;
    } catch (e) {
      await this.provisioning.fail(op, (e as Error).message);
      throw e;
    }
  }

  private async createInternal(
    dto: CreateProjectDto,
    ownerId: string,
    workspaceId: string,
    operationId: string,
  ): Promise<Project> {
    await this.workspaces.require(ownerId, workspaceId, 'write');
    if (await this.prisma.project.findFirst({ where: { workspaceId, name: dto.name } })) {
      throw new BadRequestException(`This workspace already has a project named '${dto.name}'`);
    }
    const template = this.templates.get(dto.templateId);
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const scmContext = await this.workspaceScm.createContext(
      ownerId,
      workspaceId,
      dto.scmInstallationId,
    );
    const scm = this.workspaceScm.provider(scmContext.kind);

    // Resolve every target before creating external state. Invalid target
    // configuration must not leave a repository behind in Gitea.
    const targets = await this.targets.listEntities(workspaceId);
    const envTargets = ENV_ORDER.map((name) => {
      const chosen = dto.environments?.find((e) => e.name === name)?.targetId;
      return { name, target: this.resolveEnvTarget(name, template, chosen, targets) };
    });

    // The workspace directory is namespaced by owner (.workspace/<owner>/<name>)
    // so same-named projects of different users cannot collide.
    const { repoPath } = this.generator.generate(
      template.id,
      dto.name,
      `${owner.username}/${dto.name}`,
    );
    try {
      // The scaffold commit is authored by the platform's service account
      // (bot); the developer's own commits carry their identity.
      await scm.initLocal(repoPath);

      let repo: ScmRepositoryIdentity | null = null;
      const ciDeployToken = generateToken();
      const repositoryEffect = 'repository:create';
      await this.provisioning.planEffect(operationId, repositoryEffect, 'repository', {
        provider: scmContext.kind,
        owner: scmContext.actor.username,
        name: dto.name,
        fullName: `${scmContext.actor.username}/${dto.name}`,
        defaultBranch: 'main',
        installationId: scmContext.actor.installationId ?? null,
      });
      await this.provisioning.beginEffect(operationId, repositoryEffect);
      try {
        repo = await scm.provision(
          dto.name,
          repoPath,
          scmContext.actor,
          ciDeployToken,
          scmContext.target,
        );
        await this.provisioning.completeEffect(operationId, repositoryEffect, {
          provider: repo.provider,
          repositoryId: repo.repositoryId,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          repoUrl: repo.repoUrl,
          installationId: repo.installationId,
        });
      } catch (e) {
        await this.provisioning
          .failEffect(operationId, repositoryEffect, (e as Error).message)
          .catch(() => undefined);
        // provision() itself is atomic by provider contract. This extra branch
        // covers a successful provider call followed by a failed journal
        // transition, where the caller already knows the repository identity.
        if (repo) {
          try {
            await scm.deleteRepo(repo, scmContext.actor);
            await this.provisioning.compensateEffect(operationId, repositoryEffect).catch(() => undefined);
          } catch (cleanupError) {
            await this.provisioning
              .compensationFailed(operationId, repositoryEffect, (cleanupError as Error).message)
              .catch(() => undefined);
          }
        }
        throw new BadRequestException(
          `Repository could not be created in ${scmContext.kind === 'github' ? 'GitHub' : 'Gitea'}: ${(e as Error).message}`,
        );
      }

      const repositoryEffects = [repositoryEffect];
      try {
        const collaborators = await this.prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { not: ownerId } },
        });
        for (const collaborator of collaborators) {
          const username = await this.workspaceScm.collaboratorUsername(
            collaborator.userId,
            repo.provider,
          );
          const effect = `collaborator:${collaborator.userId}`;
          await this.provisioning.planEffect(operationId, effect, 'collaborator', { username });
          await this.provisioning.beginEffect(operationId, effect);
          repositoryEffects.push(effect);
          try {
            await scm.setCollaborator(repo, username, collaborator.role);
            await this.provisioning.completeEffect(operationId, effect);
          } catch (e) {
            await this.provisioning
              .failEffect(operationId, effect, (e as Error).message)
              .catch(() => undefined);
            throw e;
          }
        }
      } catch (e) {
        try {
          await scm.deleteRepo(repo, scmContext.actor);
          for (const effect of repositoryEffects.reverse()) {
            await this.provisioning.compensateEffect(operationId, effect).catch(() => undefined);
          }
        } catch (cleanupError) {
          const message = (cleanupError as Error).message;
          this.logger.warn(`Repository rollback failed: ${message}`);
          for (const effect of repositoryEffects) {
            await this.provisioning.compensationFailed(operationId, effect, message).catch(() => undefined);
          }
        }
        throw new BadRequestException(
          `Repository collaborators could not be configured: ${(e as Error).message}`,
        );
      }

      let created: { id: string } | null = null;
      const projectEffect = 'project:record';
      try {
        await this.provisioning.planEffect(operationId, projectEffect, 'project', {
          repository: repo.fullName,
        });
        await this.provisioning.beginEffect(operationId, projectEffect);
        created = await this.prisma.project.create({
          data: {
            name: dto.name,
            templateId: template.id,
            repoPath,
            repoUrl: repo.repoUrl,
            scmProvider: repo.provider,
            scmRepositoryId: repo.repositoryId,
            scmOwner: repo.owner,
            scmRepositoryName: repo.name,
            scmFullName: repo.fullName,
            scmDefaultBranch: repo.defaultBranch,
            scmInstallationId: repo.installationId,
            lastCommit: 'init: scaffold from template',
            ciDeployTokenHash: hashToken(ciDeployToken),
            ownerId,
            workspaceId,
            environments: {
              create: envTargets.map(({ name, target }, order) => ({
                name,
                order,
                provider: target.kind,
                targetId: target.id,
                status: name === 'dev' ? 'deploying' : 'empty',
              })),
            },
          },
        });
        await this.provisioning.bindProject(operationId, created.id);
        await this.provisioning.completeEffect(operationId, projectEffect, {
          repository: repo.fullName,
          projectId: created.id,
        });
      } catch (e) {
        await this.provisioning.failEffect(operationId, projectEffect, (e as Error).message).catch(() => undefined);
        let projectCleanupError: Error | null = null;
        if (created) {
          try {
            await this.prisma.project.delete({ where: { id: created.id } });
            await this.provisioning.unbindProject(operationId);
          } catch (cleanupError) {
            projectCleanupError = cleanupError as Error;
            this.logger.warn(`Project-record rollback failed: ${projectCleanupError.message}`);
          }
        }
        try {
          await scm.deleteRepo(repo, scmContext.actor);
          for (const effect of [...repositoryEffects].reverse()) {
            await this.provisioning.compensateEffect(operationId, effect).catch(() => undefined);
          }
        } catch (cleanupError) {
          const message = (cleanupError as Error).message;
          this.logger.warn(`Repository rollback failed: ${message}`);
          for (const effect of repositoryEffects) {
            await this.provisioning.compensationFailed(operationId, effect, message).catch(() => undefined);
          }
        }
        if (projectCleanupError) {
          await this.provisioning
            .compensationFailed(operationId, projectEffect, projectCleanupError.message)
            .catch(() => undefined);
        } else {
          await this.provisioning.compensateEffect(operationId, projectEffect).catch(() => undefined);
        }
        throw e;
      }

      // No local bootstrap build: dev stays "deploying" until CI builds and
      // tests the real image (build once, deploy many). Pushing the scaffold
      // triggers CI; the webhook then deploys dev.
      return this.get(created.id);
    } finally {
      // The provider is now the source of truth. A failed attempt must also
      // leave no generated checkout that could collide with a later retry.
      rmSync(repoPath, { recursive: true, force: true });
    }
  }

  /**
   * Imports an existing repository (Phase 3). Unlike create, it never renders or
   * pushes a scaffold — the code is left untouched. It records the project
   * pointing at the existing repo, configures the per-repo CI secret and mirrors
   * workspace collaborators. Environments start empty; the user's next push to
   * the default branch triggers CI and the first deploy. The record is created
   * first so the failure remains visible if external compensation is unable to
   * finish. Every secret/collaborator mutation is journaled before execution;
   * successful compensation removes the DB record, incomplete cleanup keeps it.
   */
  async importExisting(
    dto: ImportProjectDto,
    ownerId: string,
    requestedWorkspaceId?: string,
    retry?: ProvisioningRetry,
  ): Promise<Project> {
    const { id: workspaceId } = await this.workspaces.resolve(ownerId, requestedWorkspaceId);
    await this.workspaces.require(ownerId, workspaceId, 'write');
    const op = await this.provisioning.start(workspaceId, dto.repositoryId, 'import', {
      requestedById: ownerId,
      request: dto as unknown as Prisma.InputJsonValue,
      retryOfId: retry?.retryOfId,
      attempt: retry?.attempt,
    });
    try {
      const template = this.templates.get(dto.templateId);
      const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });

      await this.provisioning.step(op, 'repository');
      const { repo, actor } = await this.workspaceScm.repository(
        ownerId,
        workspaceId,
        dto.repositoryId,
      );
      const scm = this.workspaceScm.provider(repo.provider);
      if (repo.empty) {
        throw new BadRequestException('Cannot import an empty repository — push code first.');
      }
      if (!/^[a-z][a-z0-9-]{1,40}$/.test(repo.name)) {
        throw new BadRequestException(
          'Repository name is not a valid project name (lowercase letters, digits and hyphens).',
        );
      }
      if (await this.prisma.project.findFirst({ where: { workspaceId, name: repo.name } })) {
        throw new BadRequestException(`This workspace already has a project named '${repo.name}'`);
      }
      if (
        await this.prisma.project.findFirst({
          where: { scmProvider: repo.provider, scmRepositoryId: repo.repositoryId },
        })
      ) {
        throw new BadRequestException(
          `Repository '${repo.fullName}' is already connected to InitPad`,
        );
      }
      if (templateRuntime(template) !== 'static') {
        const dockerfile = await scm.readFile(repo, 'Dockerfile', repo.defaultBranch, actor);
        if (dockerfile == null) {
          throw new BadRequestException(
            `Cannot import '${repo.fullName}': no Dockerfile exists on '${repo.defaultBranch}' for the selected runtime.`,
          );
        }
      }
      const workflowPath = repo.provider === 'github'
        ? '.github/workflows/ci.yml'
        : '.gitea/workflows/ci.yml';
      const workflow = await scm.readFile(repo, workflowPath, repo.defaultBranch, actor);
      if (
        !workflow?.includes('INITPAD_PLATFORM_URL') ||
        !workflow.includes('INITPAD_DEPLOY_TOKEN')
      ) {
        throw new BadRequestException(
          `Cannot import '${repo.fullName}': add an InitPad-compatible workflow at '${workflowPath}' first.`,
        );
      }

      const targets = await this.targets.listEntities(workspaceId);
      const envTargets = ENV_ORDER.map((name) => {
        const chosen = dto.environments?.find((e) => e.name === name)?.targetId;
        return { name, target: this.resolveEnvTarget(name, template, chosen, targets) };
      });

      const ciDeployToken = generateToken();
      const projectEffect = 'project:record';
      await this.provisioning.planEffect(op, projectEffect, 'project', {
        repository: repo.fullName,
      });
      await this.provisioning.beginEffect(op, projectEffect);
      let created: { id: string } | null = null;
      try {
        created = await this.prisma.project.create({
          data: {
            name: repo.name,
            templateId: template.id,
            repoPath: repo.fullName,
            repoUrl: repo.repoUrl,
            scmProvider: repo.provider,
            scmRepositoryId: repo.repositoryId,
            scmOwner: repo.owner,
            scmRepositoryName: repo.name,
            scmFullName: repo.fullName,
            scmDefaultBranch: repo.defaultBranch,
            scmInstallationId: repo.installationId,
            lastCommit: 'import: existing repository',
            ciDeployTokenHash: hashToken(ciDeployToken),
            ownerId,
            workspaceId,
            environments: {
              create: envTargets.map(({ name, target }, order) => ({
                name,
                order,
                provider: target.kind,
                targetId: target.id,
                status: 'empty',
              })),
            },
          },
        });
        await this.provisioning.bindProject(op, created.id);
        await this.provisioning.completeEffect(op, projectEffect, {
          repository: repo.fullName,
          projectId: created.id,
        });
      } catch (e) {
        await this.provisioning.failEffect(op, projectEffect, (e as Error).message).catch(() => undefined);
        if (created) {
          try {
            await this.prisma.project.delete({ where: { id: created.id } });
            await this.provisioning.unbindProject(op);
            await this.provisioning.compensateEffect(op, projectEffect).catch(() => undefined);
          } catch (cleanupError) {
            await this.provisioning
              .compensationFailed(op, projectEffect, (cleanupError as Error).message)
              .catch(() => undefined);
          }
        }
        throw e;
      }

      await this.provisioning.step(op, 'ci');
      const compensations: Array<{ key: string; run: () => Promise<void> }> = [];
      try {
        let ownerToken = '';
        if (repo.provider === 'gitea') {
          ownerToken = await scm.issueCloneToken(owner.username);
          await this.prisma.user.update({
            where: { id: owner.id },
            data: { accessToken: encryptSecret(ownerToken) },
          });
        }
        const secretsEffect = 'secrets:initpad';
        await this.provisioning.planEffect(op, secretsEffect, 'secrets', {
          repository: repo.fullName,
        });
        await this.provisioning.beginEffect(op, secretsEffect);
        // Register compensation before the call: a provider can fail after
        // writing only some secret names and cannot return their old values.
        compensations.push({
          key: secretsEffect,
          run: () => scm.removeRepoSecrets(repo),
        });
        try {
          await scm.configureRepoSecrets(repo, ownerToken, ciDeployToken);
          await this.provisioning.completeEffect(op, secretsEffect);
        } catch (e) {
          await this.provisioning.failEffect(op, secretsEffect, (e as Error).message).catch(() => undefined);
          throw e;
        }
        const collaborators = await this.prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { not: ownerId } },
        });
        for (const collaborator of collaborators) {
          const username = await this.workspaceScm.collaboratorUsername(
            collaborator.userId,
            repo.provider,
          );
          const previousAccess = await scm.getCollaboratorAccess(repo, username);
          const collaboratorEffect = `collaborator:${collaborator.userId}`;
          await this.provisioning.planEffect(op, collaboratorEffect, 'collaborator', {
            username,
            previousAccess,
          });
          await this.provisioning.beginEffect(op, collaboratorEffect);
          compensations.push({
            key: collaboratorEffect,
            run: () => scm.restoreCollaboratorAccess(repo, username, previousAccess),
          });
          try {
            await scm.setCollaborator(repo, username, collaborator.role);
            await this.provisioning.completeEffect(op, collaboratorEffect);
          } catch (e) {
            await this.provisioning
              .failEffect(op, collaboratorEffect, (e as Error).message)
              .catch(() => undefined);
            throw e;
          }
        }
      } catch (e) {
        const cleanupErrors: string[] = [];
        for (const compensation of compensations.reverse()) {
          try {
            await compensation.run();
            await this.provisioning.compensateEffect(op, compensation.key);
          } catch (cleanupError) {
            const message = (cleanupError as Error).message;
            cleanupErrors.push(`${compensation.key}: ${message}`);
            await this.provisioning
              .compensationFailed(op, compensation.key, message)
              .catch(() => undefined);
          }
        }
        if (cleanupErrors.length === 0) {
          try {
            await this.prisma.project.delete({ where: { id: created.id } });
            await this.provisioning.unbindProject(op);
            await this.provisioning.compensateEffect(op, projectEffect);
          } catch (cleanupError) {
            const message = (cleanupError as Error).message;
            cleanupErrors.push(`project: ${message}`);
            await this.provisioning
              .compensationFailed(op, projectEffect, message)
              .catch(() => undefined);
          }
        }
        const cleanupSuffix = cleanupErrors.length > 0
          ? ` Automatic cleanup is incomplete; project '${repo.name}' was kept so an owner can inspect and repair it. ${cleanupErrors.join('; ')}`
          : ' All InitPad changes were rolled back.';
        throw new BadRequestException(
          `Import failed while configuring the repository: ${(e as Error).message}.${cleanupSuffix}`,
        );
      }
      await this.provisioning.succeed(op, created.id);
      return this.get(created.id);
    } catch (e) {
      await this.provisioning.fail(op, (e as Error).message);
      throw e;
    }
  }

  async retryProvisioning(operationId: string, userId: string): Promise<Project> {
    const operation = await this.provisioning.record(operationId);
    await this.workspaces.require(userId, operation.workspaceId, 'write');
    if (!this.provisioning.isRetryable(operation, userId)) {
      throw new BadRequestException(
        operation.attempt >= 5
          ? 'This provisioning operation reached the maximum of five attempts'
          : 'Finish the required cleanup before retrying this provisioning operation',
      );
    }
    if (!operation.request || typeof operation.request !== 'object' || Array.isArray(operation.request)) {
      throw new BadRequestException('This legacy provisioning operation has no retryable request');
    }
    await this.provisioning.claimRetry(operation.id);
    const retry = { retryOfId: operation.id, attempt: operation.attempt + 1 };
    try {
      if (operation.kind === 'create') {
        return await this.create(
          operation.request as unknown as CreateProjectDto,
          userId,
          operation.workspaceId,
          retry,
        );
      }
      if (operation.kind === 'import') {
        return await this.importExisting(
          operation.request as unknown as ImportProjectDto,
          userId,
          operation.workspaceId,
          retry,
        );
      }
      throw new BadRequestException(`Unsupported provisioning kind '${operation.kind}'`);
    } catch (error) {
      // start() creates the new attempt and retires the old one atomically.
      // If that transaction never committed, release the compare-and-set so a
      // transient DB error does not permanently lock the retry button.
      await this.provisioning.releaseRetry(operation.id).catch(() => undefined);
      throw error;
    }
  }

  async cleanupProvisioning(operationId: string, userId: string): Promise<void> {
    const operation = await this.provisioning.record(operationId);
    await this.workspaces.require(userId, operation.workspaceId, 'maintain');
    if (!this.provisioning.needsCleanup(operation)) {
      throw new BadRequestException('This provisioning operation has no pending cleanup');
    }
    await this.provisioning.claimCleanup(operation.id);
    try {
      await this.cleanupProvisioningEffects(operation, userId);
    } catch (error) {
      await this.provisioning
        .releaseCleanup(operation.id, (error as Error).message)
        .catch(() => undefined);
      throw error;
    }
  }

  private async cleanupProvisioningEffects(
    operation: Awaited<ReturnType<ProvisioningService['record']>>,
    userId: string,
  ): Promise<void> {
    const project = operation.projectId
      ? await this.prisma.project.findUnique({ where: { id: operation.projectId } })
      : null;
    const cleanupErrors: string[] = [];
    const compensate = async (key: string, action: () => Promise<void>) => {
      try {
        await action();
        await this.provisioning.compensateEffect(operation.id, key);
      } catch (error) {
        const message = (error as Error).message;
        cleanupErrors.push(`${key}: ${message}`);
        await this.provisioning.compensationFailed(operation.id, key, message).catch(() => undefined);
      }
    };

    if (operation.kind === 'import') {
      const externalEffects = operation.effects.filter(
        (effect) =>
          (effect.kind === 'collaborator' || effect.kind === 'secrets') &&
          this.effectNeedsCleanup(effect.status),
      );
      if (!project && externalEffects.length > 0) {
        throw new BadRequestException(
          'The imported project record is missing; external cleanup cannot be proven safe automatically',
        );
      }
      if (project) {
        const repo = repositoryRef(project);
        const scm = this.workspaceScm.provider(repo.provider);
        for (const effect of [...externalEffects].reverse()) {
          if (effect.kind === 'collaborator') {
            const metadata = this.effectMetadata(effect.metadata);
            const username = metadata.username;
            if (!username) {
              cleanupErrors.push(`${effect.key}: collaborator identity is missing`);
              continue;
            }
            await compensate(effect.key, () =>
              scm.restoreCollaboratorAccess(repo, username, metadata.previousAccess ?? null),
            );
          } else if (effect.kind === 'secrets') {
            await compensate(effect.key, () => scm.removeRepoSecrets(repo));
          }
        }
      }
    } else if (operation.kind === 'create') {
      const repositoryEffect = operation.effects.find((effect) => effect.kind === 'repository');
      const repo = project
        ? repositoryRef(project)
        : repositoryEffect
          ? this.repositoryFromEffect(repositoryEffect.metadata)
          : null;
      const repositoryEffects = operation.effects.filter(
        (effect) =>
          (effect.kind === 'repository' || effect.kind === 'collaborator') &&
          this.effectNeedsCleanup(effect.status),
      );
      if (repositoryEffects.length > 0) {
        if (!repo) {
          throw new BadRequestException(
            'The created repository identity is incomplete; remove it in the SCM before retrying',
          );
        }
        const scm = this.workspaceScm.provider(repo.provider);
        const actor = await this.workspaceScm.actorForRepository(userId, repo);
        try {
          await scm.deleteRepo(repo, actor);
          for (const effect of repositoryEffects.reverse()) {
            try {
              await this.provisioning.compensateEffect(operation.id, effect.key);
            } catch (error) {
              const message = (error as Error).message;
              cleanupErrors.push(`${effect.key}: ${message}`);
              await this.provisioning
                .compensationFailed(operation.id, effect.key, message)
                .catch(() => undefined);
            }
          }
        } catch (error) {
          const message = (error as Error).message;
          for (const effect of repositoryEffects) {
            cleanupErrors.push(`${effect.key}: ${message}`);
            await this.provisioning
              .compensationFailed(operation.id, effect.key, message)
              .catch(() => undefined);
          }
        }
      }
    } else {
      throw new BadRequestException(`Unsupported provisioning kind '${operation.kind}'`);
    }

    if (cleanupErrors.length === 0) {
      const projectEffect = operation.effects.find((effect) => effect.kind === 'project');
      if (project) {
        if (projectEffect) {
          await compensate(projectEffect.key, () =>
            this.prisma.project.delete({ where: { id: project.id } }).then(async () => {
              await this.provisioning.unbindProject(operation.id);
            }),
          );
        } else {
          try {
            await this.prisma.project.delete({ where: { id: project.id } });
            await this.provisioning.unbindProject(operation.id);
          } catch (error) {
            cleanupErrors.push(`project: ${(error as Error).message}`);
          }
        }
      } else if (projectEffect && this.effectNeedsCleanup(projectEffect.status)) {
        await this.provisioning.compensateEffect(operation.id, projectEffect.key).catch((error) => {
          cleanupErrors.push(`${projectEffect.key}: ${(error as Error).message}`);
        });
        if (cleanupErrors.length === 0) {
          await this.provisioning.unbindProject(operation.id).catch((error) => {
            cleanupErrors.push(`project: ${(error as Error).message}`);
          });
        }
      }
    }

    if (cleanupErrors.length > 0) {
      throw new BadRequestException(`Provisioning cleanup is still incomplete: ${cleanupErrors.join('; ')}`);
    }
    await this.provisioning.cleanupFinished(operation.id);
  }

  private effectNeedsCleanup(status: string): boolean {
    return !['planned', 'compensated'].includes(status);
  }

  private effectMetadata(value: unknown): Record<string, string | null> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, string | null> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string' || entry === null) result[key] = entry;
    }
    return result;
  }

  private repositoryFromEffect(value: unknown): ScmRepositoryRef | null {
    const metadata = this.effectMetadata(value);
    if (
      (metadata.provider !== 'gitea' && metadata.provider !== 'github') ||
      !metadata.owner ||
      !metadata.name
    ) {
      return null;
    }
    return {
      provider: metadata.provider,
      repositoryId: metadata.repositoryId ?? null,
      owner: metadata.owner,
      name: metadata.name,
      fullName: metadata.fullName || `${metadata.owner}/${metadata.name}`,
      defaultBranch: metadata.defaultBranch || 'main',
      repoUrl: metadata.repoUrl ?? null,
      installationId: metadata.installationId ?? null,
    };
  }

  // Wraps deployEnv so a failure never escapes as an unhandled rejection —
  // the environment is marked as failed with the reason instead.
  private async deployEnvInBackground(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
    operationId: string,
  ): Promise<void> {
    try {
      const published = await this.deployEnv(projectId, envName, version, useRegistry, operationId);
      if (published) await this.completeOperation(operationId, 'succeeded');
    } catch (e) {
      this.logger.error(`Deploy to ${envName} failed: ${(e as Error).message}`);
      await this.prisma.environment
        .updateMany({
          where: { projectId, name: envName, activeOperationId: operationId },
          data: { status: 'failed', statusReason: (e as Error).message, activeOperationId: null },
        })
        .catch(() => undefined);
      await this.completeOperation(operationId, 'failed', (e as Error).message);
    }
  }

  // CI → deploy: after a successful CI build, sync the latest commit and
  // deploy it to dev. Closes the E2E loop: commit → CI build/test/docker →
  // a running dev environment with the real code.
  async deployFromCi(repo: string, sha: string, ref: string, token: string): Promise<void> {
    const coordinates = repo.split('/');
    if (coordinates.length !== 2 || coordinates.some((part) => !part)) {
      throw new BadRequestException('Invalid repo');
    }
    const retryTag = ref.replace(/^refs\/tags\//, '');
    const isRetry = /^initpad-retry-[a-z0-9-]+$/.test(retryTag);
    // The repository coordinate is not globally unique across SCM providers.
    // The per-project secret selects the exact row without trusting a provider
    // value supplied by CI.
    const candidates = await this.prisma.project.findMany({
      where: { scmFullName: repo },
    });
    const project = candidates.find((candidate) =>
      tokenMatches(token, candidate.ciDeployTokenHash),
    );
    if (!project) {
      if (candidates.length > 0) {
        throw new UnauthorizedException('Invalid CI token for this repository');
      }
      this.logger.warn(`CI deploy: project '${repo}' not found`);
      return;
    }
    const repository = repositoryRef(project);
    const scm = this.workspaceScm.provider(repository.provider);
    // Deploy from the repository's recorded default branch, or from an
    // InitPad-owned retry tag pointing at that branch's exact commit.
    const branch = repository.defaultBranch;
    if (ref && ref !== branch && ref !== `refs/heads/${branch}` && !isRetry) return;
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      throw new BadRequestException('CI deploy requires a full 40-character commit SHA');
    }

    const dev = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: project.id, name: 'dev' } },
    });
    if (!dev) throw new BadRequestException("Project has no 'dev' environment");

    if (isRetry) {
      const actor = await this.actorForProject(project.id);
      try {
        const operation = dev.activeOperationId
          ? await this.prisma.deploymentOperation.findUnique({
              where: { id: dev.activeOperationId },
            })
          : null;
        // Only the currently requested retry may deploy. Cancel clears the
        // active operation, so a late CI callback is harmless.
        if (
          !operation ||
          operation.kind !== 'ci-retry' ||
          operation.status !== 'running' ||
          operation.version !== sha
        ) {
          this.logger.log(`Ignoring stale CI retry for ${repo} (${retryTag})`);
          return;
        }
        await this.prisma.project.update({
          where: { id: project.id },
          data: { lastCommit: `ci: retry ${sha.slice(0, 7)}` },
        });
        void this.deployEnvInBackground(project.id, 'dev', sha, true, operation.id);
        this.logger.log(`CI retry deploy: ${repo} → dev (${sha})`);
        return;
      } finally {
        await scm.deleteTag(repository, retryTag, actor);
      }
    }

    // Removing/cancelling an empty dev environment opts out of a late CI
    // callback. A deliberate Run again creates the tracked operation above.
    if (dev.status === 'empty') {
      this.logger.log(`Ignoring CI deploy for disabled dev environment: ${repo}`);
      return;
    }

    // Version = the full commit hash (unambiguous, matches the CI image tag).
    // No local sync needed — sources are fetched from Gitea on demand.
    const version = sha || '0.1.0';
    await this.prisma.project.update({
      where: { id: project.id },
      data: { lastCommit: `ci: deploy ${version.slice(0, 7)}` },
    });
    // Runs in the background — the CI webhook returns immediately, the deploy
    // (pull + run) finishes afterwards. useRegistry=true: run exactly the
    // image CI built and tested.
    await this.scheduleDeployment(project.id, 'dev', version, true, 'ci-deploy');
    this.logger.log(`CI deploy: ${repo} → dev (${version})`);
  }

  async promote(id: string, target: EnvName): Promise<Project> {
    const project = await this.get(id);
    const idx = ENV_ORDER.indexOf(target);
    if (idx <= 0) {
      throw new BadRequestException(`Cannot promote to '${target}'`);
    }
    const source = project.environments.find((e) => e.name === ENV_ORDER[idx - 1]);
    if (!source || source.status !== 'running' || !source.version) {
      throw new BadRequestException(
        `Source environment '${ENV_ORDER[idx - 1]}' has nothing to promote`,
      );
    }
    // Promote = run THE SAME registry image in the target environment (build
    // once, deploy many). Runs in the BACKGROUND: an SFTP build-extract to a
    // real host can take minutes (uploading vendor/ file-by-file), which would
    // otherwise block the HTTP request past proxy timeouts (504). The env is
    // marked 'deploying' and the UI polls for the outcome.
    await this.scheduleDeployment(id, target, source.version, true, 'promote');
    return this.get(id);
  }

  // Last ~N log lines of the environment's running (or failed) deployment.
  async envLogs(id: string, envName: EnvName): Promise<string> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: envName } },
      include: { target: true },
    });
    if (!env) throw new NotFoundException(`Environment '${envName}' not found`);
    return this.deployment.logs(env.provider as ProviderKind, {
      projectName: this.deploySlug(repositoryRef(project)),
      env: envName,
      connection: this.targetConnection(env),
    });
  }

  // Live connection for an environment's target. Built-in targets return
  // undefined → the provider uses the config demo path (behaviour unchanged);
  // user targets return their decrypted connection.
  private targetConnection(env: { target?: TargetRow | null }): ProviderConnection | undefined {
    return env.target ? this.targets.connectionForTarget(env.target) : undefined;
  }

  // Re-deploys the environment at its current version. A hash version comes
  // from the registry (build once); a bootstrap version (0.1.0) rebuilds
  // from the repository.
  async redeploy(id: string, envName: EnvName): Promise<Project> {
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: envName } },
    });
    if (!env || !env.version) {
      throw new BadRequestException(`Environment '${envName}' has nothing to redeploy`);
    }
    const useRegistry = /^[0-9a-f]{7,40}$/.test(env.version);
    await this.scheduleDeployment(id, envName, env.version, useRegistry, 'redeploy');
    return this.get(id);
  }

  // Restarts dev after a cancelled/failed first deployment. If CI already
  // produced an image, retry only the deployment. Otherwise queue CI for the
  // latest main commit through a temporary tag and track the wait as an
  // operation so Cancel also invalidates a late callback.
  async runAgain(id: string): Promise<Project> {
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: 'dev' } },
    });
    if (!env) throw new NotFoundException("Environment 'dev' not found");
    if (env.activeOperationId || !['empty', 'failed'].includes(env.status)) {
      throw new BadRequestException("Dev can only run again after it was cancelled or failed");
    }

    const previousOperation = await this.prisma.deploymentOperation.findFirst({
      where: {
        environmentId: env.id,
        status: { in: ['cancelled', 'failed'] },
        kind: { not: 'ci-retry' },
        version: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (previousOperation?.version) {
      const useRegistry = /^[0-9a-f]{40}$/i.test(previousOperation.version);
      await this.scheduleDeployment(id, 'dev', previousOperation.version, useRegistry, 'retry');
      return this.get(id);
    }

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const repository = repositoryRef(project);
    const scm = this.workspaceScm.provider(repository.provider);
    const actor = await this.actorForProject(id);
    const commits = await scm.listCommits(repository, actor, 1);
    const sha = commits?.[0]?.sha;
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
      throw new BadRequestException('No repository commit is available to run');
    }

    const operationId = await this.beginOperation(id, 'dev', 'ci-retry', sha);
    await this.prisma.environment.updateMany({
      where: { id: env.id, activeOperationId: operationId },
      data: { statusReason: 'Waiting for CI retry' },
    });
    try {
      await scm.createRetryTag(repository, sha, actor);
    } catch (e) {
      await this.prisma.environment.updateMany({
        where: { id: env.id, activeOperationId: operationId },
        data: {
          status: env.status,
          statusReason: env.statusReason,
          activeOperationId: null,
        },
      });
      await this.completeOperation(operationId, 'failed', (e as Error).message);
      throw new BadRequestException((e as Error).message);
    }
    return this.get(id);
  }

  // Suspends a running environment (stops the container/process). The version
  // is kept so it remains visible what is deployed; Start resumes it.
  async stopEnv(id: string, envName: EnvName): Promise<Project> {
    const { env, slug } = await this.envContext(id, envName);
    if (env.activeOperationId) {
      throw new BadRequestException(`Environment '${envName}' has an active operation`);
    }
    if (env.status !== 'running') {
      throw new BadRequestException(`Environment '${envName}' is not running`);
    }
    await this.deployment.stop(env.provider as ProviderKind, {
      projectName: slug,
      env: envName,
      connection: this.targetConnection(env),
    });
    await this.prisma.environment.update({
      where: { projectId_name: { projectId: id, name: envName } },
      data: { status: 'stopped', statusReason: null },
    });
    return this.get(id);
  }

  // Re-starts a stopped environment at the same version (in the background;
  // the UI shows "deploying" and then the outcome).
  async startEnv(id: string, envName: EnvName): Promise<Project> {
    const env = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId: id, name: envName } },
    });
    if (!env.version) {
      throw new BadRequestException(`Environment '${envName}' has nothing to start`);
    }
    const operationId = await this.beginOperation(id, envName, 'start', env.version);
    void this.startEnvInBackground(id, envName, operationId);
    return this.get(id);
  }

  // Removes the environment's deployment (container/process teardown). The
  // environment becomes "empty" and can be deployed again (redeploy/promote).
  // The repository and the project itself are untouched.
  async removeEnv(id: string, envName: EnvName): Promise<Project> {
    const { env, slug } = await this.envContext(id, envName);
    if (env.activeOperationId) {
      const operation = await this.prisma.deploymentOperation.findUnique({
        where: { id: env.activeOperationId },
      });
      // A CI retry is only waiting for Gitea and has no deployment process to
      // clean up. Finish it synchronously so its eventual callback is stale.
      if (operation?.kind === 'ci-retry') {
        await this.prisma.$transaction([
          this.prisma.deploymentOperation.update({
            where: { id: operation.id },
            data: {
              status: 'cancelled',
              message: 'Cancellation requested by user',
              finishedAt: new Date(),
            },
          }),
          this.prisma.environment.update({
            where: { id: env.id },
            data: {
              status: 'empty',
              version: null,
              url: null,
              statusReason: null,
              allocatedPort: null,
              activeOperationId: null,
            },
          }),
        ]);
        return this.get(id);
      }
      await this.prisma.$transaction([
        this.prisma.deploymentOperation.update({
          where: { id: env.activeOperationId },
          data: { status: 'cancelled', message: 'Cancellation requested by user' },
        }),
        this.prisma.environment.update({
          where: { id: env.id },
          data: { statusReason: 'Cancellation requested — cleaning up' },
        }),
      ]);
      return this.get(id);
    }
    const provider = env.provider as ProviderKind;
    const connection = this.targetConnection(env);
    const teardown = await this.deployment.teardown(provider, {
      projectName: slug,
      env: envName,
      connection,
    });
    const cleanupWarning = teardown?.warning
      ? `Cleanup pending: ${teardown.warning}`
      : null;
    await this.prisma.environment.update({
      where: { projectId_name: { projectId: id, name: envName } },
      // Releasing allocatedPort returns the port to the pool.
      data: {
        status: 'empty',
        version: null,
        url: null,
        statusReason: cleanupWarning,
        allocatedPort: null,
      },
    });
    return this.get(id);
  }

  private async startEnvInBackground(
    id: string,
    envName: EnvName,
    operationId: string,
  ): Promise<void> {
    try {
      const { template, env, slug } = await this.envContext(id, envName);
      const appPort = this.isDemoSsh(env) ? await this.allocateSshPort(id, envName) : undefined;
      const result = await this.deployment.start(env.provider as ProviderKind, {
        projectName: slug,
        env: envName,
        port: template.port,
        healthPath: template.healthPath ?? '/health',
        startCommand: template.startCommand,
        version: env.version ?? undefined,
        appPort,
        connection: this.targetConnection(env),
      });
      if (await this.operationCancelled(operationId)) {
        const teardown = await this.deployment.teardown(env.provider as ProviderKind, {
          projectName: slug,
          env: envName,
          connection: this.targetConnection(env),
        });
        await this.prisma.environment.updateMany({
          where: { projectId: id, name: envName, activeOperationId: operationId },
          data: {
            status: 'empty',
            version: null,
            url: null,
            statusReason: teardown?.warning ? `Cleanup pending: ${teardown.warning}` : null,
            activeOperationId: null,
          },
        });
        await this.completeOperation(operationId, 'cancelled', 'Cancelled by user');
        return;
      }
      await this.prisma.environment.updateMany({
        where: { projectId: id, name: envName, activeOperationId: operationId },
        data: {
          status: result.status,
          url: result.url,
          statusReason: result.status === 'failed' ? (result.reason ?? null) : null,
        },
      });
      await this.completeOperation(
        operationId,
        result.status === 'failed' ? 'failed' : 'succeeded',
        result.reason,
      );
    } catch (e) {
      await this.prisma.environment
        .updateMany({
          where: { projectId: id, name: envName, activeOperationId: operationId },
          data: { status: 'failed', statusReason: (e as Error).message, activeOperationId: null },
        })
        .catch(() => undefined);
      await this.completeOperation(operationId, 'failed', (e as Error).message);
    }
  }

  // Allocates a unique application port for an SSH deployment. Ports come
  // from the configured range and are persisted in Environment.allocatedPort;
  // the unique constraint on that column rules out collisions even under
  // concurrent deployments (a losing writer just retries the next port).
  private async allocateSshPort(projectId: string, envName: EnvName): Promise<number> {
    const env = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
    });
    if (env.allocatedPort) return env.allocatedPort;

    const { appPortBase, appPortSlots } = config.providers.ssh;
    const used = await this.prisma.environment.findMany({
      where: { allocatedPort: { not: null } },
      select: { allocatedPort: true },
    });
    const taken = new Set(used.map((u) => u.allocatedPort));
    for (let port = appPortBase; port < appPortBase + appPortSlots; port++) {
      if (taken.has(port)) continue;
      try {
        await this.prisma.environment.update({
          where: { projectId_name: { projectId, name: envName } },
          data: { allocatedPort: port },
        });
        return port;
      } catch {
        // Unique violation — another deployment grabbed this port between
        // our read and write. Try the next candidate.
      }
    }
    throw new Error(
      `No free application ports on the SSH target (range ${appPortBase}–${appPortBase + appPortSlots - 1} is full). ` +
        'Remove unused deployments or widen INITPAD_SSH_APP_PORT_SLOTS.',
    );
  }

  // Shared context for environment operations: project, template, environment
  // row and the deployment slug.
  private async envContext(id: string, envName: EnvName) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const template = this.templates.get(project.templateId);
    const env = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId: id, name: envName } },
      include: { target: true },
    });
    const slug = this.deploySlug(repositoryRef(project));
    return { project, template, env, slug };
  }

  // The shared SSH port pool is only for the built-in demo VPS; a user's own
  // SSH server runs the app on the template port directly (no pool).
  private isDemoSsh(env: { provider: string; target?: TargetRow | null }): boolean {
    return env.provider === 'ssh' && env.target?.scope !== 'user';
  }

  // Deletes the project only after every managed environment has been torn
  // down. Source deletion is an explicit opt-in; a production deployment also
  // requires a separate acknowledgement enforced by the API.
  async remove(
    id: string,
    opts: {
      deleteRemoteRepo: boolean;
      confirmProduction: boolean;
      confirmCleanupDebt?: boolean;
    },
  ): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: { include: { target: true } }, owner: true },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    const production = row.environments.find(
      (env) =>
        env.name === 'prod' &&
        (env.status !== 'empty' || env.version !== null || env.url !== null),
    );
    if (production && !opts.confirmProduction) {
      throw new BadRequestException(
        'Production still has deployment state. Confirm production removal explicitly.',
      );
    }
    await this.cleanupProject(row, {
      repoAction: opts.deleteRemoteRepo ? 'delete' : 'detach',
      confirmCleanupDebt: opts.confirmCleanupDebt === true,
    });
  }

  /**
   * Reacts to a repository deleted directly in Gitea (system webhook):
   * tears down all deployments of the matching project and removes its
   * record, so no orphaned containers or rows remain. No-op when nothing
   * matches — e.g. when the deletion originated from the platform itself.
   */
  async removeByRepo(
    fullName: string,
    provider: ScmKind = 'gitea',
    repositoryId?: string,
  ): Promise<void> {
    if (fullName.split('/').length !== 2) return;
    const row = await this.prisma.project.findFirst({
      where: {
        scmProvider: provider,
        ...(repositoryId
          ? {
              OR: [
                { scmRepositoryId: repositoryId },
                // Legacy rows have no immutable id yet; retain the coordinate
                // fallback only for those rows, never for a conflicting id.
                { scmRepositoryId: null, scmFullName: fullName },
              ],
            }
          : { scmFullName: fullName }),
      },
      include: { environments: { include: { target: true } }, owner: true },
    });
    if (!row) return;
    this.logger.log(
      `Repository ${provider}:${repositoryId ?? fullName} was deleted — cleaning up project ${row.id}`,
    );
    // The repository itself is already gone; clean up everything else.
    await this.cleanupProject(row, { repoAction: 'gone' });
  }

  // Shared teardown used by user-initiated deletion and the SCM webhook.
  private async cleanupProject(
    row: Prisma.ProjectGetPayload<{
      include: { environments: { include: { target: true } }; owner: true };
    }>,
    opts: {
      repoAction: 'delete' | 'detach' | 'gone';
      confirmCleanupDebt?: boolean;
    },
  ): Promise<void> {
    const repository = repositoryRef(row);
    await this.prisma.deploymentOperation.updateMany({
      where: { environment: { projectId: row.id }, finishedAt: null },
      data: { status: 'cancelled', message: 'Project deletion requested', finishedAt: new Date() },
    });
    const slug = this.deploySlug(repository);
    for (const env of row.environments) {
      let teardownWarning: string | null = null;
      try {
        const teardown = await this.deployment.teardown(env.provider as ProviderKind, {
          projectName: slug,
          env: env.name,
          connection: this.targetConnection(env),
        });
        teardownWarning = teardown?.warning ?? null;
        // If a later target fails, keep an accurate, retryable project record
        // instead of claiming that resources already removed still run.
        await this.prisma.environment.update({
          where: { id: env.id },
          data: {
            status: 'empty',
            version: null,
            url: null,
            statusReason: teardownWarning ? `Cleanup pending: ${teardownWarning}` : null,
            allocatedPort: null,
            activeOperationId: null,
          },
        });
      } catch (error) {
        const reason = (error as Error).message || 'Unknown teardown error';
        await this.prisma.environment.update({
          where: { id: env.id },
          data: {
            status: 'failed',
            statusReason: `Cleanup failed: ${reason}`,
            activeOperationId: null,
          },
        });
        throw new BadRequestException(
          `Could not remove ${env.name} deployment from ${env.target?.name ?? env.provider}: ${reason}`,
        );
      }
      if (teardownWarning) {
        if (!opts.confirmCleanupDebt) {
          throw new BadRequestException(
            `Public ${env.name} deployment was removed from ${env.target?.name ?? env.provider}, but project deletion is waiting for target cleanup: ${teardownWarning}`,
          );
        }
        this.logger.warn(
          `Project ${row.id} deletion explicitly detached pending ${env.name} cleanup: ${teardownWarning}`,
        );
      }
    }
    // Only after all containers are stopped, remove the locally pulled
    // registry images of the project.
    await this.deployment.removeImages(this.imageRepo(repository));
    // Also delete the images from the Gitea registry (Packages) so no
    // orphaned artifacts remain.
    const scm = this.workspaceScm.provider(repository.provider);
    await scm.deletePackages(repository);
    if (opts.repoAction === 'delete') {
      await scm.deleteRepo(repository, this.actorForRepo(row));
    } else if (opts.repoAction === 'detach') {
      await scm.detachRepo(repository, this.actorForRepo(row));
    }
    rmSync(row.repoPath, { recursive: true, force: true });
    await this.prisma.project.delete({ where: { id: row.id } });
  }

  // Identity for repository operations. Coordinates come from the explicit
  // SCM locator; the legacy owner relation still supplies the stored user PAT.
  private actorForRepo(row: {
    scmProvider: string;
    scmOwner: string;
    scmInstallationId: string | null;
    owner: { username: string; accessToken: string } | null;
  }): ScmActor {
    if (row.scmProvider === 'github') {
      return {
        username: row.scmOwner,
        token: '',
        installationId: row.scmInstallationId ?? undefined,
      };
    }
    const token = row.owner?.accessToken
      ? decryptSecret(row.owner.accessToken)
      : config.gitea.token;
    return { username: row.owner?.username || row.scmOwner || config.gitea.user, token };
  }

  // Docker-safe deployment key namespaced by repo owner: <owner>-<name>.
  // Guarantees unique image/container names even for same-named projects of
  // different users.
  private deploySlug(repository: ScmRepositoryRef): string {
    return `${repository.owner}-${repository.name}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Registry image tag: <registry>/<owner>/<name>:<version>. Must match what
  // CI pushes (see ci.yml). Everything lowercase (registry requirement).
  private imageRef(repository: ScmRepositoryRef, version: string): string {
    return `${this.imageRepo(repository)}:${version}`;
  }

  // Registry repository without a tag: <registry>/<owner>/<name> (lowercase).
  private imageRepo(repository: ScmRepositoryRef): string {
    const registry = repository.provider === 'github' ? 'ghcr.io' : config.registry.host;
    return `${registry}/${repository.owner}/${repository.name}`.toLowerCase();
  }

  private async actorForProject(projectId: string): Promise<ScmActor> {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { owner: true },
    });
    if (!row) throw new NotFoundException(`Project '${projectId}' not found`);
    return this.actorForRepo(row);
  }

  async getCommits(id: string): Promise<Commit[]> {
    const project = await this.get(id);
    const template = this.templates.get(project.templateId);
    const actor = await this.actorForProject(id);
    const scm = this.workspaceScm.provider(project.scm.provider);

    const fromScm = await scm.listCommits(project.scm, actor);
    if (fromScm && fromScm.length > 0) {
      return Promise.all(
        fromScm.map(async (c) => {
          const statuses = await scm.listCommitStatuses(project.scm, c.sha, actor);
          return { ...c, pipeline: this.pipelineStages(template, statuses) };
        }),
      );
    }
    return [
      {
        sha: 'initial',
        message: project.lastCommit,
        author: 'DevPlatform',
        date: project.createdAt,
        pipeline: this.pipelineStages(template, null),
      },
    ];
  }

  // Cross-project activity feed: the recent commits of every owned project with
  // their CI/deploy pipeline state, merged newest-first. A failing project
  // (e.g. its Gitea repo is unreachable) is skipped, not fatal.
  async activity(userId: string, requestedWorkspaceId?: string): Promise<ActivityEvent[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    });
    const perProject = await Promise.all(
      rows.map(async (p): Promise<ActivityEvent[]> => {
        try {
          const commits = await this.getCommits(p.id);
          return commits.slice(0, 5).map((c) => ({
            projectId: p.id,
            projectName: p.name,
            sha: c.sha,
            message: c.message,
            author: c.author,
            date: c.date,
            pipeline: c.pipeline,
          }));
        } catch {
          return [];
        }
      }),
    );
    return perProject
      .flat()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 50);
  }

  // useRegistry=true → deploy the TESTED image from the registry (build
  // once); if it is missing, the deployment fails. useRegistry=false →
  // bootstrap build from the repository.
  private async deployEnv(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
    operationId: string,
  ): Promise<boolean> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const repository = repositoryRef(project);
    const template = this.templates.get(project.templateId);
    const env = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
      include: { target: true },
    });

    await this.prisma.environment.updateMany({
      where: { projectId, name: envName, activeOperationId: operationId },
      data: { status: 'deploying', statusReason: null },
    });
    // The built-in SSH VPS is shared — allocate a unique app port from the
    // database. A user's own SSH server uses the template port directly.
    const appPort = this.isDemoSsh(env) ? await this.allocateSshPort(projectId, envName) : undefined;

    // Live progress: providers report steps via onProgress; the latest is
    // persisted into statusReason so the UI can show it under the deploying env.
    // It is cleared (success) or replaced by the failure reason at the end.
    const setStage = (message: string) => {
      void this.prisma.deploymentOperation
        .findUnique({ where: { id: operationId }, select: { status: true } })
        .then((op) => {
          if (op?.status !== 'running') return;
          return this.prisma.environment.updateMany({
            where: { projectId, name: envName, activeOperationId: operationId },
            data: { statusReason: message },
          });
        })
        .catch(() => undefined);
    };

    // SFTP deploy of a template with a packaged artifact: extract the exact
    // CI-tested tree from its registry image and upload that. This applies to
    // Composer PHP apps and static nginx bundles alike; project build commands
    // never run inside the control plane.
    const useBuildExtract = env.provider === 'sftp' && !!template.buildArtifactPath;

    // Source-based providers (and Docker's bootstrap build) need the source
    // tree of the EXACT version. Gitea is the source of truth, so the tree is
    // downloaded on demand into a temp directory; a local `git archive` from
    // the (legacy) working copy is the fallback. The platform keeps no
    // persistent checkouts.
    const needsSource = !useBuildExtract && (env.provider !== 'docker' || !useRegistry);
    let source: RepoArchive | null = null;
    let extractedDir: string | null = null;
    let deployRepoPath = project.repoPath;
    let deployArtifactDir = template.artifactDir;
    let deployWritableDirs = template.writableDirs;
    let protectedWebLayout = false;

    if (useBuildExtract) {
      setStage('Fetching & extracting tested artifact');
      const imageRef = this.imageRef(repository, version);
      extractedDir = mkdtempSync(join(tmpdir(), 'initpad-artifact-'));
      await this.deployment.extractArtifact(imageRef, template.buildArtifactPath!, extractedDir);
      // getArchive packs the directory itself, so its tree is under the basename.
      deployRepoPath = join(extractedDir, basename(template.buildArtifactPath!));
      deployArtifactDir = undefined; // upload the whole extracted tree
      if (template.webRoot) {
        deployRepoPath = prepareProtectedWebLayout(
          deployRepoPath,
          extractedDir,
          template.webRoot,
        );
        deployWritableDirs = (template.writableDirs ?? []).map(
          (directory) => `${PRIVATE_APP_DIR}/${directory.replace(/^\/+|\/+$/g, '')}`,
        );
        protectedWebLayout = true;
      }
    } else if (needsSource) {
      const actor = await this.actorForProject(projectId);
      const scm = this.workspaceScm.provider(repository.provider);
      source =
        (await scm.downloadArchive(repository, version, actor)) ??
        (await exportVersion(project.repoPath, version));
      deployRepoPath = source?.dir ?? project.repoPath;
    }

    try {
      const result = await this.deployment.deploy(env.provider as ProviderKind, {
        projectName: this.deploySlug(repository),
        version,
        env: envName,
        repoPath: deployRepoPath,
        port: template.port,
        healthPath: template.healthPath ?? '/health',
        startCommand: template.startCommand,
        artifactDir: deployArtifactDir,
        webRoot: template.webRoot,
        protectedWebLayout,
        writableDirs: deployWritableDirs,
        appPort,
        onProgress: setStage,
        connection: this.targetConnection(env),
        imageRef: useRegistry
          ? this.imageRef(repository, version)
          : undefined,
        allowBuildFallback: !useRegistry,
      });
      if (await this.operationCancelled(operationId)) {
        const teardown = await this.deployment.teardown(env.provider as ProviderKind, {
          projectName: this.deploySlug(repository),
          env: envName,
          connection: this.targetConnection(env),
        });
        await this.prisma.environment.updateMany({
          where: { projectId, name: envName, activeOperationId: operationId },
          data: {
            status: 'empty',
            version: null,
            url: null,
            statusReason: teardown?.warning ? `Cleanup pending: ${teardown.warning}` : null,
            allocatedPort: null,
            activeOperationId: null,
          },
        });
        await this.completeOperation(operationId, 'cancelled', 'Cancelled by user');
        return false;
      }
      if (result.status === 'failed') {
        throw new Error(result.reason || `Deployment to '${envName}' failed`);
      }
      const published = await this.prisma.environment.updateMany({
        where: { projectId, name: envName, activeOperationId: operationId },
        data: {
          status: result.status,
          version,
          url: result.url,
          statusReason: null,
        },
      });
      return published.count === 1;
    } finally {
      source?.cleanup();
      if (extractedDir) rmSync(extractedDir, { recursive: true, force: true });
    }
  }

  // The "natural" prod target kind for a template. php/python have no built-in
  // ssh/sftp host that runs them, so they default to Docker (the user can
  // switch prod to their own PHP/SSH server afterwards).
  private defaultKind(template: TemplateManifest): ProviderKind {
    const rt = templateRuntime(template);
    if (rt === 'static') return 'sftp';
    if (rt === 'node') return 'ssh';
    return 'docker';
  }

  // Validates that a target can host a template (kind accepted + runtime
  // supported), raising a specific error otherwise. The predicate itself lives
  // in domain/capability (pure, unit-tested).
  private assertUsable(target: TargetRow, template: TemplateManifest): void {
    const capabilities = this.targets.parseCaps(target.capabilities);
    if (targetCanRun(template, { kind: target.kind as ProviderKind, capabilities })) return;
    if (!template.compatibleProviders.includes(target.kind as ProviderKind)) {
      throw new BadRequestException(`Template '${template.id}' cannot deploy over ${target.kind}.`);
    }
    throw new BadRequestException(
      `Target '${target.name}' cannot run ${templateRuntime(template)} apps (its capabilities: ${target.capabilities}).`,
    );
  }

  // Resolves the target for an environment at creation time: an explicit choice
  // (validated), or a sensible default (dev/test → built-in Docker; prod → the
  // built-in target for the template's natural kind, else Docker).
  private resolveEnvTarget(
    name: EnvName,
    template: TemplateManifest,
    targetId: string | undefined,
    entities: TargetRow[],
  ): TargetRow {
    const runtime = templateRuntime(template);
    if (targetId) {
      const t = entities.find((e) => e.id === targetId);
      if (!t) throw new NotFoundException(`Target '${targetId}' not found`);
      this.assertUsable(t, template);
      return t;
    }
    if (name === 'prod') {
      const kind = this.defaultKind(template);
      const natural = entities.find(
        (e) =>
          e.scope === 'builtin' &&
          e.kind === kind &&
          this.targets.parseCaps(e.capabilities).includes(runtime),
      );
      if (natural) return natural;
    }
    const docker = entities.find((e) => e.id === BUILTIN_DOCKER);
    if (!docker) {
      throw new BadRequestException(
        'Built-in Docker target is missing — the platform has not seeded its infrastructure yet.',
      );
    }
    return docker;
  }

  // CI stages derived from the artifact kind. The state is assembled from
  // Gitea commit statuses (one per ci.yml job); 'pending' = CI has not
  // reported for this commit yet.
  private pipelineStages(
    template: TemplateManifest,
    statuses: { context: string; status: string; targetUrl: string | null }[] | null,
  ): PipelineStage[] {
    // label = display name; tokens = possible job names in the commit status.
    const defs: { label: string; tokens: string[] }[] =
      template.artifact === 'static'
        ? [
            { label: 'build', tokens: ['build'] },
            { label: 'test', tokens: ['test'] },
            { label: 'deploy', tokens: ['deploy'] },
          ]
        : [
            { label: 'build', tokens: ['build'] },
            { label: 'test', tokens: ['test'] },
            { label: 'docker build', tokens: ['docker', 'docker build'] },
            { label: 'deploy', tokens: ['deploy'] },
          ];

    // Latest state + job link per job (statuses arrive newest-first).
    const latest = new Map<string, { status: string; url: string | null }>();
    for (const s of statuses ?? []) {
      const job = this.jobFromContext(s.context);
      if (job && !latest.has(job)) latest.set(job, { status: s.status, url: s.targetUrl });
    }

    const stages = defs.map((d) => {
      const hit = d.tokens.map((t) => latest.get(t)).find((v) => v !== undefined);
      return {
        name: d.label,
        status: hit ? this.mapCiStatus(hit.status) : ('pending' as StageStatus),
        url: hit?.url ?? null,
      };
    });

    // Jobs are chained via `needs`, so only the first unfinished stage can
    // actually be executing. Gitea, however, creates a "pending" status for
    // ALL jobs when the run starts — everything would light up as running.
    // Demote stages behind the first active/unsuccessful one to 'pending'
    // (queued) so the UI shows real progression.
    let blocked = false;
    for (const s of stages) {
      if (blocked && s.status === 'running') s.status = 'pending';
      if (s.status !== 'success') blocked = true;
    }
    return stages;
  }

  // Gitea commit status context has the form "<workflow> / <job> (<event>)".
  private jobFromContext(context: string): string | null {
    if (!context) return null;
    const noEvent = context.replace(/\s*\([^)]*\)\s*$/, '');
    const job = noEvent.includes('/')
      ? noEvent.slice(noEvent.lastIndexOf('/') + 1)
      : noEvent;
    return job.trim().toLowerCase();
  }

  private mapCiStatus(state: string): StageStatus {
    if (state === 'success') return 'success';
    if (state === 'failure' || state === 'error') return 'failed';
    return 'running'; // Gitea 'pending' = job is executing or queued
  }

  private toDomain(row: ProjectRow): Project {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      templateId: row.templateId,
      repoPath: row.repoPath,
      repoUrl: row.repoUrl,
      scm: {
        provider: row.scmProvider as ScmKind,
        repositoryId: row.scmRepositoryId,
        owner: row.scmOwner,
        name: row.scmRepositoryName,
        fullName: row.scmFullName,
        defaultBranch: row.scmDefaultBranch,
        repoUrl: row.repoUrl,
        installationId: row.scmInstallationId,
      },
      createdAt: row.createdAt.toISOString(),
      lastCommit: row.lastCommit,
      environments: [...row.environments]
        .sort((a, b) => a.order - b.order)
        .map((e) => ({
          name: e.name as EnvName,
          provider: e.provider as ProviderKind,
          status: e.status as DeployStatus,
          version: e.version,
          url: e.url,
          statusReason: e.statusReason,
          target: e.target
            ? {
                id: e.target.id,
                name: e.target.name,
                kind: e.target.kind as ProviderKind,
                scope: e.target.scope as TargetScope,
                host: e.target.host,
              }
            : null,
        })),
    };
  }

  // Points an environment at a (different) target — the core of a configurable
  // prod. Validates capability/compatibility. When the environment already has
  // a live deployment on another target, that deployment is torn down first so
  // it is not left orphaned on the old target; the environment then becomes
  // empty and can be (re)deployed to the new target.
  async bindTarget(id: string, envName: EnvName, targetId: string): Promise<Project> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const template = this.templates.get(project.templateId);
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: envName } },
      include: { target: true },
    });
    if (!env) throw new NotFoundException(`Environment '${envName}' not found`);
    if (env.activeOperationId) {
      throw new BadRequestException(
        `Environment '${envName}' is busy. Cancel or wait for its current operation first.`,
      );
    }

    const entities = await this.targets.listEntities(project.workspaceId);
    const target = entities.find((e) => e.id === targetId);
    if (!target) throw new NotFoundException(`Target '${targetId}' not found`);
    this.assertUsable(target, template);

    const movingAway = !!env.targetId && env.targetId !== target.id && env.status !== 'empty';
    if (movingAway) {
      const slug = this.deploySlug(repositoryRef(project));
      // Do not bind the new target until teardown succeeds; otherwise a failed
      // cleanup would leave an unreachable orphan on the old infrastructure.
      const teardown = await this.deployment.teardown(env.provider as ProviderKind, {
        projectName: slug,
        env: envName,
        connection: this.targetConnection(env),
      });
      if (teardown?.warning) {
        await this.prisma.environment.update({
          where: { id: env.id },
          data: {
            status: 'empty',
            version: null,
            url: null,
            statusReason: `Cleanup pending: ${teardown.warning}`,
            allocatedPort: null,
          },
        });
        throw new BadRequestException(
          `Public deployment was removed, but the target cannot be changed until cleanup finishes: ${teardown.warning}`,
        );
      }
    }

    await this.prisma.environment.update({
      where: { projectId_name: { projectId: id, name: envName } },
      data: {
        targetId: target.id,
        provider: target.kind,
        ...(movingAway
          ? { status: 'empty', version: null, url: null, statusReason: null, allocatedPort: null }
          : {}),
      },
    });
    return this.get(id);
  }
}
