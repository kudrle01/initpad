import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { rmSync } from 'fs';
import { Prisma } from '@prisma/client';
import {
  ActivityEvent,
  Commit,
  DeploymentOperationSummary,
  EnvName,
  Project,
  ProviderKind,
} from '../domain/types';
import { templateRuntime } from '../domain/capability';
import { CreateProjectDto } from './dto/create-project.dto';
import { ImportProjectDto } from './dto/import-project.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { GeneratorService } from '../generator/generator.service';
import { DeploymentService } from '../deployment/deployment.service';
import { ARTIFACT_STORE, ArtifactStore } from '../artifacts/artifact-store';
import { TargetsService } from '../targets/targets.service';
import {
  ScmProvider,
  ScmActor,
  ScmRepositoryIdentity,
  ScmRepositoryRef,
  ProjectScmFields,
  ScmKind,
  repositoryRef,
} from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { config } from '../config';
import { decryptSecret, encryptSecret } from '../common/secret';
import { generateToken, hashToken } from '../common/token';
import { WorkspacePermission, WorkspacesService } from '../workspaces/workspaces.service';
import { ProvisioningService } from './provisioning.service';
import { publicHttpsUrlIssue } from '../common/public-url';
import { CI_WAITING_REASON } from './ci-state';
import { pipelineStages } from './project-pipeline';
import { ProjectQueries } from './project-queries';
import { projectView } from './project-view';
import { ProjectArtifactLifecycle } from './project-artifact-lifecycle';
import { ProjectAgentDelivery } from './project-agent-delivery';
import { ProjectEnvironmentTargets } from './project-environment-targets';
import { ProjectDeploymentOperations } from './project-deployment-operations';
import { ProjectEnvironmentLifecycle } from './project-environment-lifecycle';
import { ProjectDeploymentPreparation } from './project-deployment-preparation';
import { ProjectDeploymentExecutor } from './project-deployment-executor';
import { ProjectArtifactIngestion } from './project-artifact-ingestion';
import { CiArtifactInput, ProjectCiOrchestrator } from './project-ci-orchestrator';
import { AppConfigService } from './app-config.service';
import {
  deployedImageRef,
  deploymentSlug,
  imageRepository,
} from './project-deployment-identity';
import { mapWithConcurrency } from '../common/concurrency';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];
const REPOSITORY_RECONCILE_INTERVAL_MS = 60_000;
const PROJECT_SCM_RECONCILE_INTERVAL_MS = 15_000;
const SCM_READ_CONCURRENCY = 4;

type ProvisioningRetry = { retryOfId: string; attempt: number };
/**
 * The platform's core orchestrator: template scaffolding, repository
 * provisioning, environment lifecycle and deployments. State is persisted
 * in PostgreSQL via Prisma.
 */
