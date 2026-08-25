import {
  ActivityEvent,
  Commit,
  DeploymentOperationSummary,
  EnvName,
  Project,
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

type ProjectReader = (id: string) => Promise<Project>;
type ActorReader = (id: string) => Promise<ScmActor>;
type CommitReader = (id: string, limit?: number) => Promise<Commit[]>;

/**
 * Read-model queries for projects. Lifecycle and provisioning mutations remain
 * in ProjectsService; this component keeps their orchestration separate from
 * SCM-enriched projections used by the UI.
 */
export class ProjectQueries {
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
      return mapWithConcurrency(
        fromScm,
        SCM_READ_CONCURRENCY,
        async (commit, index) => {
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
            pipeline: withDeploymentState(
              pipelineStages(template, statuses),
              currentDev,
              operation,
            ),
          };
        },
      );
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

  async activity(
    userId: string,
    requestedWorkspaceId: string | undefined,
    getCommits: CommitReader,
  ): Promise<ActivityEvent[]> {
    const { id: workspaceId } = await this.workspaces.resolve(userId, requestedWorkspaceId);
    const rows = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    });
    const perProject = await mapWithConcurrency(
      rows,
      SCM_READ_CONCURRENCY,
      async (project): Promise<ActivityEvent[]> => {
        try {
          const commits = await getCommits(project.id, ACTIVITY_COMMITS_PER_PROJECT);
          return commits.map((commit) => ({
            projectId: project.id,
            projectName: project.name,
            sha: commit.sha,
            message: commit.message,
            author: commit.author,
            date: commit.date,
            pipeline: commit.pipeline,
          }));
        } catch {
          return [];
        }
      },
    );
    return perProject
      .flat()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 50);
  }
}
