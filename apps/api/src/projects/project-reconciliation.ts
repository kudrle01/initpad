import { Logger } from '@nestjs/common';
import { config } from '../config';
import { mapWithConcurrency } from '../common/concurrency';
import { publicHttpsUrlIssue } from '../common/public-url';
import { encryptSecret } from '../common/secret';
import { generateToken, hashToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import {
  ProjectScmFields,
  ScmActor,
  ScmKind,
  ScmProvider,
  ScmRepositoryRef,
  repositoryRef,
} from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { TemplatesService } from '../templates/templates.service';
import { pipelineStages } from './project-pipeline';
import { ProjectDeploymentOperations } from './project-deployment-operations';

const REPOSITORY_RECONCILE_INTERVAL_MS = 60_000;
const PROJECT_SCM_RECONCILE_INTERVAL_MS = 15_000;
const SCM_READ_CONCURRENCY = 4;

type ReconciliationRow = ProjectScmFields & {
  id: string;
  templateId: string;
  owner: { username: string; accessToken: string } | null;
};

type ResolveActor = (row: ReconciliationRow) => ScmActor;
type RemoveByRepo = (fullName: string, provider: ScmKind, repositoryId?: string) => Promise<void>;

/**
 * Owns best-effort SCM maintenance independently of user-facing project
 * operations. Reads only schedule this work; provider latency never extends a
 * project-list or project-detail request.
 */
export class ProjectReconciliation {
  private readonly logger = new Logger('ProjectReconciliation');
  private readonly repositoryReconcileAfter = new Map<string, number>();
  private readonly repositoryReconcileInFlight = new Set<string>();
  private readonly projectScmReconcileAfter = new Map<string, number>();
  private readonly projectScmReconcileInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly operations: ProjectDeploymentOperations,
    private readonly resolveActor: ResolveActor,
    private readonly removeByRepo: RemoveByRepo,
  ) {}

  // The SQL migration can safely backfill provider + owner/name without
  // contacting an external service, but it must not invent an immutable id.
  // Resolve missing ids and refresh mutable coordinates by immutable identity.
  async reconcileRepositoryIdentities(): Promise<void> {
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
        const actor = this.resolveActor(project);
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

  async reconcileCiRuntimeSecrets(): Promise<void> {
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
      await mapWithConcurrency(projects, SCM_READ_CONCURRENCY, async (project) => {
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
          await this.workspaceScm
            .provider(repository.provider)
            .configureRepoRuntimeSecrets(repository);
        } catch (error) {
          // One externally deleted/inaccessible repository must not prevent
          // configuration reconciliation for every healthy project.
          this.logger.warn(
            `CI runtime-secret reconciliation failed for ${repository.provider}:${repository.fullName}: ${(error as Error).message}`,
          );
        }
      });
    } catch (error) {
      this.logger.warn(`CI runtime-secret reconciliation skipped: ${(error as Error).message}`);
    }
  }

  // Projects created before repository-specific CI credentials used a single
  // platform-wide token. Rotate them per repository, grouped by owner.
  async migrateLegacyCiTokens(): Promise<void> {
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
        } catch (error) {
          this.logger.error(
            `CI credential migration for ${owner.username} failed: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      // During the first migration-aware startup the column may not exist yet.
      this.logger.warn(`CI credential migration skipped: ${(error as Error).message}`);
    }
  }

  scheduleMissingRepoReconciliation(workspaceId: string): void {
    const now = Date.now();
    this.pruneDeadlines(now);
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

  // A repository counts as gone only on an explicit provider result. An
  // outage never deletes anything; bounded concurrency protects the provider.
  private async pruneMissingRepos(workspaceId: string): Promise<void> {
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      include: { owner: true },
    });
    await mapWithConcurrency(rows, SCM_READ_CONCURRENCY, async (row) => {
      try {
        const repository = repositoryRef(row);
        const actor = this.resolveActor(row);
        if (await this.workspaceScm.provider(repository.provider).repoMissing(repository, actor)) {
          this.logger.log(
            `Repository ${repository.fullName} no longer exists in ${repository.provider} — cleaning up`,
          );
          await this.removeByRepo(
            repository.fullName,
            repository.provider,
            repository.repositoryId ?? undefined,
          ).catch((error) => this.logger.error(`Cleanup failed: ${(error as Error).message}`));
        }
      } catch (error) {
        this.logger.warn(
          `Repository check failed for project ${row.id}: ${(error as Error).message}`,
        );
      }
    });
  }

  // Detail reads schedule maintenance but never wait for provider I/O.
  async reconcileProject(id: string): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { owner: true },
    });
    if (!row) return;
    this.scheduleProject(row);
  }

  private scheduleProject(row: ReconciliationRow): void {
    const now = Date.now();
    this.pruneDeadlines(now);
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

  private pruneDeadlines(now: number): void {
    for (const [workspaceId, expiresAt] of this.repositoryReconcileAfter) {
      if (expiresAt <= now && !this.repositoryReconcileInFlight.has(workspaceId)) {
        this.repositoryReconcileAfter.delete(workspaceId);
      }
    }
    for (const [projectId, expiresAt] of this.projectScmReconcileAfter) {
      if (expiresAt <= now && !this.projectScmReconcileInFlight.has(projectId)) {
        this.projectScmReconcileAfter.delete(projectId);
      }
    }
  }

  async reconcileProjectScmState(row: ReconciliationRow): Promise<void> {
    const repository = repositoryRef(row);
    const actor = this.resolveActor(row);
    if (await this.workspaceScm.provider(repository.provider).repoMissing(repository, actor)) {
      this.logger.log(
        `Repository ${repository.fullName} no longer exists in ${repository.provider} — cleaning up`,
      );
      await this.removeByRepo(
        repository.fullName,
        repository.provider,
        repository.repositoryId ?? undefined,
      ).catch((error) => this.logger.error(`Cleanup failed: ${(error as Error).message}`));
      return;
    }
    await this.reconcileWaitingCiFailure(row, repository, actor).catch((error) =>
      this.logger.warn(
        `CI state reconciliation skipped for ${repository.fullName}: ${(error as Error).message}`,
      ),
    );
  }

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
      ? await this.prisma.deploymentOperation.findUnique({ where: { id: dev.activeOperationId } })
      : null;
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
}
