import {
  ActivityEvent,
  ActivityFeed,
  ActivityWarning,
  Commit,
  DeploymentOperationSummary,
  EnvName,
  PipelineStage,
  Project,
  TemplateManifest,
} from '../domain/types';
import { PrismaService } from '../prisma/prisma.service';
import { ScmActor } from '../scm/scm-provider';
import { WorkspaceScmService } from '../scm/workspace-scm.service';
import { TemplatesService } from '../templates/templates.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { mapWithConcurrency } from '../common/concurrency';
import { pipelineStages, withDeploymentState } from './project-pipeline';

const SCM_READ_CONCURRENCY = 4;
const ACTIVITY_COMMITS_PER_PROJECT = 5;
const ACTIVITY_DB_ROWS = 300;
const ACTIVITY_CACHE_TTL_MS = 60_000;
const ACTIVITY_CACHE_LIMIT = 1_000;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

type ProjectReader = (id: string) => Promise<Project>;
type ActorReader = (id: string) => Promise<ScmActor>;
type CommitReader = (id: string, limit?: number) => Promise<Commit[]>;

/**
 * Read-model queries for projects. Lifecycle and provisioning mutations remain
 * in ProjectsService; this component keeps their orchestration separate from
 * SCM-enriched projections used by the UI.
 */
