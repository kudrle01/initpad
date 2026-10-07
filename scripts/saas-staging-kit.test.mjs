import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const example = readFileSync('deploy/.env.saas.example', 'utf8');
const agent = readFileSync('deploy/staging/infisical-agent.example.yaml', 'utf8');
const secretsCompose = readFileSync('deploy/staging/secrets.compose.yml', 'utf8');
const edgeCompose = readFileSync('deploy/staging/edge.compose.yml', 'utf8');
const runbook = readFileSync('deploy/SAAS_STAGING.md', 'utf8');

const SECRETS_DIRECTORY = '/secure/runtime/secrets/';
// Files consumed only by the edge services, not by the SaaS profile itself.
const EDGE_FILES = ['otel_collector.env', 'tunnel_token'];

function projectedFiles() {
  return [...agent.matchAll(/^ {4}destination-path: (\S+)$/gm)].map((match) => match[1]);
}

test('projects exactly the secret files required by the SaaS profile', () => {
  const required = [...example.matchAll(/^INITPAD_[A-Z0-9_]+_FILE=(\S+)$/gm)].map(
    (match) => match[1],
  );
  assert.equal(required.length, 11);
  assert.ok(required.every((path) => path.startsWith(SECRETS_DIRECTORY)));

  const expected = [...required, ...EDGE_FILES.map((name) => `${SECRETS_DIRECTORY}${name}`)];
  assert.deepEqual(projectedFiles().sort(), expected.sort());
});

test('renders one named secret per file from a replaceable project id', () => {
  const templates = [...agent.matchAll(/getSecretByName "([^"]+)" "([^"]+)" "([^"]+)" "([^"]+)"/g)];
  assert.equal(templates.length, 14);
  for (const [, project, environment, path] of templates) {
    assert.equal(project, 'INFISICAL_PROJECT_ID');
    assert.equal(environment, 'staging');
    assert.equal(path, '/');
  }
  const names = templates.map((match) => match[4]);
  assert.equal(new Set(names).size, names.length);
  assert.doesNotMatch(agent, /listSecrets/);
  // The machine identity is read from root-only files, never embedded.
  assert.match(agent, /client-id: \/secure\/runtime\/infisical\/client-id/);
  assert.match(agent, /client-secret: \/secure\/runtime\/infisical\/client-secret/);
});

test('documents every Infisical secret name and projected file', () => {
  for (const [, , , , name] of agent.matchAll(
    /getSecretByName "([^"]+)" "([^"]+)" "([^"]+)" "([^"]+)"/g,
  )) {
    assert.match(runbook, new RegExp(`\`${name}\``), `${name} is missing from the runbook`);
  }
  for (const path of projectedFiles()) {
    const file = path.slice(SECRETS_DIRECTORY.length);
    assert.match(runbook, new RegExp(`\`${file.replace('.', '\\.')}\``), `${file} is undocumented`);
  }
});

test('keeps the staging services hardened and off the Docker socket', () => {
  for (const [name, compose, services] of [
    ['secrets', secretsCompose, 1],
    ['edge', edgeCompose, 2],
  ]) {
    assert.doesNotMatch(compose, /docker\.sock/, name);
    assert.doesNotMatch(compose, /^\s*ports:/m, `${name} must not publish a port`);
    assert.doesNotMatch(compose, /privileged/, name);
    assert.equal(compose.match(/cap_drop: \[ALL\]/g)?.length, services, name);
    assert.equal(compose.match(/no-new-privileges:true/g)?.length, services, name);
    assert.equal(compose.match(/read_only: true/g)?.length, services, name);
    const images = [...compose.matchAll(/^\s*image: (\S+)$/gm)].map((match) => match[1]);
    assert.equal(images.length, services, name);
    for (const image of images) assert.match(image, /@sha256:[a-f0-9]{64}$/);
  }
});

test('passes the tunnel token as a file and joins the SaaS control network', () => {
  assert.match(edgeCompose, /--token-file', '\/run\/secrets\/tunnel_token'/);
  assert.doesNotMatch(edgeCompose, /TUNNEL_TOKEN|--token'/);
  assert.match(edgeCompose, /file: \/secure\/runtime\/secrets\/tunnel_token/);
  assert.match(edgeCompose, /network_mode: host/);
  // The API resolves the collector by this service name on the shared network.
  assert.match(example, /^OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/otel-collector:4318$/m);
  assert.match(edgeCompose, /^ {2}otel-collector:$/m);
  assert.match(edgeCompose, /external: true\n\s+name: initpad-saas_control/);
  assert.match(edgeCompose, /\.\.\/observability\/otel-collector\.example\.yaml:/);
  assert.match(edgeCompose, /- \/secure\/runtime\/secrets\/otel_collector\.env/);
});
