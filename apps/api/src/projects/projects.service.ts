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
import { GiteaService, GiteaActor } from '../scm/gitea.service';
import { config } from '../config';
import { decryptSecret } from '../common/secret';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

type ProjectRow = Prisma.ProjectGetPayload<{ include: { environments: true } }>;

// Orchestruje generování ze šablony, založení prostředí a nasazení.
// Stav je perzistentní v PostgreSQL (Prisma).
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
    const rows = await this.prisma.project.findMany({
      where: { ownerId },
      include: { environments: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async get(id: string): Promise<Project> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: true },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    return this.toDomain(row);
  }

  async create(dto: CreateProjectDto, ownerId: string): Promise<Project> {
    // Název je unikátní jen v rámci účtu – kontrola per vlastník.
    if (await this.prisma.project.findFirst({ where: { ownerId, name: dto.name } })) {
      throw new BadRequestException(`You already have a project named '${dto.name}'`);
    }
    const template = this.templates.get(dto.templateId);
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const actor: GiteaActor = { username: owner.username, token: owner.accessToken };

    // Workspace složku namespacujeme vlastníkem (.workspace/<owner>/<name>),
    // aby dva stejnojmenné projekty různých uživatelů nekolidovaly.
    const { repoPath } = this.generator.generate(
      template.id,
      dto.name,
      `${owner.username}/${dto.name}`,
    );
    // Scaffold commit dělá servisní účet platformy (bot) – viz config.git.
    // Reálné commity vývojáře pak nesou jeho identitu.
    await this.gitea.initLocal(repoPath);

    let repo: { repoUrl: string };
    try {
      repo = await this.gitea.provision(dto.name, repoPath, actor);
    } catch (e) {
      throw new BadRequestException(
        `Repository could not be created in Gitea: ${(e as Error).message}`,
      );
    }

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
            // dev rovnou ukazuje "deploying" – nasazení doběhne na pozadí.
            status: name === 'dev' ? 'deploying' : 'empty',
          })),
        },
      },
    });

    // Žádný lokální bootstrap: dev zůstává "deploying" a naskočí až s reálným
    // otestovaným image, který postaví a nasadí CI (build once, deploy many).
    // Úvodní push scaffoldu CI spustí; webhook pak dev nasadí.
    return this.get(created.id);
  }

  // Obalí deployEnv tak, aby případná chyba nezůstala "viset" jako unhandled
  // a prostředí se označilo jako failed.
  private async deployEnvInBackground(
    projectId: string,
    envName: EnvName,
    version: string,
    useRegistry: boolean,
  ): Promise<void> {
    try {
      await this.deployEnv(projectId, envName, version, useRegistry);
    } catch (e) {
      this.logger.error(`Deploy ${envName} selhal: ${(e as Error).message}`);
      await this.prisma.environment
        .update({
          where: { projectId_name: { projectId, name: envName } },
          data: { status: 'failed', statusReason: (e as Error).message },
        })
        .catch(() => undefined);
    }
  }

  // CI → deploy: po úspěšném buildu v CI stáhne poslední commit a nasadí dev.
  // Uzavírá E2E: commit → CI build/test/docker → běžící dev s reálným kódem.
  async deployFromCi(repo: string, sha: string, ref: string): Promise<void> {
    const [owner, name] = repo.split('/');
    if (!owner || !name) throw new BadRequestException('Invalid repo');
    // Nasazujeme jen z hlavní větve.
    if (ref && ref !== 'main' && ref !== 'refs/heads/main') return;

    const user = await this.prisma.user.findFirst({ where: { username: owner } });
    const project = await this.prisma.project.findFirst({
      where: { name, ownerId: user?.id ?? undefined },
    });
    if (!project) {
      this.logger.warn(`CI deploy: projekt '${repo}' nenalezen`);
      return;
    }

    try {
      await this.gitea.syncFromRemote(project.repoPath);
    } catch (e) {
      this.logger.error(`CI deploy: sync selhal: ${(e as Error).message}`);
    }
    // Verze = plný hash commitu (jednoznačný, sedí s tagem image z CI).
    const version = sha || '0.1.0';
    await this.prisma.project.update({
      where: { id: project.id },
      data: { lastCommit: `ci: deploy ${version.slice(0, 7)}` },
    });
    // Na pozadí – webhook z CI se hned vrátí, deploy (pull+run) doběhne pak.
    // useRegistry=true: nasadí přesně ten image, který CI postavilo a otestovalo.
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
    // Promote = spustit v cíli TEN SAMÝ image z registru (build once, deploy
    // many). Když daná verze v registru není (např. jen bootstrap bez CI),
    // deploy selže místo přebudování.
    await this.deployEnv(id, target, source.version, true);
    return this.get(id);
  }

  // Posledních N řádků logu běžícího/spadlého nasazení daného prostředí.
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

  // Znovu nasadí prostředí jeho aktuální verzí. Verze-hash = z registru (build
  // once), bootstrap verze (0.1.0) = rebuild z repa.
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

  // Smaže projekt: zastaví kontejnery všech prostředí, smaže repo v Gitee,
  // workspace složku i DB záznam (prostředí padají kaskádou).
  async remove(id: string, ownerId: string): Promise<void> {
    const row = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: true, owner: true },
    });
    if (!row) throw new NotFoundException(`Project '${id}' not found`);
    if (row.ownerId && row.ownerId !== ownerId) {
      throw new ForbiddenException('Not your project');
    }

    const slug = this.deploySlug(row.repoUrl, row.name);
    for (const env of row.environments) {
      await this.deployment.teardown(env.provider as ProviderKind, {
        projectName: slug,
        env: env.name,
      });
    }
    // Až po zastavení všech kontejnerů smaž i stažené registrové image projektu.
    await this.deployment.removeImages(this.imageRepo(row.repoUrl, row.name));
    // Smaž i image v Gitea registru (Packages), ať nezůstanou orphan artefakty.
    const owner = this.ownerFromRepoUrl(row.repoUrl) ?? config.gitea.user;
    await this.gitea.deletePackages(owner, row.name);
    await this.gitea.deleteRepo(
      row.name,
      this.actorForRepo({ repoUrl: row.repoUrl, owner: row.owner }),
    );
    rmSync(row.repoPath, { recursive: true, force: true });
    await this.prisma.project.delete({ where: { id } });
  }

  // Identita pro operace s repem: username = SKUTEČNÝ vlastník repa z repoUrl
  // (.../<owner>/<name>), token = vlastníkův (nebo platformní fallback).
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

  // Docker-safe klíč nasazení, namespacovaný vlastníkem repa: <owner>-<name>.
  // Zajišťuje unikátní jména image/kontejnerů i pro stejnojmenné projekty
  // různých uživatelů.
  private deploySlug(repoUrl: string | null, name: string): string {
    const owner = this.ownerFromRepoUrl(repoUrl) ?? 'anon';
    return `${owner}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Tag image v registru: <registry>/<owner>/<name>:<version>. Musí sedět s tím,
  // co pushne CI (viz ci.yml). Vše lowercase (požadavek registru).
  private imageRef(repoUrl: string | null, name: string, version: string): string {
    return `${this.imageRepo(repoUrl, name)}:${version}`;
  }

  // Registrové repo bez tagu: <registry>/<owner>/<name> (lowercase).
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

  // useRegistry=true → nasadí OTESTOVANÝ image z registru (build once); když
  // chybí, deploy selže. useRegistry=false → bootstrap build z repa.
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
    const result = await this.deployment.deploy(env.provider as ProviderKind, {
      projectName: this.deploySlug(project.repoUrl, project.name),
      version,
      env: envName,
      repoPath: project.repoPath,
      port: template.port,
      healthPath: template.healthPath ?? '/health',
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
  }

  // dev/test běží na Dockeru, prod se volí podle typu artefaktu šablony.
  private defaultProvider(name: EnvName, template: TemplateManifest): ProviderKind {
    if (name === 'prod') {
      return template.artifact === 'static' ? 'sftp' : 'ssh';
    }
    return 'docker';
  }

  // CI stagey podle typu artefaktu. Stav se skládá z commit statusů z Gitey
  // (jeden status na job ci.yml); 'pending' = CI pro commit ještě neproběhlo.
  private pipelineStages(
    template: TemplateManifest,
    statuses: { context: string; status: string; targetUrl: string | null }[] | null,
  ): PipelineStage[] {
    // label = co se zobrazí; tokens = možné názvy/id jobu v commit statusu.
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

    // Nejnovější stav + odkaz na job (statusy chodí seřazené od nejnovějšího).
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

    // Joby na sebe navazují (needs), takže reálně běží vždy jen první
    // nedokončená stage. Gitea ale při startu runu vytvoří "pending" status
    // všem jobům najednou → vše by svítilo jako běžící. Stavy za první
    // aktivní/neúspěšnou stagí proto srážíme na 'pending' (čeká ve frontě).
    let blocked = false;
    for (const s of stages) {
      if (blocked && s.status === 'running') s.status = 'pending';
      if (s.status !== 'success') blocked = true;
    }
    return stages;
  }

  // Gitea commit status kontext má tvar "<workflow> / <job> (<event>)".
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
    return 'running'; // pending = job běží / je ve frontě
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