@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger('ProjectsService');
  private readonly queries: ProjectQueries;
  private readonly artifactLifecycle: ProjectArtifactLifecycle;
  private readonly environmentTargets: ProjectEnvironmentTargets;
  private readonly operations: ProjectDeploymentOperations;
  private readonly environmentLifecycle: ProjectEnvironmentLifecycle;
  private readonly deploymentPreparation: ProjectDeploymentPreparation;
  private readonly deploymentExecutor: ProjectDeploymentExecutor;
  private readonly artifactIngestion: ProjectArtifactIngestion;
  private readonly ci: ProjectCiOrchestrator;
  private readonly repositoryReconcileAfter = new Map<string, number>();
  private readonly repositoryReconcileInFlight = new Set<string>();
  private readonly projectScmReconcileAfter = new Map<string, number>();
  private readonly projectScmReconcileInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly generator: GeneratorService,
    private readonly deployment: DeploymentService,
    private readonly targets: TargetsService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly workspaces: WorkspacesService,
    private readonly provisioning: ProvisioningService,
    @Inject(ARTIFACT_STORE) artifactStore: ArtifactStore,
  ) {
    this.queries = new ProjectQueries(prisma, templates, workspaceScm, workspaces);
    this.artifactLifecycle = new ProjectArtifactLifecycle(prisma, artifactStore, deployment);
    this.environmentTargets = new ProjectEnvironmentTargets(prisma, targets);
    this.operations = new ProjectDeploymentOperations(prisma);
    const agentDelivery = new ProjectAgentDelivery(prisma, artifactStore);
    this.environmentLifecycle = new ProjectEnvironmentLifecycle(
      prisma,
      templates,
      deployment,
      this.environmentTargets,
      this.operations,
      agentDelivery,
    );
    this.deploymentPreparation = new ProjectDeploymentPreparation(
      deployment,
      workspaceScm,
      new AppConfigService(prisma, workspaces),
    );
    this.deploymentExecutor = new ProjectDeploymentExecutor(
      prisma,
      templates,
      deployment,
      this.environmentTargets,
      this.environmentLifecycle,
      this.operations,
      this.deploymentPreparation,
      this.artifactLifecycle,
      agentDelivery,
      (projectId) => this.actorForProject(projectId),
    );
    this.artifactIngestion = new ProjectArtifactIngestion(
      prisma,
      workspaceScm,
      deployment,
      artifactStore,
      this.operations,
      (projectId, version, operationId) =>
        this.deployEnvInBackground(projectId, 'dev', version, true, operationId),
    );
    this.ci = new ProjectCiOrchestrator(
      prisma,
      workspaceScm,
      this.operations,
      this.artifactIngestion,
      (projectId) => this.actorForProject(projectId),
      (projectId, version, operationId) =>
        this.deployEnvInBackground(projectId, 'dev', version, true, operationId),
      (projectId, version, kind) =>
        this.scheduleDeployment(projectId, 'dev', version, true, kind),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.reconcileRepositoryIdentities();
    await this.migrateLegacyCiTokens();
    await this.reconcileCiRuntimeSecrets();
    await this.operations.recoverInterrupted();
    await this.artifactIngestion.recoverInterrupted();
    await this.environmentTargets.reconcileAllocations();
    // Best-effort retention sweep; never blocks startup on storage issues.
    await this.runArtifactRetention().catch((error) =>
      this.logger.warn(`Artifact retention sweep skipped: ${(error as Error).message}`),
    );
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
          if (repository.provider === 'github') {
            const callbackIssue = publicHttpsUrlIssue(config.ci.publicUrl);
            if (callbackIssue) {
              this.logger.warn(
                `CI runtime-secret reconciliation skipped for github:${repository.fullName}: ${callbackIssue}`,
              );
              return;
            }
          }
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

  private async scheduleDeployment(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
    kind: string,
    buildArtifactId?: string | null,
  ): Promise<void> {
    const operationId = await this.operations.begin(
      projectId,
      envName,
      kind,
      version,
      buildArtifactId,
    );
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
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      include: { environments: { include: { target: true, buildArtifact: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // SCM reconciliation is maintenance, not part of the user-facing read.
    // Repository webhooks remain the immediate path; this throttled sweep is a
    // fail-safe for missed events and must not make GET /projects O(repos).
    this.scheduleMissingRepoReconciliation(workspaceId);
    return rows.map((row) => projectView(row, config.publicHost));
  }

  private scheduleMissingRepoReconciliation(workspaceId: string): void {
    const now = Date.now();
    if (
      this.repositoryReconcileInFlight.has(workspaceId) ||
      (this.repositoryReconcileAfter.get(workspaceId) ?? 0) > now
    ) {
      return;
    }

    this.repositoryReconcileAfter.set(workspaceId, now + REPOSITORY_RECONCILE_INTERVAL_MS);
    this.repositoryReconcileInFlight.add(workspaceId);
    void this.pruneMissingRepos(workspaceId)
      .catch((error) =>
        this.logger.warn(
          `Repository reconciliation skipped for workspace ${workspaceId}: ${(error as Error).message}`,
        ),
      )
      .finally(() => this.repositoryReconcileInFlight.delete(workspaceId));
  }

  // Drops the owner's projects whose repositories no longer exist in Gitea.
  // A repository counts as gone ONLY on an explicit 404 (with a short request
  // timeout) — an outage never deletes anything. The sweep runs outside the
  // request path with bounded concurrency so a large workspace cannot flood
  // its SCM provider.
  private async pruneMissingRepos(workspaceId: string): Promise<void> {
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      include: { owner: true },
    });
    await mapWithConcurrency(
      rows,
      SCM_READ_CONCURRENCY,
      async (row) => {
        try {
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
        } catch (error) {
          this.logger.warn(
            `Repository check failed for project ${row.id}: ${(error as Error).message}`,
          );
        }
      },
    );
  }

  // Detail reads schedule SCM maintenance but never wait for it. Current
  // workflows and repository webhooks provide the immediate state changes;
  // this throttled path only recovers missed legacy callbacks/events.
  async reconcileProject(id: string): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { owner: true },
    });
    if (!row) return; // get() reports the 404
    this.scheduleProjectScmReconciliation(row);
  }

  private scheduleProjectScmReconciliation(
    row: ProjectScmFields & {
      id: string;
      templateId: string;
      owner: { username: string; accessToken: string } | null;
    },
  ): void {
    const now = Date.now();
    if (
      this.projectScmReconcileInFlight.has(row.id) ||
      (this.projectScmReconcileAfter.get(row.id) ?? 0) > now
    ) {
      return;
    }

    this.projectScmReconcileAfter.set(row.id, now + PROJECT_SCM_RECONCILE_INTERVAL_MS);
    this.projectScmReconcileInFlight.add(row.id);
    void this.reconcileProjectScmState(row)
      .catch((error) =>
        this.logger.warn(
          `SCM state reconciliation skipped for ${row.scmFullName}: ${(error as Error).message}`,
        ),
      )
      .finally(() => this.projectScmReconcileInFlight.delete(row.id));
  }

  private async reconcileProjectScmState(
    row: ProjectScmFields & {
      id: string;
      templateId: string;
      owner: { username: string; accessToken: string } | null;
    },
  ): Promise<void> {
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
      return;
    }
    await this.reconcileWaitingCiFailure(row, repository, actor).catch((error) =>
      this.logger.warn(
        `CI state reconciliation skipped for ${repository.fullName}: ${(error as Error).message}`,
      ),
    );
  }

  // Legacy/generated workflows used to notify InitPad only after every
  // upstream job succeeded. A failed build therefore had no callback and dev
  // remained "deploying" indefinitely. Project refreshes now close that wait
  // from provider status as a compatibility safety net; current workflows also
  // send an explicit terminal callback via `if: always()`.
  private async reconcileWaitingCiFailure(
    project: ProjectScmFields & { id: string; templateId: string },
    repository: ScmRepositoryRef,
    actor: ScmActor,
  ): Promise<void> {
    const dev = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: project.id, name: 'dev' } },
    });
    if (!dev || dev.status !== 'deploying') return;

    const operation = dev.activeOperationId
      ? await this.prisma.deploymentOperation.findUnique({
          where: { id: dev.activeOperationId },
        })
      : null;
    // Only a CI wait is reconciled here. A real deployment/ingestion owns its
    // own background failure handling and must never be overridden by SCM UI.
    if (operation && operation.kind !== 'ci-retry') return;

    let sha = operation?.version ?? null;
    const scm = this.workspaceScm.provider(repository.provider);
    if (!sha) {
      const commits = await scm.listCommits(repository, actor, 1);
      sha = commits?.[0]?.sha ?? null;
    }
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return;

    const statuses = await scm.listCommitStatuses(repository, sha, actor);
    const stages = pipelineStages(this.templates.get(project.templateId), statuses);
    const failed = stages.filter((stage) => stage.status === 'failed').map((stage) => stage.name);
    if (failed.length === 0) return;

    const reason =
      `CI failed before it could publish a deployable image (${failed.join(', ')}). ` +
      'Open the SCM run logs, fix the job and run again.';
    const closed = await this.prisma.environment.updateMany({
      where: {
        id: dev.id,
        status: 'deploying',
        activeOperationId: dev.activeOperationId,
      },
      data: {
        status: 'failed',
        statusReason: reason,
        deploymentRequired: true,
        activeOperationId: null,
      },
    });
    if (closed.count !== 1) return;
    if (operation) await this.operations.complete(operation.id, 'failed', reason);
    this.logger.warn(`Reconciled failed CI wait: ${repository.fullName} (${sha.slice(0, 7)})`);
  }

  async get(id: string): Promise<Project> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: { include: { target: true, buildArtifact: true } } },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    return projectView(row, config.publicHost);
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
    this.assertSaasCiCallback();
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
    const resolvedTargets = ENV_ORDER.map((name) => {
      const chosen = dto.environments?.find((e) => e.name === name)?.targetId;
      return {
        name,
        target: this.environmentTargets.resolveTarget(name, template, chosen, targets),
      };
    });
    const envTargets = await this.environmentTargets.prepareAllocations(
      workspaceId,
      resolvedTargets,
      templateRuntime(template),
    );

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
              create: envTargets.map(({ name, target, allocationId }, order) => ({
                name,
                order,
                provider: target.kind,
                targetId: target.id,
                allocationId,
                status: name === 'dev' ? 'deploying' : 'empty',
                statusReason: name === 'dev' ? CI_WAITING_REASON : null,
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
    this.assertSaasCiCallback();
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
        !workflow.includes('INITPAD_DEPLOY_TOKEN') ||
        (repo.provider === 'github' &&
          (!workflow.includes('artifact-id') ||
            !workflow.includes('artifact-digest') ||
            !workflow.includes('archive: false')))
      ) {
        throw new BadRequestException(
          `Cannot import '${repo.fullName}': add an InitPad-compatible workflow at '${workflowPath}' first.`,
        );
      }

      const targets = await this.targets.listEntities(workspaceId);
      const resolvedTargets = ENV_ORDER.map((name) => {
        const chosen = dto.environments?.find((e) => e.name === name)?.targetId;
        return {
          name,
          target: this.environmentTargets.resolveTarget(name, template, chosen, targets),
        };
      });
      const envTargets = await this.environmentTargets.prepareAllocations(
        workspaceId,
        resolvedTargets,
        templateRuntime(template),
      );

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
              create: envTargets.map(({ name, target, allocationId }, order) => ({
                name,
                order,
                provider: target.kind,
                targetId: target.id,
                allocationId,
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
      if (published) await this.operations.complete(operationId, 'succeeded');
    } catch (e) {
      this.logger.error(`Deploy to ${envName} failed: ${(e as Error).message}`);
      await this.prisma.environment
        .updateMany({
          where: { projectId, name: envName, activeOperationId: operationId },
          data: { status: 'failed', statusReason: (e as Error).message, activeOperationId: null },
        })
        .catch(() => undefined);
      await this.operations.complete(operationId, 'failed', (e as Error).message);
    }
  }

  async ciStarted(repo: string, sha: string, ref: string, token: string): Promise<void> {
    return this.ci.started(repo, sha, ref, token);
  }

  async deployFromCi(
    repo: string,
    sha: string,
    ref: string,
    token: string,
    artifactInput: CiArtifactInput = {},
  ): Promise<void> {
    return this.ci.deployFromCi(repo, sha, ref, token, artifactInput);
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
    const sourceEntity = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId: id, name: source.name } },
      select: { buildArtifactId: true },
    });
    await this.scheduleDeployment(
      id,
      target,
      source.version,
      true,
      'promote',
      sourceEntity.buildArtifactId,
    );
    return this.get(id);
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
    await this.scheduleDeployment(
      id,
      envName,
      env.version,
      useRegistry,
      'redeploy',
      env.buildArtifactId,
    );
    return this.get(id);
  }

  // Deploys dev after a cancelled/failed attempt or an explicit removal. If
  // CI already produced an immutable artifact, reuse only that deployment.
  // Otherwise queue CI for the latest main commit through a temporary tag and
  // track the wait as an operation so Cancel also invalidates a late callback.
  async runAgain(id: string): Promise<Project> {
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: 'dev' } },
      include: { target: true },
    });
    if (!env) throw new NotFoundException("Environment 'dev' not found");
    if (env.activeOperationId || !['empty', 'failed'].includes(env.status)) {
      throw new BadRequestException("Dev can only run again after it was cancelled or failed");
    }

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const repository = repositoryRef(project);
    const reusableOperation = await this.prisma.deploymentOperation.findFirst({
      where: {
        environmentId: env.id,
        version: { not: null },
        // A successful remove clears the Environment binding but deliberately
        // keeps the immutable artifact on its historical operation. Reuse it
        // instead of spending another CI run to publish identical bytes.
        OR: [
          {
            status: { in: ['succeeded', 'cancelled', 'failed'] },
            buildArtifactId: { not: null },
          },
          { status: { in: ['cancelled', 'failed'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusableOperation?.version) {
      const useRegistry = /^[0-9a-f]{40}$/i.test(reusableOperation.version);
      // For a GitHub registry image, reuse is possible only when the verified
      // artifact is present in the local daemon — or can be rehydrated from
      // durable object storage (ADR-059 §6). Non-GitHub paths reuse directly.
      const canReuseArtifact =
        repository.provider !== 'github' || !useRegistry
          ? true
          : reusableOperation.buildArtifactId != null &&
            (await this.artifactLifecycle.ensureImageAvailable(
              repository,
              id,
              reusableOperation.buildArtifactId,
            ));
      if (canReuseArtifact) {
        await this.scheduleDeployment(
          id,
          'dev',
          reusableOperation.version,
          useRegistry,
          reusableOperation.status === 'succeeded' ? 'redeploy' : 'retry',
          reusableOperation.buildArtifactId,
        );
        return this.get(id);
      }
    }

    const scm = this.workspaceScm.provider(repository.provider);
    const actor = await this.actorForProject(id);
    const commits = await scm.listCommits(repository, actor, 1);
    const sha = commits?.[0]?.sha;
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
      throw new BadRequestException('No repository commit is available to run');
    }

    // A tested Actions artifact may already exist even when the final callback
    // failed to reach a local/private control plane. Manual Deploy recovers
    // that exact artifact first instead of rebuilding the same commit.
    if (repository.provider === 'github' && scm.findBuildArtifact) {
      const recovered = await scm.findBuildArtifact(
        repository,
        sha,
        'initpad-image.tar',
      );
      if (recovered) {
        const operationId = await this.operations.begin(
          id,
          'dev',
          'artifact-recovery',
          sha,
        );
        await this.prisma.environment.updateMany({
          where: { id: env.id, activeOperationId: operationId },
          data: {
            statusReason: `Recovering tested GitHub build; deployment target: ${env.target?.name ?? env.provider}`,
          },
        });
        await this.artifactIngestion.queue(id, repository, recovered, operationId);
        return this.get(id);
      }
      this.assertGitHubCiCallback(repository);
    }

    const operationId = await this.operations.begin(id, 'dev', 'ci-retry', sha);
    await this.prisma.environment.updateMany({
      where: { id: env.id, activeOperationId: operationId },
      data: {
        statusReason: `Waiting for CI build; deployment target: ${env.target?.name ?? env.provider}`,
      },
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
      await this.operations.complete(operationId, 'failed', (e as Error).message);
      throw new BadRequestException((e as Error).message);
    }
    return this.get(id);
  }

  // Explicitly repairs the failed jobs of the Actions run that produced the
  // build currently bound to dev. This is deliberately separate from
  // runAgain/redeploy: those reuse verified bytes and do not spend CI minutes.
  async rerunFailedJobs(id: string): Promise<{ runId: string }> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const repository = repositoryRef(project);
    if (repository.provider !== 'github') {
      throw new BadRequestException('Failed-job re-run is currently available only for GitHub projects');
    }
    const dev = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: 'dev' } },
      include: { buildArtifact: { select: { providerRunId: true } } },
    });
    const runId = dev?.buildArtifact?.providerRunId;
    if (!dev?.version || !runId) {
      throw new BadRequestException('Dev has no artifact-producing GitHub Actions run to retry');
    }
    if (dev.deploymentRequired || !['running', 'stopped'].includes(dev.status)) {
      throw new BadRequestException(
        'Publish the verified build successfully before repairing its failed GitHub handoff job',
      );
    }
    const callbackIssue = publicHttpsUrlIssue(config.ci.publicUrl);
    if (callbackIssue) {
      throw new BadRequestException(
        `${callbackIssue} Configure the public InitPad URL before re-running the GitHub callback job.`,
      );
    }
    const scm = this.workspaceScm.provider('github');
    if (!scm.rerunFailedJobs) {
      throw new BadRequestException('The configured GitHub provider cannot re-run failed jobs');
    }
    const actor = await this.actorForProject(id);
    const statuses = await scm.listCommitStatuses(repository, dev.version, actor, runId);
    if (!statuses?.some((status) => ['failure', 'error'].includes(status.status))) {
      throw new BadRequestException('The latest attempt of this GitHub Actions run has no failed jobs');
    }
    try {
      // Refresh the callback URL before the retry. This repairs repositories
      // created while the control plane still advertised localhost.
      await scm.configureRepoRuntimeSecrets(repository);
      await scm.rerunFailedJobs(repository, runId);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    return { runId };
  }

  // Suspends a running environment (stops the container/process). The version
  // is kept so it remains visible what is deployed; Start resumes it.
  async stopEnv(id: string, envName: EnvName): Promise<Project> {
    await this.environmentLifecycle.stop(id, envName);
    return this.get(id);
  }

  // Re-starts a stopped environment at the same version (in the background;
  // the UI shows "deploying" and then the outcome).
  async startEnv(id: string, envName: EnvName): Promise<Project> {
    await this.environmentLifecycle.start(id, envName);
    return this.get(id);
  }

  // Removes the environment's deployment (container/process teardown). The
  // environment becomes "empty" and can be deployed again (redeploy/promote).
  // The repository and the project itself are untouched.
  async removeEnv(id: string, envName: EnvName): Promise<Project> {
    await this.environmentLifecycle.remove(id, envName);
    return this.get(id);
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
      include: {
        environments: { include: { target: true, allocation: true, buildArtifact: true } },
        owner: true,
      },
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
      include: {
        environments: { include: { target: true, allocation: true, buildArtifact: true } },
        owner: true,
      },
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
      include: {
        environments: { include: { target: true; allocation: true; buildArtifact: true } };
        owner: true;
      };
    }>,
    opts: {
      repoAction: 'delete' | 'detach' | 'gone';
      confirmCleanupDebt?: boolean;
    },
  ): Promise<void> {
    const remoteAgentDeployments = row.environments.filter(
      (environment) =>
        environment.target?.scope === 'user'
        && environment.target.kind === 'docker'
        && (
          environment.status !== 'empty'
          || environment.version !== null
          || environment.activeOperationId !== null
        ),
    );
    if (remoteAgentDeployments.length > 0) {
      throw new BadRequestException(
        `Remove Agent-managed deployments first (${remoteAgentDeployments.map((item) => item.name).join(', ')}). `
        + 'The project can be deleted after their cleanup jobs succeed.',
      );
    }
    const repository = repositoryRef(row);
    await this.prisma.deploymentOperation.updateMany({
      where: { environment: { projectId: row.id }, finishedAt: null },
      data: { status: 'cancelled', message: 'Project deletion requested', finishedAt: new Date() },
    });
    const slug = deploymentSlug(repository);
    for (const env of row.environments) {
      let teardownWarning: string | null = null;
      try {
        const teardown = await this.deployment.teardown(env.provider as ProviderKind, {
          projectName: slug,
          env: env.name,
          imageRef: deployedImageRef(repository, env),
          connection: this.environmentTargets.connection(env),
          allocation: this.environmentTargets.allocation(env),
        });
        teardownWarning = teardown?.warning ?? null;
        // If a later target fails, keep an accurate, retryable project record
        // instead of claiming that resources already removed still run.
        await this.prisma.environment.update({
          where: { id: env.id },
          data: {
            status: 'empty',
            version: null,
            buildArtifactId: null,
            url: null,
            statusReason: teardownWarning ? `Cleanup pending: ${teardownWarning}` : null,
            allocatedPort: null,
            activeOperationId: null,
            deploymentRequired: false,
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
    await this.deployment.removeImages(imageRepository(repository));
    // Remove durable build-artifact objects before deleting or detaching the
    // source repository. If object storage is unavailable, the most valuable
    // external resource (the user's source code) therefore remains intact and
    // the whole deletion can be retried safely. Store deletion is idempotent,
    // so a partial object purge is also safe to repeat.
    const artifactCleanupFailures = await this.artifactLifecycle.purgeProjectObjects(row.id);
    if (
      artifactCleanupFailures.length &&
      opts.repoAction !== 'gone' &&
      !opts.confirmCleanupDebt
    ) {
      throw new BadRequestException(
        `Project deployments were removed, but deleting stored build artifacts failed: ${artifactCleanupFailures.join('; ')}`,
      );
    }
    if (artifactCleanupFailures.length) {
      this.logger.warn(
        `Project ${row.id}: ${artifactCleanupFailures.length} stored artifact object(s) could not be deleted: ${artifactCleanupFailures.join('; ')}`,
      );
    }
    // Also delete images from the SCM registry so no generated packages remain.
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

  // Retention GC (ADR-059 §7): drops the durable objects of verified artifacts
  // older than the configured retention window, but never one still referenced
  // by a live Environment or an unfinished DeploymentOperation. The DB row is
  // kept (history stays intact for finished operations) but demoted so it is no
  // longer treated as deployable; a later deploy simply rebuilds.
  async runArtifactRetention(now: Date = new Date()): Promise<{ removed: number; kept: number }> {
    return this.artifactLifecycle.runRetention(now);
  }

  // Job-scoped presigned GET for a verified artifact (ADR-059 §8). Returns a
  // short-lived download URL for a deployment job / the future Agent to fetch the
  // exact tested bytes directly from object storage — no platform credentials, no
  // general browser download endpoint, and the URL is never persisted. TTL is
  // bounded by config.
  async presignArtifactDownload(
    buildArtifactId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.artifactLifecycle.presignDownload(buildArtifactId);
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

  private async actorForProject(projectId: string): Promise<ScmActor> {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { owner: true },
    });
    if (!row) throw new NotFoundException(`Project '${projectId}' not found`);
    return this.actorForRepo(row);
  }

  async getCommits(id: string, limit = 20): Promise<Commit[]> {
    return this.queries.commits(
      id,
      limit,
      (projectId) => this.get(projectId),
      (projectId) => this.actorForProject(projectId),
    );
  }

  async deploymentHistory(id: string, limit = 30): Promise<DeploymentOperationSummary[]> {
    return this.queries.deploymentHistory(id, limit);
  }

  // Cross-project activity feed: the recent commits of every owned project with
  // their CI/deploy pipeline state, merged newest-first. A failing project
  // (e.g. its Gitea repo is unreachable) is skipped, not fatal.
  async activity(userId: string, requestedWorkspaceId?: string): Promise<ActivityEvent[]> {
    return this.queries.activity(
      userId,
      requestedWorkspaceId,
      (projectId, limit) => this.getCommits(projectId, limit),
    );
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
    return this.deploymentExecutor.execute(
      projectId,
      envName,
      version,
      useRegistry,
      operationId,
    );
  }

  private assertSaasCiCallback(): void {
    if (config.edition !== 'saas') return;
    const issue = publicHttpsUrlIssue(config.ci.publicUrl);
    if (issue) {
      throw new BadRequestException(
        `${issue} Configure a public InitPad URL before creating or importing a GitHub project.`,
      );
    }
  }

  private assertGitHubCiCallback(repository: ScmRepositoryRef): void {
    if (repository.provider !== 'github') return;
    const issue = publicHttpsUrlIssue(config.ci.publicUrl);
    if (issue) {
      throw new BadRequestException(
        `${issue} No reusable tested artifact was found, so InitPad did not start another GitHub workflow. Configure a public InitPad URL first.`,
      );
    }
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
      include: { target: true, allocation: true, buildArtifact: true },
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
    this.environmentTargets.assertUsable(target, template);
    const allocation = await this.environmentTargets.ensureAllocation(
      project.workspaceId,
      target.id,
    );
    await this.environmentTargets.assertAcceptsDeploy(
      allocation.id,
      env.id,
      templateRuntime(template),
    );

    const targetChanged = env.targetId !== target.id;
    if (targetChanged && env.status === 'empty' && env.statusReason) {
      throw new BadRequestException(
        `Environment '${envName}' still has pending cleanup. Finish it before changing target.`,
      );
    }
    const movingAway = !!env.targetId && targetChanged && env.status !== 'empty';
    if (movingAway) {
      if (env.target?.scope === 'user' && env.target.kind === 'docker') {
        throw new BadRequestException(
          `Remove the Agent-managed '${envName}' deployment before changing its target.`,
        );
      }
      const repository = repositoryRef(project);
      const slug = deploymentSlug(repository);
      // Do not bind the new target until teardown succeeds; otherwise a failed
      // cleanup would leave an unreachable orphan on the old infrastructure.
      const teardown = await this.deployment.teardown(env.provider as ProviderKind, {
        projectName: slug,
        env: envName,
        imageRef: deployedImageRef(repository, env),
        connection: this.environmentTargets.connection(env),
        allocation: this.environmentTargets.allocation(env),
      });
      if (teardown?.warning) {
        await this.prisma.environment.update({
          where: { id: env.id },
          data: {
            status: 'empty',
            version: null,
            buildArtifactId: null,
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
        allocationId: allocation.id,
        provider: target.kind,
        ...(movingAway
          ? {
              status: 'empty',
              url: null,
              statusReason: null,
              allocatedPort: null,
            }
          : {}),
        ...(targetChanged ? { deploymentRequired: true } : {}),
      },
    });
    return this.get(id);
  }
}
