import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Commit,
  DeployStatus,
  EnvName,
  PipelineStage,
  Project,
  ProviderKind,
  TemplateManifest,
} from '../domain/types';
import { CreateProjectDto } from './dto/create-project.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { GeneratorService } from '../generator/generator.service';
import { DeploymentService } from '../deployment/deployment.service';
import { GiteaService } from '../scm/gitea.service';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

type ProjectRow = Prisma.ProjectGetPayload<{ include: { environments: true } }>;

// Orchestruje generování ze šablony, založení prostředí a nasazení.
// Stav je perzistentní v PostgreSQL (Prisma).
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    private readonly generator: GeneratorService,
    private readonly deployment: DeploymentService,
    private readonly gitea: GiteaService,
  ) {}

  async list(): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
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
    if (!row) throw new NotFoundException(`Projekt '${id}' nenalezen`);
    return this.toDomain(row);
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    if (await this.prisma.project.findUnique({ where: { name: dto.name } })) {
      throw new BadRequestException(`Projekt '${dto.name}' už existuje`);
    }
    const template = this.templates.get(dto.templateId);
    const { repoPath } = this.generator.generate(template.id, dto.name);
    const repo = await this.gitea.provision(dto.name, repoPath);

    const created = await this.prisma.project.create({
      data: {
        name: dto.name,
        templateId: template.id,
        repoPath,
        repoUrl: repo?.repoUrl ?? null,
        lastCommit: 'init: scaffold ze šablony',
        environments: {
          create: ENV_ORDER.map((name, order) => ({
            name,
            order,
            provider: this.defaultProvider(name, template),
            status: 'empty',
          })),
        },
      },
    });

    await this.deployEnv(created.id, 'dev', '0.1.0');
    return this.get(created.id);
  }

  async promote(id: string, target: EnvName): Promise<Project> {
    const project = await this.get(id);
    const idx = ENV_ORDER.indexOf(target);
    if (idx <= 0) {
      throw new BadRequestException(`Do '${target}' nelze povyšovat`);
    }
    const source = project.environments.find((e) => e.name === ENV_ORDER[idx - 1]);
    if (!source || source.status !== 'running' || !source.version) {
      throw new BadRequestException(
        `Zdrojové prostředí '${ENV_ORDER[idx - 1]}' nemá co povýšit`,
      );
    }
    await this.deployEnv(id, target, source.version);
    return this.get(id);
  }

  async getCommits(id: string): Promise<Commit[]> {
    const project = await this.get(id);
    const template = this.templates.get(project.templateId);
    const stages = this.pipelineStages(template);

    const fromGitea = await this.gitea.listCommits(project.name);
    if (fromGitea && fromGitea.length > 0) {
      return fromGitea.map((c) => ({ ...c, pipeline: stages }));
    }
    return [
      {
        sha: 'initial',
        message: project.lastCommit,
        author: 'DevPlatform',
        date: project.createdAt,
        pipeline: stages,
      },
    ];
  }

  private async deployEnv(projectId: string, envName: EnvName, version: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const template = this.templates.get(project.templateId);
    const env = await this.prisma.environment.findUniqueOrThrow({
      where: { projectId_name: { projectId, name: envName } },
    });

    await this.prisma.environment.update({
      where: { projectId_name: { projectId, name: envName } },
      data: { status: 'deploying' },
    });
    const result = await this.deployment.deploy(env.provider as ProviderKind, {
      projectName: project.name,
      version,
      env: envName,
      repoPath: project.repoPath,
      port: template.port,
    });
    await this.prisma.environment.update({
      where: { projectId_name: { projectId, name: envName } },
      data: { status: result.status, version, url: result.url },
    });
  }

  // dev/test běží na Dockeru, prod se volí podle typu artefaktu šablony.
  private defaultProvider(name: EnvName, template: TemplateManifest): ProviderKind {
    if (name === 'prod') {
      return template.artifact === 'static' ? 'sftp' : 'ssh';
    }
    return 'docker';
  }

  // CI stagey podle typu artefaktu; status 'pending' dokud není zapojené CI (bod 3).
  private pipelineStages(template: TemplateManifest): PipelineStage[] {
    const names =
      template.artifact === 'static'
        ? ['build', 'test', 'deploy']
        : ['build', 'test', 'docker build', 'deploy'];
    return names.map((name) => ({ name, status: 'pending' as const }));
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
        })),
    };
  }
}
