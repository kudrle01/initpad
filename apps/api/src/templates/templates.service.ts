import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { TemplateManifest } from '../domain/types';

// Šablona = složka s manifestem template.json a scaffoldem ve files/.
// Přidání šablony je jen přidání složky, bez zásahu do kódu (data-driven).
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
    if (!found) throw new NotFoundException(`Šablona '${id}' nenalezena`);
    return found;
  }

  filesDir(id: string): string {
    this.get(id);
    return join(config.templatesDir, id, 'files');
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
