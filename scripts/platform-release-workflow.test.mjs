import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const read = (path) => parse(readFileSync(path, 'utf8'));
const platform = read('.github/workflows/release-platform.yml');
const agent = read('.github/workflows/release-agent.yml');
const releaseGate = read('.github/actions/release-gate/action.yml');
const scanAction = read('.github/actions/scan-release-images/action.yml');

const nativeBuilder = /^docker\/github-builder\/\.github\/workflows\/build\.yml@[0-9a-f]{40}$/;
const allSteps = (workflow) => Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);

function assertNativeBuild(job) {
  assert.match(job.uses, nativeBuilder);
  assert.equal(job.with.platforms, 'linux/amd64,linux/arm64');
  assert.match(job.with.runner, /^linux\/arm64=ubuntu-24\.04-arm$/m);
  assert.equal(job.with.push, true);
  assert.equal(job.with.sbom, true);
}

test('builds every platform component on native amd64 and arm64 runners', () => {
  for (const name of ['build_api', 'build_web', 'build_supervisor']) {
    assertNativeBuild(platform.jobs[name]);
  }
  assert.ok(!allSteps(platform).some((step) => step.uses?.startsWith('docker/setup-qemu-action')));
});

test('builds the Agent with the same native builder instead of QEMU', () => {
  assertNativeBuild(agent.jobs.build);
  assert.equal(agent.jobs.build.uses, platform.jobs.build_api.uses);
  assert.equal(agent.jobs.build.with.file, 'apps/agent/Dockerfile');
  assert.ok(!allSteps(agent).some((step) => step.uses?.startsWith('docker/setup-qemu-action')));
  assert.ok(!allSteps(agent).some((step) => step.uses?.startsWith('docker/build-push-action')));
});

test('pins every external action and reusable workflow to a full commit SHA', () => {
  for (const workflow of [platform, agent]) {
    const references = [
      ...Object.values(workflow.jobs).map((job) => job.uses),
      ...allSteps(workflow).map((step) => step.uses),
    ].filter((uses) => uses && !uses.startsWith('./'));
    assert.ok(references.length > 0);
    for (const uses of references) assert.match(uses, /^[^@\s]+@[0-9a-f]{40}$/, uses);
  }
});

test('publishes only after all native manifests provide immutable digests', () => {
  const { release } = platform.jobs;
  assert.deepEqual(release.needs, ['verify', 'build_api', 'build_web', 'build_supervisor', 'scan']);
  assert.equal(release.env.API_DIGEST, '${{ needs.build_api.outputs.digest }}');
  assert.equal(release.env.WEB_DIGEST, '${{ needs.build_web.outputs.digest }}');
  assert.equal(release.env.SUPERVISOR_DIGEST, '${{ needs.build_supervisor.outputs.digest }}');
  assert.ok(release.steps.some((step) => step.run?.includes('cosign sign --yes "${reference}"')));
  assert.ok(
    release.steps.some((step) => step.with?.['subject-digest'] === '${{ env.API_DIGEST }}'),
  );

  assert.deepEqual(agent.jobs.release.needs, ['verify', 'build', 'scan']);
  assert.equal(agent.jobs.release.env.IMAGE_DIGEST, '${{ needs.build.outputs.digest }}');
});

test('scans every pushed digest with Trivy before signing', () => {
  const platformScan = platform.jobs.scan;
  assert.deepEqual(platformScan.needs, ['verify', 'build_api', 'build_web', 'build_supervisor']);
  const references = platformScan.steps.find(
    (step) => step.uses === './.github/actions/scan-release-images',
  ).with.references;
  for (const job of ['build_api', 'build_web', 'build_supervisor']) {
    assert.match(references, new RegExp(`@\\$\\{\\{ needs\\.${job}\\.outputs\\.digest \\}\\}`));
  }
  const agentScan = agent.jobs.scan.steps.find(
    (step) => step.uses === './.github/actions/scan-release-images',
  );
  assert.equal(
    agentScan.with.references,
    '${{ needs.verify.outputs.image-name }}@${{ needs.build.outputs.digest }}',
  );

  const scan = scanAction.runs.steps[0];
  assert.match(scan.env.TRIVY_IMAGE, /@sha256:[0-9a-f]{64}$/);
  assert.match(scan.run, /--severity HIGH,CRITICAL --ignore-unfixed/);
  assert.match(scan.run, /--exit-code 1/);
  assert.match(scan.run, /Refusing to scan a mutable reference/);
  assert.match(scanAction.inputs.platforms.default, /linux\/amd64 linux\/arm64/);
});

test('enforces the repository gate before any release build', () => {
  for (const workflow of [platform, agent]) {
    const { verify } = workflow.jobs;
    assert.equal(verify.permissions.checks, 'read');
    assert.ok(verify.steps.some((step) => step.uses === './.github/actions/release-gate'));
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name === 'verify') continue;
      const needs = [job.needs].flat();
      assert.ok(needs.includes('verify'), name);
    }
  }
  const steps = releaseGate.runs.steps;
  const lookup = steps.find((step) => step.id === 'ci');
  assert.match(lookup.run, /check_name=Build%2C%20test%20and%20audit/);
  assert.match(lookup.run, /\.app\.slug == "github-actions"/);
  assert.match(lookup.run, /\.conclusion == "success"/);
  const full = steps.find((step) => step.run === 'npm run check:release');
  assert.equal(full.if, "steps.ci.outputs.passed != 'true'");
  const audit = steps.find((step) => step.run === 'npm run audit:dependencies');
  assert.equal(audit.if, "steps.ci.outputs.passed == 'true'");
});
