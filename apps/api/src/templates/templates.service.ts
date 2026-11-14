import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
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
 *
 * The catalog is read once (at startup, or on first use) and cached: templates
 * ship with the image and change only with a release. A manifest that cannot
 * be read is reported as an error instead of silently vanishing.
 */
@Injectable()
export class TemplatesService implements OnModuleInit {
  private readonly logger = new Logger('TemplatesService');
  private catalog?: { list: TemplateManifest[]; byId: Map<string, TemplateManifest> };

  onModuleInit(): void {
    const { list } = this.load();
    this.logger.log(`Template catalog loaded: ${list.map((template) => template.id).join(', ')}`);
  }

  list(): TemplateManifest[] {
    return [...this.load().list];
  }

  get(id: string): TemplateManifest {
    const found = this.load().byId.get(id);
    if (!found) throw new NotFoundException(`Template '${id}' not found`);
    return found;
  }

  /** Drops the cached catalog; the next read loads it from disk again. */
  reload(): void {
    this.catalog = undefined;
  }

  private load(): { list: TemplateManifest[]; byId: Map<string, TemplateManifest> } {
    if (this.catalog) return this.catalog;
    const dir = config.templatesDir;
    if (!existsSync(dir)) {
      this.logger.error(`Template directory ${dir} does not exist; the catalog is empty`);
      this.catalog = { list: [], byId: new Map() };
      return this.catalog;
    }
    const list = readdirSync(dir)
      .filter((name) => statSync(join(dir, name)).isDirectory())
      .map((name) => this.readManifest(join(dir, name, 'template.json')))
      .filter((m): m is TemplateManifest => m !== null);
    this.catalog = { list, byId: new Map(list.map((template) => [template.id, template])) };
    return this.catalog;
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
    if (!existsSync(path)) {
      this.logger.error(`Template manifest ${path} is missing; the template is not offered`);
      return null;
    }
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf-8')) as TemplateManifest;
      if (!manifest || typeof manifest.id !== 'string' || !TEMPLATE_ID.test(manifest.id)) {
        throw new Error('the manifest has no valid "id"');
      }
      return manifest;
    } catch (error) {
      this.logger.error(
        `Template manifest ${path} is invalid and the template is not offered: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
