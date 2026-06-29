import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EnvName,
  Environment,
  Project,
  ProviderKind,
  TemplateManifest,
} from '../domain/types';
import { CreateProjectDto } from './dto/create-project.dto';
import { TemplatesService } from '../templates/templates.service';
import { GeneratorService } from '../generator/generator.service';
import { DeploymentService } from '../deployment/deployment.service';

const ENV_ORDER: EnvName[] = ['dev', 'test', 'prod'];

// Orchestruje generování ze šablony, založení prostředí a nasazení.
// In-memory store pro prototyp, později PostgreSQL.
@Injectable()
export class ProjectsService {
  private readonly projects = new Map<string, Project>();

  constructor(
    private readonly templates: TemplatesService,
    private readonly generator: GeneratorService,
    private readonly deployment: DeploymentService,
  ) {}

  list(): Project[] {
    return [...this.projects.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw new NotFoundException(`Projekt '${id}' nenalezen`);
    return p;
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    if ([...this.projects.values()].some((p) => p.name === dto.name)) {
      throw new BadRequestException(`Projekt '${dto.name}' už existuje`);
    }
    const template = this.templates.get(dto.templateId);
    const { repoPath } = this.generator.generate(template.id, dto.name);

    const project: Project = {
      id: randomUUID(),
      name: dto.name,
      templateId: template.id,
      repoPath,
      createdAt: new Date().toISOString(),
      lastCommit: 'init: scaffold ze šablony',
      environments: ENV_ORDER.map((name) => this.makeEnv(name, template)),
    };

    await this.deployTo(project, 'dev', '0.1.0');
    this.projects.set(project.id, project);
    return project;
  }

  async promote(id: string, target: EnvName): Promise<Project> {
    const project = this.get(id);
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
    await this.deployTo(project, target, source.version);
    return project;
  }

  private async deployTo(project: Project, name: EnvName, version: string) {
    const env = project.environments.find((e) => e.name === name)!;
    const template = this.templates.get(project.templateId);
    env.status = 'deploying';
    const result = await this.deployment.deploy(env.provider, {
      projectName: project.name,
      version,
      env: name,
      repoPath: project.repoPath,
      port: template.port,
    });
    env.status = result.status;
    env.version = version;
    env.url = result.url;
  }

  private makeEnv(name: EnvName, template: TemplateManifest): Environment {
    return {
      name,
      provider: this.defaultProvider(name, template),
      status: 'empty',
      version: null,
      url: null,
    };
  }

  // dev/test běží na Dockeru, prod se volí podle typu artefaktu šablony.
  private defaultProvider(name: EnvName, template: TemplateManifest): ProviderKind {
    if (name === 'prod') {
      return template.artifact === 'static' ? 'sftp' : 'ssh';
    }
    return 'docker';
  }
}
