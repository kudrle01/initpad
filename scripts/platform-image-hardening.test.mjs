import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const runtimeStage = (dockerfile) => dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
const service = (compose, name) => {
  const start = compose.indexOf(`\n  ${name}:\n`);
  const next = compose.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return compose.slice(start, next === -1 ? undefined : start + 1 + next);
};

test('web image runs nginx unprivileged and logs paths without query strings (ADR-144)', () => {
  const dockerfile = read('apps/web/Dockerfile');
  const main = read('apps/web/nginx-main.conf');
  const runtime = runtimeStage(dockerfile);

  assert.match(runtime, /^USER nginx$/m);
  assert.match(runtime, /^RUN apk upgrade --no-cache$/m);
  assert.match(runtime, /COPY apps\/web\/nginx-main\.conf \/etc\/nginx\/nginx\.conf/);
  assert.doesNotMatch(main, /^\s*user\s/m);
  assert.match(main, /^pid \/tmp\/nginx\.pid;$/m);
  for (const kind of ['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) {
    assert.match(main, new RegExp(`^\\s+${kind}_temp_path /tmp/`, 'm'), kind);
  }
  const format = main.slice(main.indexOf('log_format'), main.indexOf('access_log'));
  assert.match(format, /\$request_path/);
  assert.doesNotMatch(format, /\$request[^_]|\$request_uri|\$args|\$query_string|\$http_referer/);

  for (const path of ['deploy/docker-compose.yml', 'deploy/saas.compose.yml']) {
    const web = service(read(path), 'web');
    assert.match(web, /^ {4}cap_drop: \[ALL\]$/m, path);
    assert.match(web, /^ {4}security_opt: \[no-new-privileges:true\]$/m, path);
    assert.match(web, /^ {6}- \/tmp:size=\d+m$/m, path);
    assert.doesNotMatch(web, /cap_add|\/var\/cache\/nginx|\/var\/run/, path);
  }
});

test('Node runtime images ship neither package managers nor compiled tests (ADR-144)', () => {
  for (const app of ['api', 'agent', 'supervisor']) {
    const dockerfile = read(`apps/${app}/Dockerfile`);
    const runtime = runtimeStage(dockerfile);
    assert.match(runtime, /RUN apk upgrade --no-cache/, app);
    assert.match(runtime, /rm -rf \/usr\/local\/lib\/node_modules \/opt\/yarn-\*/, app);
    for (const tool of ['npm', 'npx', 'corepack', 'yarn', 'yarnpkg']) {
      assert.match(runtime, new RegExp(`/usr/local/bin/${tool}\\b`), `${app}: ${tool}`);
    }
    assert.doesNotMatch(runtime, /\bnpm (ci|install)\b/, app);
  }
  for (const app of ['agent', 'supervisor']) {
    assert.match(
      read(`apps/${app}/Dockerfile`),
      new RegExp(`find apps/${app}/dist -name '\\*\\.test\\.js\\*' -delete`),
      app,
    );
  }
  const migrate = read('apps/api/scripts/migrate.js');
  assert.match(migrate, /spawnSync\(process\.execPath, \[prismaCli/);
  assert.doesNotMatch(migrate, /'npx'/);
});

test('CI fails on fixed HIGH or CRITICAL findings with expiring exceptions only (ADR-144)', () => {
  const workflow = read('.github/workflows/container-images.yml');
  assert.match(workflow, /schedule:\n {4}- cron: '[^']+'/);
  assert.match(workflow, /TRIVY_IMAGE: aquasec\/trivy:[0-9.]+@sha256:[0-9a-f]{64}/);
  assert.match(workflow, /--severity HIGH,CRITICAL --ignore-unfixed/);
  assert.match(workflow, /--ignorefile \/src\/\.trivyignore\.yaml --exit-code 1/);
  for (const image of ['api', 'web', 'agent', 'supervisor']) {
    assert.match(workflow, new RegExp(`for image in [a-z ]*\\b${image}\\b`), image);
  }
  assert.match(workflow, /trivy fs --include-dev-deps \/src\/templates/);

  const policy = read('.trivyignore.yaml');
  const entries = policy.split(/\n {2}- id: /).slice(1);
  for (const entry of entries) {
    const id = entry.slice(0, entry.indexOf('\n'));
    assert.match(id, /^(CVE|GHSA)-[\w-]+$/);
    assert.match(entry, /\n {4}paths:\n {6}- \S/, id);
    assert.match(entry, /\n {4}statement: \S/, id);
    assert.match(entry, /\n {4}expired_at: \d{4}-\d{2}-\d{2}\n?/, id);
  }
});
