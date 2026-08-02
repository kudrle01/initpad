import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { adaptWorkflowForGitHub, UPLOAD_ARTIFACT_ACTION } from './github-workflow';

describe('GitHub artifact workflow adaptation', () => {
  const templates = join(__dirname, '../../../../../templates');

  it('adapts every shipped Gitea workflow without mutating the source template', () => {
    for (const template of readdirSync(templates)) {
      const path = join(templates, template, 'files', '.gitea', 'workflows', 'ci.yml');
      let source: string;
      try {
        source = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const github = adaptWorkflowForGitHub(source, `${template}/ci.yml`);
      expect(github).toContain(`uses: ${UPLOAD_ARTIFACT_ACTION} # v7.0.1`);
      expect(github).toContain('docker save "$IMAGE" -o initpad-image.tar');
      expect(github).toContain('${{ github.sha }}-${{ github.run_id }}');
      expect(github).toContain('archive: false');
      expect(github).toContain('retention-days: 1');
      expect(github).toContain('artifactId');
      expect(github).toContain('artifactDigest');
      expect(github).toContain('if: always()');
      expect(github).toContain('"ciStatus":"${{ needs.docker.result }}"');
      expect(github).not.toContain('docker push "$IMAGE"');
      expect(github).not.toContain('INITPAD_REGISTRY_PASSWORD');
      expect(source).toContain('docker push "$IMAGE"');
    }
  });

  it('fails closed when a custom workflow has no recognizable build boundary', () => {
    expect(() => adaptWorkflowForGitHub('name: custom\non: [push]\n', 'custom.yml'))
      .toThrow('docker job');
  });
});
