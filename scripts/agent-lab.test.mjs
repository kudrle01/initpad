import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, 'deploy', path), 'utf8');
const compose = parse(read('agent-lab.compose.yml'));

// Resolves `${NAME:-default}` the way Compose does when NAME is unset.
const withDefaults = (value) => String(value).replace(/\$\{[A-Z_]+:-([^}]*)\}/g, '$1');

test('lab Agents publish direct-port workloads only in the forwarded range', () => {
  const bridge = compose.services['agent-lab-ports'];
  const [published] = bridge.ports.map(withDefaults);
  const forwarded = published.split(':').at(-1);
  assert.equal(forwarded, '42000-42031');
  const agent = compose.services['agent-lab'];
  assert.equal(withDefaults(agent.environment.INITPAD_AGENT_DIRECT_PORT_RANGE), forwarded);
  // The extra identities extend the primary service and inherit the range.
  for (const name of ['agent-lab-secondary', 'agent-lab-tertiary']) {
    assert.equal(compose.services[name].extends.service, 'agent-lab');
    assert.equal(compose.services[name].environment, undefined);
  }
});

test('lab usage does not recommend a loopback public URL that InitPad refuses', () => {
  const usage = read('agent-lab.sh');
  assert.doesNotMatch(usage, /public URL to http:\/\/127\./);
  assert.match(usage, /INITPAD_AGENT_LAB_BIND_ADDRESS=<address>/);
});