export class ProjectQueries {
  private readonly commitCache = new Map<string, { commits: Commit[]; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly workspaceScm: WorkspaceScmService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async commits(
    id: string,
    limit: number,
    getProject: ProjectReader,
    getActor: ActorReader,
  ): Promise<Commit[]> {
    const project = await getProject(id);
    const template = this.templates.get(project.templateId);
    const actor = await getActor(id);
    const scm = this.workspaceScm.provider(project.scm.provider);

    const fromScm = await scm.listCommits(project.scm, actor, Math.min(Math.max(limit, 1), 100));
    if (fromScm && fromScm.length > 0) {
      const versions = fromScm
        .map((commit) => commit.sha.toLowerCase())
        .filter((sha) => /^[0-9a-f]{40}$/.test(sha));
      const operations =
        versions.length > 0
          ? await this.prisma.deploymentOperation.findMany({
              where: {
                environment: { projectId: id, name: 'dev' },
                version: { in: versions },
              },
              orderBy: { createdAt: 'desc' },
              include: { buildArtifact: { select: { providerRunId: true } } },
            })
          : [];
      const operationByVersion = new Map<string, (typeof operations)[number]>();
      for (const operation of operations) {
        const version = operation.version?.toLowerCase();
        if (version && !operationByVersion.has(version)) operationByVersion.set(version, operation);
      }
      const dev = project.environments.find((environment) => environment.name === 'dev');
      return mapWithConcurrency(fromScm, SCM_READ_CONCURRENCY, async (commit, index) => {
        const sha = commit.sha.toLowerCase();
        const operation = operationByVersion.get(sha);
        const currentDev =
          dev?.version?.toLowerCase() === sha ||
          (index === 0 && dev?.status === 'deploying' && !dev.version)
            ? dev
            : null;
        const preferredRunId =
          operation?.buildArtifact?.providerRunId ?? currentDev?.artifact?.runId ?? null;
        const statuses = await scm.listCommitStatuses(
          project.scm,
          commit.sha,
          actor,
          preferredRunId,
        );
        return {
          ...commit,
          pipeline: withDeploymentState(pipelineStages(template, statuses), currentDev, operation),
        };
      });
    }

    return [
      {
        sha: 'initial',
        message: project.lastCommit,
        author: 'DevPlatform',
        date: project.createdAt,
        pipeline: pipelineStages(template, null),
      },
    ];
  }

  async deploymentHistory(id: string, limit: number): Promise<DeploymentOperationSummary[]> {
    const operations = await this.prisma.deploymentOperation.findMany({
      where: { environment: { projectId: id } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        environment: { select: { name: true } },
        buildArtifact: { select: { providerRunId: true } },
      },
    });
    return operations.map((operation) => ({
      id: operation.id,
      correlationId: operation.correlationId,
      environment: operation.environment.name as EnvName,
      target: operation.targetName,
      kind: operation.kind,
      status: operation.status,
      phase: operation.phase,
      version: operation.version,
      message: operation.message,
      startedAt: operation.startedAt.toISOString(),
      finishedAt: operation.finishedAt?.toISOString() ?? null,
      artifactRunId: operation.buildArtifact?.providerRunId ?? null,
    }));
  }

  /** Activity built from InitPad's own records only; kept as a plain list. */
  async activity(
    userId: string,
    requestedWorkspaceId: string | undefined,
  ): Promise<ActivityEvent[]> {
    return (await this.activityFeed(userId, requestedWorkspaceId, false, () => Promise.resolve([])))
      .events;
  }

  /**
   * Workspace activity from deployment operations, build artifacts and each
   * project's lastCommit (ADR-179). SCM commits are an optional, cached
   * enrichment: a provider failure becomes a warning and the project keeps
   * its database events instead of silently disappearing.
   */
  async activityFeed(
    userId: string,
    requestedWorkspaceId: string | undefined,
    includeScm: boolean,
    getCommits: CommitReader,
  ): Promise<ActivityFeed> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    const [projects, operations, artifacts] = await Promise.all([
      this.prisma.project.findMany({
        where: { workspaceId },
        select: { id: true, name: true, templateId: true, lastCommit: true, createdAt: true },
      }),
      this.prisma.deploymentOperation.findMany({
        where: { environment: { name: 'dev', project: { workspaceId } }, version: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_DB_ROWS,
        select: {
          version: true,
          status: true,
          createdAt: true,
          environment: { select: { projectId: true } },
          buildArtifact: { select: { providerRunId: true } },
        },
      }),
      this.prisma.buildArtifact.findMany({
        where: { project: { workspaceId } },
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_DB_ROWS,
        select: { projectId: true, commitSha: true, status: true, createdAt: true },
      }),
    ]);

    type Entry = {
      sha: string;
      date: Date;
      operation?: (typeof operations)[number];
      artifact?: (typeof artifacts)[number];
    };
    const byProject = new Map<string, Map<string, Entry>>();
    const entry = (projectId: string, sha: string, date: Date): Entry => {
      const entries = byProject.get(projectId) ?? new Map<string, Entry>();
      byProject.set(projectId, entries);
      const existing = entries.get(sha) ?? { sha, date };
      if (date > existing.date) existing.date = date;
      entries.set(sha, existing);
      return existing;
    };
    for (const operation of operations) {
      const sha = operation.version?.toLowerCase();
      if (!sha || !COMMIT_SHA.test(sha)) continue;
      const item = entry(operation.environment.projectId, sha, operation.createdAt);
      item.operation ??= operation;
    }
    for (const artifact of artifacts) {
      const sha = artifact.commitSha.toLowerCase();
      if (!COMMIT_SHA.test(sha)) continue;
      const item = entry(artifact.projectId, sha, artifact.createdAt);
      item.artifact ??= artifact;
    }

    const events = new Map<string, ActivityEvent[]>();
    for (const project of projects) {
      let template: TemplateManifest | null = null;
      try {
        template = this.templates.get(project.templateId);
      } catch {
        template = null;
      }
      const entries = [...(byProject.get(project.id)?.values() ?? [])]
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, ACTIVITY_COMMITS_PER_PROJECT);
      const base = { projectId: project.id, projectName: project.name };
      events.set(
        project.id,
        entries.length > 0
          ? entries.map((item) => ({
              ...base,
              sha: item.sha,
              message: project.lastCommit.includes(item.sha.slice(0, 7))
                ? project.lastCommit
                : `Build ${item.sha.slice(0, 7)}`,
              author: 'CI',
              date: item.date.toISOString(),
              pipeline: template ? recordedPipeline(template, item) : [],
            }))
          : [
              {
                ...base,
                sha: 'initial',
                message: project.lastCommit,
                author: 'InitPad',
                date: project.createdAt.toISOString(),
                pipeline: template ? pipelineStages(template, null) : [],
              },
            ],
      );
    }

    const warnings: ActivityWarning[] = [];
    if (includeScm) {
      await mapWithConcurrency(projects, SCM_READ_CONCURRENCY, async (project) => {
        try {
          const commits = await this.cachedCommits(project.id, getCommits);
          if (commits.length === 0) return;
          events.set(
            project.id,
            commits.map((commit) => ({
              projectId: project.id,
              projectName: project.name,
              sha: commit.sha,
              message: commit.message,
              author: commit.author,
              date: commit.date,
              pipeline: commit.pipeline,
            })),
          );
        } catch (error) {
          warnings.push({
            projectId: project.id,
            projectName: project.name,
            message: `Repository activity is unavailable: ${(error as Error).message}`,
          });
        }
      });
    }

    return {
      events: [...events.values()]
        .flat()
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, 50),
      warnings,
    };
  }

  private async cachedCommits(projectId: string, getCommits: CommitReader): Promise<Commit[]> {
    const now = Date.now();
    const cached = this.commitCache.get(projectId);
    if (cached && cached.expiresAt > now) return cached.commits;
    const commits = await getCommits(projectId, ACTIVITY_COMMITS_PER_PROJECT);
    if (this.commitCache.size >= ACTIVITY_CACHE_LIMIT) {
      for (const [key, value] of this.commitCache) {
        if (value.expiresAt <= now) this.commitCache.delete(key);
      }
      if (this.commitCache.size >= ACTIVITY_CACHE_LIMIT) this.commitCache.clear();
    }
    this.commitCache.set(projectId, { commits, expiresAt: now + ACTIVITY_CACHE_TTL_MS });
    return commits;
  }
}

// Without provider statuses the stages are derived from what InitPad itself
// recorded: a deployment operation or a stored artifact proves the build.
function recordedPipeline(
  template: TemplateManifest,
  item: {
    operation?: { status: string; buildArtifact: { providerRunId: string } | null };
    artifact?: { status: string };
  },
): PipelineStage[] {
  const built =
    item.operation || item.artifact?.status === 'available'
      ? 'success'
      : item.artifact?.status === 'failed'
        ? 'failure'
        : item.artifact
          ? 'pending'
          : null;
  const stages = pipelineStages(
    template,
    built ? [{ context: 'build', status: built, targetUrl: null }] : null,
  );
  if (!item.operation) return stages;
  return withDeploymentState(stages, null, {
    status: item.operation.status,
    buildArtifact: item.operation.buildArtifact ?? { providerRunId: '' },
  });
}
