import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { TemplateManifest } from '../domain/types';
import { TemplatesService } from './templates.service';

describe('template delivery contract', () => {
  const templatesRoot = resolve(__dirname, '../../../../templates');
  const manifests = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        JSON.parse(
          readFileSync(resolve(templatesRoot, entry.name, 'template.json'), 'utf8'),
        ) as TemplateManifest & { buildCommand?: unknown },
    );

  it('deploys every SFTP template from a CI-tested image artifact', () => {
    for (const manifest of manifests.filter((item) => item.compatibleProviders.includes('sftp'))) {
      expect(manifest.buildArtifactPath).toMatch(/^\/[A-Za-z0-9._/-]+$/);
    }
  });

  it('never declares project build commands for the control plane to execute', () => {
    for (const manifest of manifests) expect(manifest.buildCommand).toBeUndefined();
  });

  it('offers an import-ready workflow for every template and SCM provider', () => {
    const templates = new TemplatesService();
    for (const manifest of manifests) {
      const gitea = templates.importWorkflow(manifest.id, 'gitea');
      expect(gitea).toContain('INITPAD_PLATFORM_URL');
      expect(gitea).toContain('INITPAD_DEPLOY_TOKEN');

      const github = templates.importWorkflow(manifest.id, 'github');
      expect(github).toContain('artifact-id');
      expect(github).toContain('artifact-digest');
      expect(github).toContain('archive: false');
      expect(github).not.toContain('INITPAD_REGISTRY_PASSWORD');
    }
  });
});
