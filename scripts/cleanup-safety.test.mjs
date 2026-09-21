import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = readFileSync(resolve(root, 'deploy/cleanup.sh'), 'utf8');

test('cleanup protects active source images before pruning', () => {
  const protect = script.indexOf('for service in api web supervisor');
  const prune = script.indexOf('docker image prune -f');
  assert.ok(protect >= 0 && prune > protect);
  assert.match(script, /docker image inspect "\$image_id"/);
  assert.match(script, /docker image tag "\$image_id" "\$configured"/);
  assert.match(script, /Rebuild the exact installed version before cleanup/);
  assert.doesNotMatch(script, /docker (?:system|image) prune -a|docker volume (?:prune|rm)/);
});
