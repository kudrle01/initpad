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

  it('tests, builds and publishes each push in one job with a registry layer cache', () => {
    for (const manifest of manifests) {
      const workflow = readFileSync(
        resolve(templatesRoot, manifest.id, 'files/.gitea/workflows/ci.yml'),
        'utf8',
      );
      // Every CI job starts on an erased daemon (ADR-138); more jobs would
      // load the job image and rebuild again (ADR-139).
      expect(workflow.match(/runs-on:/g)).toHaveLength(1);
      expect(workflow).not.toMatch(/^\s+needs:/m);
      expect(workflow).toMatch(/^\s+- name: test\n\s+run: \|\n\s+docker build --target \w+ /m);
      expect(workflow).toContain(
        '--cache-to "type=registry,ref=$CACHE,mode=max,image-manifest=true,oci-mediatypes=true,ignore-error=true"',
      );
      // A plain image manifest, as before, instead of an index with provenance.
      expect(workflow.match(/docker build /g)?.length).toBe(
        workflow.match(/docker build [^\n]*--provenance=false/g)?.length,
      );
      expect(workflow).toContain('echo "CACHE=${IMAGE%:*}:buildcache" >> "$GITHUB_ENV"');
      expect(workflow).toMatch(/- name: notify platform\n\s+if: always\(\)/);
      expect(workflow).toContain('"ciStatus":"${{ job.status }}"');
    }
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
