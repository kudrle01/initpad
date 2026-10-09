import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const compose = read('deploy/docker-compose.yml');
const daemonEntry = read('deploy/runner/ci-daemon.sh');
const runnerEntry = read('deploy/runner/ci-runner.sh');
const imageCache = read('deploy/runner/image-cache.yml');
const runnerConfig = read('infra/act_runner/config.yaml');

function service(name) {
  const start = compose.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `service ${name} is missing`);
  const rest = compose.slice(start + 1);
  // The block ends at the next line indented like a service key or comment.
  const end = rest.slice(1).search(/\n(?: {2}\S|\S)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

test('runs every CI job on a daemon erased since the previous job (ADR-138)', () => {
  const daemon = service('runner-docker');
  assert.match(daemon, /privileged: true/);
  assert.match(daemon, /init: true/);
  assert.match(daemon, /entrypoint: \['\/bin\/sh', '\/opt\/initpad-runner\/ci-daemon\.sh'\]/);
  assert.match(daemon, /read_only: true/);
  for (const path of ['/tmp', '/run/user/1000', '/home/rootless']) {
    assert.match(daemon, new RegExp(`- ${path}:size=`));
  }
  assert.match(daemon, /- runner-reset:\/run\/initpad-ci-reset:ro/);
  assert.match(daemon, /'--registry-mirror=http:\/\/172\.31\.250\.10:5000'/);
  // The containerd image store exports build cache to the project registry
  // (ADR-139) and reaches the image cache over HTTP only when listed.
  assert.match(daemon, /'--feature=containerd-snapshotter=true'/);
  assert.match(daemon, /'--insecure-registry=172\.31\.250\.10:5000'/);
  assert.doesNotMatch(daemon, /docker\.sock/);

  assert.ok(
    daemonEntry.indexOf('find "$data" -mindepth 1 -delete') <
      daemonEntry.indexOf('dockerd-entrypoint.sh'),
    'the previous state must be erased before the daemon starts',
  );
  assert.match(daemonEntry, /rootlesskit [^\n]*\\\n\s+find "\$data" -mindepth 1 -delete/);
  assert.match(daemonEntry, /refusing to start'\n\s+exit 1/);
  assert.match(daemonEntry, /\[ "\$\(cat "\$request"\)" = "\$current" \]/);
});

test('keeps the runner credential out of the daemon and takes one job at a time', () => {
  const runner = service('act_runner');
  assert.match(runner, /image: gitea\/act_runner:0\.2\.13@sha256:[0-9a-f]{64}/);
  assert.match(
    runner,
    /entrypoint: \['\/sbin\/tini', '--', '\/bin\/bash', '\/opt\/initpad-runner\/ci-runner\.sh'\]/,
  );
  assert.match(runner, /- runner-reset:\/run\/initpad-ci-reset\n/);
  assert.doesNotMatch(runner, /privileged|docker\.sock/);
  assert.doesNotMatch(service('runner-docker'), /runner-data/);

  assert.match(runnerEntry, /export GITEA_RUNNER_ONCE=1/);
  assert.ok(
    runnerEntry.indexOf('request_reset "$used"') < runnerEntry.indexOf('while ((stopping == 0))'),
    'a restarted runner must reset the daemon before its first job',
  );
  assert.ok(
    runnerEntry.indexOf('fresh_daemon_after "$used"') < runnerEntry.indexOf('run.sh &'),
    'a job may start only on a daemon with a new engine ID',
  );

  assert.match(runnerConfig, /^ {2}capacity: 1$/m);
  assert.match(runnerConfig, /^cache:\n {2}enabled: false$/m);
  assert.match(runnerConfig, /^ {2}valid_volumes: \[\]$/m);
  // Gitea 1.22 rejects the image index a provenance attestation would create.
  assert.match(runnerConfig, /--env=BUILDX_NO_DEFAULT_ATTESTATIONS=1 /);
});

test('reads only the engine ID that leads the daemon info response', () => {
  const fn = runnerEntry.match(/daemon_id\(\) \{\n[\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn, 'daemon_id is missing');
  const bin = mkdtempSync(join(tmpdir(), 'initpad-ci-runner-'));
  const answer = join(bin, 'answer.json');
  writeFileSync(join(bin, 'wget'), `#!/bin/sh\ncat "${answer}"\n`);
  chmodSync(join(bin, 'wget'), 0o755);
  const daemonId = (info) => {
    writeFileSync(answer, info);
    return spawnSync(
      'bash',
      ['-c', `set -euo pipefail; daemon=http://runner-docker:2375\n${fn}daemon_id`],
      { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
    );
  };

  const engine = '0f5b6c1e-6a0b-4b9f-9a59-3f1d7e2c4a10';
  const fresh = daemonId(`{"ID":"${engine}","Containers":0,"Swarm":{"NodeID":"x"}}\n`);
  assert.equal(fresh.status, 0);
  assert.equal(fresh.stdout, `${engine}\n`);

  // Swarm state a job created must not pose as a different engine.
  const swarm = daemonId(`{"ID":"${engine}","Swarm":{"Cluster":{"ID":"chosen"}}}\n`);
  assert.equal(swarm.stdout, `${engine}\n`);

  const unexpected = daemonId(`{"Containers":0,"ID":"${engine}"}\n`);
  assert.notEqual(unexpected.status, 0);
  assert.equal(unexpected.stdout, '');
});

test('serves CI images from a cache that jobs cannot write', () => {
  const cache = service('runner-image-cache');
  assert.match(cache, /image: registry:3\.0\.0@sha256:[0-9a-f]{64}/);
  assert.match(cache, /ipv4_address: 172\.31\.250\.10/);
  assert.match(cache, /read_only: true/);
  assert.match(cache, /cap_drop: \[ALL\]/);
  assert.match(cache, /no-new-privileges:true/);
  assert.match(imageCache, /^storage:\n {2}delete:\n {4}enabled: false$/m);
  assert.match(imageCache, /^proxy:\n {2}remoteurl: https:\/\/registry-1\.docker\.io$/m);
  assert.doesNotMatch(imageCache, /username|password/);
});

test('refuses a runner capacity other than one', () => {
  const work = mkdtempSync(join(tmpdir(), 'initpad-runner-config-'));
  mkdirSync(join(work, 'deploy'));
  mkdirSync(join(work, 'infra/act_runner'), { recursive: true });
  copyFileSync(
    resolve(root, 'deploy/render-runner-config.sh'),
    join(work, 'deploy/render-runner-config.sh'),
  );
  copyFileSync(
    resolve(root, 'infra/act_runner/config.yaml'),
    join(work, 'infra/act_runner/config.yaml'),
  );
  const render = (capacity) => {
    writeFileSync(join(work, 'deploy/.env'), `INITPAD_RUNNER_CAPACITY=${capacity}\n`);
    return spawnSync('bash', [join(work, 'deploy/render-runner-config.sh')], { encoding: 'utf8' });
  };

  const refused = render(2);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /INITPAD_RUNNER_CAPACITY must be 1: .*ADR-138/);

  const accepted = render(1);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(
    readFileSync(join(work, 'deploy/.runtime/act-runner-config.yaml'), 'utf8'),
    /^ {2}capacity: 1$/m,
  );
});
