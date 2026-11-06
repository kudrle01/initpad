import { Injectable } from '@nestjs/common';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import * as Handlebars from 'handlebars';
import { config } from '../config';
import { TemplatesService } from '../templates/templates.service';

export interface GenerateResult {
  repoPath: string;
  files: string[];
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Resolves a generated checkout below the workspace directory. Callers pass
 * validated owner and project names; this keeps a future caller from escaping
 * the workspace with an absolute path or a `..` segment.
 */
export function workspacePath(subpath: string): string {
  const segments = subpath.split('/');
  if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error(`Invalid workspace path '${subpath}'`);
  }
  const root = resolve(config.workspaceDir);
  const path = resolve(root, ...segments);
  if (!path.startsWith(root + sep)) throw new Error(`Invalid workspace path '${subpath}'`);
  return path;
}

/**
 * Project scaffolding. Copies the template's files tree; files with the .hbs
 * extension are rendered through Handlebars and the extension is stripped.
 */
@Injectable()
export class GeneratorService {
  constructor(private readonly templates: TemplatesService) {}

  /**
   * @param projectName Template variable available to Handlebars files.
   * @param destSubpath Path inside the workspace (defaults to projectName).
   *   Namespaced by owner so two users can have same-named projects without
   *   directory collisions.
   */
  generate(templateId: string, projectName: string, destSubpath?: string): GenerateResult {
    const srcDir = this.templates.filesDir(templateId);
    const destDir = workspacePath(destSubpath ?? projectName);
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
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const srcPath = join(current, entry.name);
      const rel = relative(srcRoot, srcPath);
      if (entry.isDirectory()) {
        this.copyTree(srcPath, destRoot, srcRoot, vars, files);
        continue;
      }
      // Templates are plain files; a symlink could point outside the template.
      if (!entry.isFile()) continue;
      const isTemplate = srcPath.endsWith('.hbs');
      const outRel = isTemplate ? rel.replace(/\.hbs$/, '') : rel;
      const outPath = join(destRoot, outRel);
      mkdirSync(dirname(outPath), { recursive: true });

      const raw = readFileSync(srcPath, 'utf-8');
      const content = isTemplate ? Handlebars.compile(raw)(vars) : raw;
      writeFileSync(outPath, content);
      files.push(outRel);
    }
  }
}
