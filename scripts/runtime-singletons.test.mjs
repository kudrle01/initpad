import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// These packages compare classes or metadata by identity across module
// boundaries. A second copy makes `instanceof HttpException` fail in
// @nestjs/core (every 4xx becomes a 500) or detaches DTO metadata from
// ValidationPipe, so the lockfile must resolve each to exactly one install.
const SINGLETONS = [
  '@nestjs/common',
  '@nestjs/core',
  'class-validator',
  'class-transformer',
  'reflect-metadata',
  'rxjs',
];

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

test('Nest runtime singletons resolve to a single production copy', () => {
  for (const name of SINGLETONS) {
    const copies = Object.entries(lock.packages)
      // Dev-only tooling (Nest CLI schematics) may bundle its own copies.
      .filter(([path, entry]) => path.endsWith(`node_modules/${name}`) && !entry.dev)
      .map(([path, entry]) => `${path}@${entry.version}`);
    assert.ok(copies.length <= 1, `${name} is installed more than once: ${copies.join(', ')}`);
  }
});
