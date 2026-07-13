import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { TemplateManifest } from '../domain/types';

describe('template delivery contract', () => {
  const templatesRoot = resolve(__dirname, '../../../../templates');
  const manifests = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(readFileSync(resolve(templatesRoot, entry.name, 'template.json'), 'utf8')) as
        TemplateManifest & { buildCommand?: unknown },
    );

  it('deploys every SFTP template from a CI-tested image artifact', () => {
    for (const manifest of manifests.filter((item) => item.compatibleProviders.includes('sftp'))) {
      expect(manifest.buildArtifactPath).toMatch(/^\/[A-Za-z0-9._/-]+$/);
    }
  });

  it('never declares project build commands for the control plane to execute', () => {
    for (const manifest of manifests) expect(manifest.buildCommand).toBeUndefined();
  });
});
