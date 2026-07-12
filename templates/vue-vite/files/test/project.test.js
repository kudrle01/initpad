import test from 'node:test';
import assert from 'node:assert/strict';
import { projectName } from '../src/project.js';

test('generated project exposes a non-empty name', () => {
  assert.match(projectName, /^[a-z0-9][a-z0-9-]+$/);
});
