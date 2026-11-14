import { Logger } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config';
import { TemplatesService } from './templates.service';

// Regression suite for audit P3: get() read and parsed every manifest from
// disk on each call, and a broken manifest disappeared without a trace.
describe('TemplatesService catalog', () => {
  const original = config.templatesDir;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'initpad-templates-'));
    (config as { templatesDir: string }).templatesDir = dir;
    for (const id of ['node', 'python']) {
      mkdirSync(join(dir, id));
      writeFileSync(join(dir, id, 'template.json'), JSON.stringify({ id, name: id }));
    }
  });

  afterEach(() => {
    (config as { templatesDir: string }).templatesDir = original;
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('reads the manifests once and serves later lookups from memory', () => {
    const service = new TemplatesService();
    service.onModuleInit();
    // Later lookups no longer touch the disk.
    rmSync(join(dir, 'node'), { recursive: true });
    rmSync(join(dir, 'python'), { recursive: true });

    expect(service.get('node').id).toBe('node');
    expect(service.get('python').id).toBe('python');
    expect(service.list().map((template) => template.id)).toEqual(['node', 'python']);
  });

  it('logs an invalid manifest as an error and keeps the healthy templates', () => {
    mkdirSync(join(dir, 'broken'));
    writeFileSync(join(dir, 'broken', 'template.json'), '{ not json');
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const service = new TemplatesService();
    service.onModuleInit();

    expect(service.list().map((template) => template.id)).toEqual(['node', 'python']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('broken/template.json is invalid'));
  });

  it('loads the catalog again only after reload()', () => {
    const service = new TemplatesService();
    expect(() => service.get('go')).toThrow("Template 'go' not found");

    mkdirSync(join(dir, 'go'));
    writeFileSync(join(dir, 'go', 'template.json'), JSON.stringify({ id: 'go' }));
    expect(() => service.get('go')).toThrow("Template 'go' not found");

    service.reload();
    expect(service.get('go').id).toBe('go');
  });
});
