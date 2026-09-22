import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/release-platform.yml', 'utf8');
const nativeBuilder =
  'docker/github-builder/.github/workflows/build.yml@58cb9f5b71b1836d6f690c1e95effdeb9b98cb8a';

test('builds every platform component on native amd64 and arm64 runners', () => {
  assert.equal(workflow.split(`uses: ${nativeBuilder}`).length - 1, 3);
  assert.equal(workflow.split('platforms: linux/amd64,linux/arm64').length - 1, 3);
  assert.equal(workflow.split('linux/arm64=ubuntu-24.04-arm').length - 1, 3);
  assert.doesNotMatch(workflow, /setup-qemu-action/);
});

test('publishes only after all native manifests provide immutable digests', () => {
  assert.match(workflow, /needs: \[verify, build_api, build_web, build_supervisor\]/);
  assert.match(workflow, /API_DIGEST: \$\{\{ needs\.build_api\.outputs\.digest \}\}/);
  assert.match(workflow, /WEB_DIGEST: \$\{\{ needs\.build_web\.outputs\.digest \}\}/);
  assert.match(workflow, /SUPERVISOR_DIGEST: \$\{\{ needs\.build_supervisor\.outputs\.digest \}\}/);
  assert.match(workflow, /cosign sign --yes "\$\{reference\}"/);
  assert.match(workflow, /subject-digest: \$\{\{ env\.API_DIGEST \}\}/);
});
