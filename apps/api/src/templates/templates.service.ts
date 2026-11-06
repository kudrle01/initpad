import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { TemplateManifest } from '../domain/types';
import { adaptWorkflowForGitHub } from '../scm/github/github-workflow';

const TEMPLATE_ID = /^[a-z0-9-]{1,64}$/;

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
    if (!TEMPLATE_ID.test(id)) throw new NotFoundException(`Template '${id}' not found`);
    // The path is built from the id read from the installed manifest, so a
    // request value only selects a template and never becomes a path segment.
    const { id: installedId } = this.get(id);
    if (!TEMPLATE_ID.test(installedId)) throw new NotFoundException(`Template '${id}' not found`);
    return join(config.templatesDir, installedId, 'files');
  }

  importWorkflow(id: string, provider: string): string {
    if (!['gitea', 'github'].includes(provider)) {
      throw new BadRequestException(`Unsupported workflow provider '${provider}'`);
    }
    const path = join(this.filesDir(id), '.gitea', 'workflows', 'ci.yml');
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new NotFoundException(`Template '${id}' has no import workflow`);
    }
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
