import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { TemplateManifest } from '../domain/types';
import { adaptWorkflowForGitHub } from '../scm/github/github-workflow';

/**
 * Template catalog. A template is a directory with a template.json manifest
 * and the project scaffold under files/. Adding a template means adding a
 * directory — no code changes required (data-driven catalog).
 */
@Injectable()
export class TemplatesService {
  list(): TemplateManifest[] {
    const dir = config.templatesDir;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .map((name) => this.readManifest(join(dir, name, 'template.json')))
      .filter((m): m is TemplateManifest => m !== null);
  }

  get(id: string): TemplateManifest {
    const found = this.list().find((t) => t.id === id);
    if (!found) throw new NotFoundException(`Template '${id}' not found`);
    return found;
  }

  filesDir(id: string): string {
    this.get(id);
    return join(config.templatesDir, id, 'files');
  }

  importWorkflow(id: string, provider: string): string {
    if (!['gitea', 'github'].includes(provider)) {
      throw new BadRequestException(`Unsupported workflow provider '${provider}'`);
    }
    const path = join(this.filesDir(id), '.gitea', 'workflows', 'ci.yml');
    if (!existsSync(path)) {
      throw new NotFoundException(`Template '${id}' has no import workflow`);
    }
    const source = readFileSync(path, 'utf8');
    return provider === 'github' ? adaptWorkflowForGitHub(source, 'ci.yml') : source;
  }

  private readManifest(path: string): TemplateManifest | null {
    try {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, 'utf-8')) as TemplateManifest;
    } catch {
      return null;
    }
  }
}
