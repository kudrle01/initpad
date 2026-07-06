import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { rmSync } from 'fs';
import { Prisma } from '@prisma/client';
import {
  Commit,
  DeployStatus,
  EnvName,
  PipelineStage,
  Project,
  ProviderKind,
  StageStatus,
  TemplateManifest,
} from '../domain/types';
import { CreateProjectDto } from './dto/create-project.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { GeneratorService } from '../generator/generator.service';
import { DeploymentService } from '../deployment/deployment.service';
import { GiteaService, GiteaActor, RepoArchive } from '../scm/gitea.service';
import { exportVersion } from '../deployment/providers/source-export';
import { config } from '../config';
import { decryptSecret } from '../common/secret';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

type ProjectRow = Prisma.ProjectGetPayload<{ include: { environments: true } }>;

/**
 * The platform's core orchestrator: template scaffolding, repository
 * provisioning, environment lifecycle and deployments. State is persisted
 * in PostgreSQL via Prisma.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger('ProjectsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly generator: GeneratorService,
    private readonly deployment: DeploymentService,
    private readonly gitea: GiteaService,
  ) {}

  async list(ownerId: string): Promise<Project[]> {
    // Reconcile on read: refreshing the project list is the moment the user
    // expects reality — projects whose repositories were deleted directly in
    // Gitea are cleaned up here (the webhook remains as an instant path when
    // a Gitea version delivers it). No background timers needed.
    await this.pruneMissingRepos(ownerId);
    const rows = await this.prisma.project.findMany({
      where: { ownerId },
      include: { environments: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  // Drops the owner's projects whose repositories no longer exist in Gitea.
  // A repository counts as gone ONLY on an explicit 404 (with a short request
  // timeout) — an outage never deletes anything and never blocks the list
  // for long. Checks run in parallel; cheap at per-user scale.
  private async pruneMissingRepos(ownerId: string): Promise<void> {
    try {
      const rows = await this.prisma.project.findMany({
        where: { ownerId },
        include: { owner: true },
      });
      await Promise.all(
        rows.map(async (row) => {
          const actor = this.actorForRepo({ repoUrl: row.repoUrl, owner: row.owner });
          if (await this.gitea.repoMissing(row.name, actor)) {
            this.logger.log(
              `Repository ${actor.username}/${row.name} no longer exists in Gitea — cleaning up`,
            );
            await this.removeByRepo(`${actor.username}/${row.name}`).catch((e) =>
              this.logger.error(`Cleanup failed: ${(e as Error).message}`),
            );
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
    const actor = this.actorForRepo({ repoUrl: row.repoUrl, owner: row.owner });
    if (await this.gitea.repoMissing(row.name, actor)) {
      this.logger.log(
        `Repository ${actor.username}/${row.name} no longer exists in Gitea — cleaning up`,
      );
      await this.removeByRepo(`${actor.username}/${row.name}`).catch((e) =>
        this.logger.error(`Cleanup failed: ${(e as Error).message}`),
      );
      throw new NotFoundException(`Project '${id}' not found`);
    }
  }

  async get(id: string): Promise<Project> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: true },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    return this.toDomain(row);
  }

  // Verifies the project belongs to the signed-in user. Called at the start
  // of every user-facing operation (IDOR protection); internal flows (the CI
  // webhook) bypass it and authenticate differently.
  async assertOwner(id: string, ownerId: string): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      select: { ownerId: true },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    if (row.ownerId && row.ownerId !== ownerId) {
      throw new ForbiddenException('Not your project');
    }
  }

  async create(dto: CreateProjectDto, ownerId: string): Promise<Project> {
    // Project names are unique per account, not globally.
    if (await this.prisma.project.findFirst({ where: { ownerId, name: dto.name } })) {
      throw new BadRequestException(`You already have a project named '${dto.name}'`);
    }
    const template = this.templates.get(dto.templateId);
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const actor: GiteaActor = { username: owner.username, token: owner.accessToken };

    // The workspace directory is namespaced by owner (.workspace/<owner>/<name>)
    // so same-named projects of different users cannot collide.
    const { repoPath } = this.generator.generate(
      template.id,
      dto.name,
      `${owner.username}/${dto.name}`,
    );
    // The scaffold commit is authored by the platform's service account (bot),
    // see config.git. The developer's own commits carry their identity.
    await this.gitea.initLocal(repoPath);

    let repo: { repoUrl: string };
    try {
      repo = await this.gitea.provision(dto.name, repoPath, actor);
    } catch (e) {
      throw new BadRequestException(
        `Repository could not be created in Gitea: ${(e as Error).message}`,
      );
    }

    // The scaffold has been pushed — Gitea is now the source of truth and the
    // local working copy is no longer needed (deployments download the exact
    // commit from Gitea). Keeping the platform stateless w.r.t. code.
    rmSync(repoPath, { recursive: true, force: true });

    const created = await this.prisma.project.create({
      data: {
        name: dto.name,
        templateId: template.id,
        repoPath,
        repoUrl: repo.repoUrl,
        lastCommit: 'init: scaffold from template',
        ownerId,
        environments: {
          create: ENV_ORDER.map((name, order) => ({
            name,
            order,
            provider:
              dto.environments?.find((e) => e.name === name)?.provider ??
              this.defaultProvider(name, template),
            // dev immediately shows "deploying" — the deployment completes
            // in the background once CI builds the image.
            status: name === 'dev' ? 'deploying' : 'empty',
          })),
        },
      },
    });

    // No local bootstrap build: dev stays "deploying" until CI builds and
    // tests the real image (build once, deploy many). Pushing the scaffold
    // triggers CI; the webhook then deploys dev.
    return this.get(created.id);
  }

  // Wraps deployEnv so a failure never escapes as an unhandled rejection —
  // the environment is marked as failed with the reason instead.
  private async deployEnvInBackground(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
  ): Promise<void> {
    try {
      await this.deployEnv(projectId, envName, version, useRegistry);
    } catch (e) {
      this.logger.error(`Deploy to ${envName} failed: ${(e as Error).message}`);
      await this.prisma.environment
        .update({
          where: { projectId_name: { projectId, name: envName } },
          data: { status: 'failed', statusReason: (e as Error).message },
        })
        .catch(() => undefined);
    }
  }

  // CI → deploy: after a successful CI build, sync the latest commit and
  // deploy it to dev. Closes the E2E loop: commit → CI build/test/docker →
  // a running dev environment with the real code.
  async deployFromCi(repo: string, sha: string, ref: string): Promise<void> {
    const [owner, name] = repo.split('/');
    if (!owner || !name) throw new BadRequestException('Invalid repo');
    // Deploy from the main branch only.
    if (ref && ref !== 'main' && ref !== 'refs/heads/main') return;

    const user = await this.prisma.user.findFirst({ where: { username: owner } });
    const project = await this.prisma.project.findFirst({
      where: { name, ownerId: user?.id ?? undefined },
    });
    if (!project) {
      this.logger.warn(`CI deploy: project '${repo}' not found`);
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
    void this.deployEnvInBackground(project.id, 'dev', version, true);
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
    // once, deploy many). If the version is missing from the registry (e.g.
    // bootstrap without CI), the deployment fails rather than rebuilding.
    await this.deployEnv(id, target, source.version, true);
    return this.get(id);
  }

  // Last ~N log lines of the environment's running (or failed) deployment.
  async envLogs(id: string, envName: EnvName): Promise<string> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id } });
    const env = await this.prisma.environment.findUnique({
      where: { projectId_name: { projectId: id, name: envName } },
    });
    if (!env) throw new NotFoundException(`Environment '${envName}' not found`);
    return this.deployment.logs(env.provider as ProviderKind, {
      projectName: this.deploySlug(project.repoUrl, project.name),
      env: envName,
    });
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
    void this.deployEnvInBackground(id, envName, env.version, useRegistry);
    return this.get(id);
  }

  // Suspends a running environment (stops the container/process). The version
  // is kept so it remains visible what is deployed; Start resumes it.
  async stopEnv(id: string, envName: EnvName): Promise<Project> {
    const { env, slug } = await this.envContext(id, envName);
    if (env.status !== 'running') {
      throw new BadRequestException(`Environment '${envName}' is not running`);
    }
    await this.deployment.stop(env.provider as ProviderKind, { projectName: slug, env: envName });
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
    await this.prisma.environment.update({
      where: { projectId_name: { projectId: id, name: envName } },
      data: { status: 'deploying', statusReason: null },
    });
    void this.startEnvInBackground(id, envName);
    return this.get(id);
  }

  // Removes the environment's deployment (container/process teardown). The
  // environment becomes "empty" and can be deployed again (redeploy/promote).
  // The repository and the project itself are untouched.
  async removeEnv(id: string, envName: EnvName): Promise<Project> {
    const { env, slug } = await this.envContext(id, envName);
    await this.deployment.teardown(env.provider as ProviderKind, { projectName: slug, env: envName });
    await this.prisma.environment.update({
      where: { projectId_name: { projectId: id, name: envName } },
      // Releasing allocatedPort returns the port to the pool.
      data: { status: 'empty', version: null, url: null, statusReason: null, allocatedPort: null },
    });
    return this.get(id);
  }

  private async startEnvInBackground(id: string, envName: EnvName): Promise<void> {
    try {
      const { template, env, slug } = await this.envContext(id, envName);
      const appPort =
        env.provider === 'ssh' ? await this.allocateSshPort(id, envName) : undefined;
      const result = await this.deployment.start(env.provider as ProviderKind, {
        projectName: slug,
        env: envName,
        port: template.port,
        healthPath: template.healthPath ?? '/health',
        startCommand: template.startCommand,
        version: env.version ?? undefined,
        appPort,
      });
      await this.prisma.environment.update({
        where: { projectId_name: { projectId: id, name: envName } },
        data: {
          status: result.status,
          url: result.url,
          statusReason: result.status === 'failed' ? (result.reason ?? null) : null,
        },
      });
    } catch (e) {
      await this.prisma.environment
        .update({
          where: { projectId_name: { projectId: id, name: envName } },
          data: { status: 'failed', statusReason: (e as Error).message },
        })
        .catch(() => undefined);
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
    });
    const slug = this.deploySlug(project.repoUrl, project.name);
    return { project, template, env, slug };
  }

  // Deletes the project: tears down all environment deployments, removes the
  // Gitea repository, the workspace directory and the DB row (environments
  // are removed by cascade).
  async remove(id: string, ownerId: string): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: true, owner: true },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    if (row.ownerId && row.ownerId !== ownerId) {
      throw new ForbiddenException('Not your project');
    }
    await this.cleanupProject(row, { deleteRemoteRepo: true });
  }

  /**
   * Reacts to a repository deleted directly in Gitea (system webhook):
   * tears down all deployments of the matching project and removes its
   * record, so no orphaned containers or rows remain. No-op when nothing
   * matches — e.g. when the deletion originated from the platform itself.
   */
  async removeByRepo(fullName: string): Promise<void> {
    const [owner, name] = fullName.split('/');
    if (!owner || !name) return;
    const user = await this.prisma.user.findFirst({ where: { username: owner } });
    const row = await this.prisma.project.findFirst({
      where: { name, ownerId: user?.id ?? undefined },
      include: { environments: true, owner: true },
    });
    if (!row) return;
    this.logger.log(`Repository ${fullName} was deleted in Gitea — cleaning up project ${row.id}`);
    // The repository itself is already gone; clean up everything else.
    await this.cleanupProject(row, { deleteRemoteRepo: false });
  }

  // Shared teardown used by user-initiated deletion and the SCM webhook.
  private async cleanupProject(
    row: Prisma.ProjectGetPayload<{ include: { environments: true; owner: true } }>,
    opts: { deleteRemoteRepo: boolean },
  ): Promise<void> {
    const slug = this.deploySlug(row.repoUrl, row.name);
    for (const env of row.environments) {
      await this.deployment.teardown(env.provider as ProviderKind, {
        projectName: slug,
        env: env.name,
      });
    }
    // Only after all containers are stopped, remove the locally pulled
    // registry images of the project.
    await this.deployment.removeImages(this.imageRepo(row.repoUrl, row.name));
    // Also delete the images from the Gitea registry (Packages) so no
    // orphaned artifacts remain.
    const owner = this.ownerFromRepoUrl(row.repoUrl) ?? config.gitea.user;
    await this.gitea.deletePackages(owner, row.name);
    if (opts.deleteRemoteRepo) {
      await this.gitea.deleteRepo(
        row.name,
        this.actorForRepo({ repoUrl: row.repoUrl, owner: row.owner }),
      );
    }
    rmSync(row.repoPath, { recursive: true, force: true });
    await this.prisma.project.delete({ where: { id: row.id } });
  }

  // Identity for repository operations: username = the ACTUAL repo owner
  // parsed from repoUrl (.../<owner>/<name>), token = the owner's token
  // (with the platform token as fallback).
  private actorForRepo(row: {
    repoUrl: string | null;
    owner: { username: string; accessToken: string } | null;
  }): GiteaActor {
    const token = row.owner?.accessToken
      ? decryptSecret(row.owner.accessToken)
      : config.gitea.token;
    const username =
      this.ownerFromRepoUrl(row.repoUrl) ?? row.owner?.username ?? config.gitea.user;
    return { username, token };
  }

  // Docker-safe deployment key namespaced by repo owner: <owner>-<name>.
  // Guarantees unique image/container names even for same-named projects of
  // different users.
  private deploySlug(repoUrl: string | null, name: string): string {
    const owner = this.ownerFromRepoUrl(repoUrl) ?? 'anon';
    return `${owner}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Registry image tag: <registry>/<owner>/<name>:<version>. Must match what
  // CI pushes (see ci.yml). Everything lowercase (registry requirement).
  private imageRef(repoUrl: string | null, name: string, version: string): string {
    return `${this.imageRepo(repoUrl, name)}:${version}`;
  }

  // Registry repository without a tag: <registry>/<owner>/<name> (lowercase).
  private imageRepo(repoUrl: string | null, name: string): string {
    const owner = this.ownerFromRepoUrl(repoUrl) ?? config.gitea.user;
    return `${config.registry.host}/${owner}/${name}`.toLowerCase();
  }

  private ownerFromRepoUrl(repoUrl: string | null): string | null {
    if (!repoUrl) return null;
    try {
      const parts = new URL(repoUrl).pathname.split('/').filter(Boolean);
      return parts[0] ?? null; // /<owner>/<name>
    } catch {
      return null;
    }
  }

  private async actorForProject(projectId: string): Promise<GiteaActor> {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { owner: true },
    });
    return this.actorForRepo({ repoUrl: row?.repoUrl ?? null, owner: row?.owner ?? null });
  }

  async getCommits(id: string): Promise<Commit[]> {
    const project = await this.get(id);
    const template = this.templates.get(project.templateId);
    const actor = await this.actorForProject(id);

    const fromGitea = await this.gitea.listCommits(project.name, actor);
    if (fromGitea && fromGitea.length > 0) {
      return Promise.all(
        fromGitea.map(async (c) => {
          const statuses = await this.gitea.listCommitStatuses(project.name, c.sha, actor);
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

  // useRegistry=true → deploy the TESTED image from the registry (build
  // once); if it is missing, the deployment fails. useRegistry=false →
  // bootstrap build from the repository.
  private async deployEnv(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
  ) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const template = this.templates.get(project.templateId);
    const env = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
    });

    await this.prisma.environment.update({
      where: { projectId_name: { projectId, name: envName } },
      data: { status: 'deploying', statusReason: null },
    });
    // SSH targets share one host — the platform allocates a unique app port
    // from the database before handing the deployment to the provider.
    const appPort =
      env.provider === 'ssh' ? await this.allocateSshPort(projectId, envName) : undefined;

    // Source-based providers (and Docker's bootstrap build) need the source
    // tree of the EXACT version. Gitea is the source of truth, so the tree is
    // downloaded on demand into a temp directory; a local `git archive` from
    // the (legacy) working copy is the fallback. The platform keeps no
    // persistent checkouts.
    const needsSource = env.provider !== 'docker' || !useRegistry;
    let source: RepoArchive | null = null;
    if (needsSource) {
      const actor = await this.actorForProject(projectId);
      source =
        (await this.gitea.downloadArchive(project.name, version, actor)) ??
        (await exportVersion(project.repoPath, version));
    }

    try {
      const result = await this.deployment.deploy(env.provider as ProviderKind, {
        projectName: this.deploySlug(project.repoUrl, project.name),
        version,
        env: envName,
        repoPath: source?.dir ?? project.repoPath,
        port: template.port,
        healthPath: template.healthPath ?? '/health',
        startCommand: template.startCommand,
        artifactDir: template.artifactDir,
        appPort,
        imageRef: useRegistry
          ? this.imageRef(project.repoUrl, project.name, version)
          : undefined,
        allowBuildFallback: !useRegistry,
      });
      await this.prisma.environment.update({
        where: { projectId_name: { projectId, name: envName } },
        data: {
          status: result.status,
          version,
          url: result.url,
          statusReason: result.status === 'failed' ? (result.reason ?? null) : null,
        },
      });
    } finally {
      source?.cleanup();
    }
  }

  // dev/test run on Docker; prod is chosen by the template's artifact kind.
  private defaultProvider(name: EnvName, template: TemplateManifest): ProviderKind {
    if (name === 'prod') {
      return template.artifact === 'static' ? 'sftp' : 'ssh';
    }
    return 'docker';
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
      name: row.name,
      templateId: row.templateId,
      repoPath: row.repoPath,
      repoUrl: row.repoUrl,
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
        })),
    };
  }
}
