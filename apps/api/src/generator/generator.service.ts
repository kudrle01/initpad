import { Injectable } from '@nestjs/common';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import * as Handlebars from 'handlebars';
import { config } from '../config';
import { TemplatesService } from '../templates/templates.service';

export interface GenerateResult {
  repoPath: string;
  files: string[];
}

// Zkopíruje scaffold šablony; soubory .hbs projde Handlebars a příponu odstraní.
@Injectable()
export class GeneratorService {
  constructor(private readonly templates: TemplatesService) {}

  // projectName = proměnná do šablony (Handlebars). destSubpath = cesta ve
  // workspace (default = projectName); namespacuje se vlastníkem, aby dva
  // uživatelé mohli mít projekt stejného jména bez kolize složek.
  generate(templateId: string, projectName: string, destSubpath?: string): GenerateResult {
    const srcDir = this.templates.filesDir(templateId);
    const destDir = join(config.workspaceDir, destSubpath ?? projectName);
    const vars = {
      projectName,
      year: new Date().getFullYear(),
    };

    const files: string[] = [];
    this.copyTree(srcDir, destDir, srcDir, vars, files);
    return { repoPath: destDir, files };
  }

  private copyTree(
    current: string,
    destRoot: string,
    srcRoot: string,
    vars: Record<string, unknown>,
    files: string[],
  ): void {
    for (const entry of readdirSync(current)) {
      const srcPath = join(current, entry);
      const rel = relative(srcRoot, srcPath);
      if (statSync(srcPath).isDirectory()) {
        this.copyTree(srcPath, destRoot, srcRoot, vars, files);
        continue;
      }
      const isTemplate = srcPath.endsWith('.hbs');
      const outRel = isTemplate ? rel.replace(/\.hbs$/, '') : rel;
      const outPath = join(destRoot, outRel);
      mkdirSync(join(outPath, '..'), { recursive: true });

      const raw = readFileSync(srcPath, 'utf-8');
      const content = isTemplate ? Handlebars.compile(raw)(vars) : raw;
      writeFileSync(outPath, content);
      files.push(outRel);
    }
  }
}
