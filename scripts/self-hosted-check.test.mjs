import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = readFileSync(new URL('../deploy/self-hosted-check.sh', import.meta.url), 'utf8');
const example = readFileSync(new URL('../deploy/.env.example', import.meta.url), 'utf8');

function secretsPattern() {
  const match = script.match(
    /! grep -Eq '([^']+)' \.env \|\| fail "deploy\/\.env still contains ungenerated secrets\."/,
  );
  assert.ok(match, 'the running check looks for ungenerated secrets with an anchored pattern');
  return match[1];
}

function flags(content) {
  const dir = mkdtempSync(join(tmpdir(), 'initpad-check-'));
  try {
    writeFileSync(join(dir, '.env'), content);
    execFileSync('grep', ['-Eq', secretsPattern(), '.env'], { cwd: dir });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a generated .env keeps the explanatory comment without failing the running check', () => {
  const generated = example.replace(/^([A-Z0-9_]+)=__GENERATE__$/gm, '$1=generated-value');
  assert.match(generated, /__GENERATE__/, 'the copied comment still mentions the marker');
  assert.equal(flags(generated), false);
});

test('an ungenerated secret still fails the running check', () => {
  assert.equal(flags(example), true);
  assert.equal(flags('INITPAD_JWT_SECRET=__GENERATE__\n'), true);
});
