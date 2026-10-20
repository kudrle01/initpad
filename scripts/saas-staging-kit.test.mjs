import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const example = readFileSync('deploy/.env.saas.example', 'utf8');
const agent = readFileSync('deploy/staging/infisical-agent.example.yaml', 'utf8');
const secretsCompose = readFileSync('deploy/staging/secrets.compose.yml', 'utf8');
const edgeCompose = readFileSync('deploy/staging/edge.compose.yml', 'utf8');
const runbook = readFileSync('deploy/SAAS_STAGING.md', 'utf8');
const collector = readFileSync('deploy/staging/otel-collector.yaml', 'utf8');
const alertRules = readFileSync('deploy/staging/alert-rules.yaml', 'utf8');
const alertTests = readFileSync('deploy/staging/alert-rules.test.yaml', 'utf8');
const observability = readFileSync('docs/OBSERVABILITY.md', 'utf8');
const egress = readFileSync('deploy/staging/egress-firewall.sh', 'utf8');

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
  assert.equal(required.length, 9);
  assert.ok(required.every((path) => path.startsWith(SECRETS_DIRECTORY)));

  const expected = [...required, ...EDGE_FILES.map((name) => `${SECRETS_DIRECTORY}${name}`)];
  assert.deepEqual(projectedFiles().sort(), expected.sort());
});

test('renders one named secret per file from a replaceable project id', () => {
  const templates = [...agent.matchAll(/getSecretByName "([^"]+)" "([^"]+)" "([^"]+)" "([^"]+)"/g)];
  assert.equal(templates.length, 12);
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
  assert.match(edgeCompose, /- \.\/otel-collector\.yaml:\/etc\/otelcol-contrib\/config\.yaml:ro/);
  assert.match(edgeCompose, /- \/secure\/runtime\/secrets\/otel_collector\.env/);
});

test('keeps the Grafana dashboard on the metrics and labels the API emits', () => {
  const dashboard = JSON.parse(readFileSync('deploy/staging/grafana-dashboard.json', 'utf8'));
  const source = readFileSync('apps/api/src/common/request-context.ts', 'utf8');
  const prometheusName = (name) => name.replaceAll('.', '_');
  // OTLP dots become underscores; the backend may append a type or unit suffix.
  const metrics = [...source.matchAll(/meter\.create(?:Counter|Histogram)\('([^']+)'/g)].map(
    (match) => prometheusName(match[1]),
  );
  assert.deepEqual(metrics, ['initpad_http_requests', 'initpad_http_request_duration']);
  const labels = [...source.matchAll(/^ {4}'([a-z_.]+)':/gm)].map((match) =>
    prometheusName(match[1]),
  );
  assert.equal(labels.length, 3);

  assert.equal(dashboard.panels.length, 8);
  assert.equal(new Set(dashboard.panels.map((panel) => panel.id)).size, 8);
  const [datasource] = dashboard.templating.list;
  assert.equal(datasource.type, 'datasource');
  assert.equal(datasource.query, 'prometheus');
  for (const panel of dashboard.panels) {
    // No panel is pinned to one Grafana stack.
    assert.equal(panel.datasource.uid, '${datasource}', panel.title);
    for (const target of panel.targets) {
      assert.equal(target.datasource.uid, '${datasource}', panel.title);
      const used = target.expr.match(/initpad_[a-z_]+|http_[a-z_]+/g) ?? [];
      assert.ok(used.length > 0, panel.title);
      for (const name of used) {
        assert.ok(
          metrics.some((metric) => name === metric) || labels.includes(name),
          `${panel.title}: ${name} is not emitted by the API`,
        );
      }
    }
  }
});

test('collects only the SaaS project logs read-only and without the Docker socket', () => {
  assert.match(edgeCompose, /- \/var\/lib\/docker\/containers:\/var\/lib\/docker\/containers:ro/);
  assert.match(edgeCompose, /INITPAD_PUBLIC_URL: \$\{INITPAD_PUBLIC_URL:\?/);
  assert.match(collector, /attributes\.attrs\["com\.docker\.compose\.project"\] != "initpad-saas"/);
  // The daemon labels in the runbook are what the collector filters on.
  assert.match(runbook, /"labels": "com\.docker\.compose\.project,com\.docker\.compose\.service"/);
  assert.match(
    runbook,
    /--env-file \/secure\/runtime\/initpad-saas\.env -f staging\/edge\.compose\.yml up -d/,
  );
});

test('alerts exactly as documented, on signals the API and collector emit', () => {
  const documented = [...observability.matchAll(/^\| `(InitPad[A-Za-z]+)`/gm)].map((m) => m[1]);
  const defined = [...alertRules.matchAll(/^ {6}- alert: (\S+)$/gm)].map((m) => m[1]);
  assert.equal(documented.length, 6);
  assert.deepEqual([...new Set(defined)].sort(), [...documented].sort());
  for (const name of documented) {
    assert.match(alertTests, new RegExp(`alertname: ${name}$`, 'm'), `${name} has no rule test`);
    assert.match(runbook, new RegExp(`^\\| \`${name}\` \\|`, 'm'), `${name} has no runbook row`);
  }
  assert.equal(
    alertRules.match(/runbook: deploy\/SAAS_STAGING\.md#incident-runbook/g)?.length,
    defined.length,
  );
  assert.match(runbook, /^## Incident runbook$/m);

  // Every counted event is one the API logs, and every alerted event is counted.
  const sources = [
    'apps/api/src/mail/mail-delivery.service.ts',
    'apps/api/src/projects/projects-lifecycle.service.ts',
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const counted = [...collector.matchAll(/attributes\["event"\] == "([^"]+)"/g)].map((m) => m[1]);
  const alerted = [...alertRules.matchAll(/event="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(alerted)].sort(), [...counted].sort());
  for (const event of counted)
    assert.ok(sources.includes(`'${event}'`), `${event} is never logged`);

  const metrics = new Set(
    [...alertRules.matchAll(/(initpad_[a-z_]+|httpcheck_[a-z_]+)/g)].map((m) => m[1]),
  );
  assert.deepEqual([...metrics].sort(), [
    'httpcheck_status',
    'initpad_http_request_duration',
    'initpad_http_requests',
    'initpad_http_status_class',
    'initpad_log_events',
  ]);
  assert.match(collector, /initpad\.log\.events:/);
  assert.match(
    collector,
    /http_check\/readiness:[\s\S]*\$\{env:INITPAD_PUBLIC_URL\}\/api\/health\/ready/,
  );
});

test('keeps the staging egress default-deny and refuses internal ranges', () => {
  assert.ok(statSync('deploy/staging/egress-firewall.sh').mode & 0o111);
  assert.ok(statSync('deploy/staging/edge-check.sh').mode & 0o111);
  assert.match(egress, /^set -euo pipefail$/m);
  for (const range of [
    '10.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.168.0.0/16',
    'fc00::/7',
  ]) {
    assert.ok(egress.includes(range), `${range} is not refused`);
  }
  // Each chain ends in an explicit drop, so an unknown port never passes.
  assert.equal(egress.match(/"\$tool" -A "\$chain" -j DROP/g)?.length, 1);
  assert.match(egress, /finish_chain "\$tool" "\$CONTAINERS"/);
  assert.match(egress, /finish_chain "\$tool" "\$HOST"/);
  const containerPorts = egress.match(/CONTAINER_TCP_PORTS:-([0-9,]+)/)[1].split(',');
  assert.deepEqual(containerPorts, ['443', '587', '5432', '6543']);
});
