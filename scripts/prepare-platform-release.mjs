#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_NAME = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Statements after which the previous API image may no longer work against
// the migrated database, so an image-only rollback is unsafe. DROP INDEX and
// DROP CONSTRAINT only relax the schema and stay compatible.
const DESTRUCTIVE_STATEMENTS = [
  ['DROP', /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|VIEW)\b/i],
  ['RENAME', /\bRENAME\b/i],
  ['ALTER TYPE', /\bALTER\s+TYPE\b/i],
  ['ALTER COLUMN TYPE', /\bALTER\s+COLUMN\s+"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b/i],
  ['SET NOT NULL', /\bSET\s+NOT\s+NULL\b/i],
];
// The newest migration that existed when the policy was introduced; only
// migrations up to it may use the 'historical' exception.
const HISTORICAL_CUTOFF = '20261113120000';

export function destructiveStatements(sql) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  return DESTRUCTIVE_STATEMENTS.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
}

/**
 * Enforces that every destructive migration has an explicit exception and
 * returns the database contract of the given release. A release that ships
 * a destructive migration must not claim image-compatible rollback.
 */
export function migrationPolicy(root, version) {
  const migrationsDirectory = resolve(root, 'apps/api/prisma/migrations');
  const exceptions =
    JSON.parse(readFileSync(resolve(root, 'apps/api/prisma/destructive-migrations.json'), 'utf8'))
      .migrations ?? {};
  const names = readdirSync(migrationsDirectory)
    .filter((name) => existsSync(resolve(migrationsDirectory, name, 'migration.sql')))
    .sort();
  const problems = [];
  const shipped = [];
  for (const [name, exception] of Object.entries(exceptions)) {
    if (!names.includes(name)) problems.push(`${name}: exception names no migration`);
    const release = exception?.release;
    if (release === 'historical') {
      if (name.slice(0, 14) > HISTORICAL_CUTOFF) {
        problems.push(`${name}: only migrations shipped up to 0.2.35 may be 'historical'`);
      }
    } else if (typeof release !== 'string' || !VERSION.test(release)) {
      problems.push(`${name}: exception release must be 'historical' or x.y.z`);
    }
    if (typeof exception?.reason !== 'string' || !exception.reason.trim()) {
      problems.push(`${name}: exception needs a reason`);
    }
  }
  for (const name of names) {
    const found = destructiveStatements(
      readFileSync(resolve(migrationsDirectory, name, 'migration.sql'), 'utf8'),
    );
    if (found.length === 0) continue;
    const exception = exceptions[name];
    if (!exception) {
      problems.push(
        `${name}: destructive migration (${found.join(', ')}) without an exception in apps/api/prisma/destructive-migrations.json`,
      );
    } else if (exception.release === version) {
      shipped.push(name);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Database migration policy violated:\n- ${problems.join('\n- ')}`);
  }
  return {
    destructiveMigrations: shipped,
    database:
      shipped.length > 0
        ? { migrationMode: 'contract', rollback: 'restore-required', backupRequired: true }
        : { migrationMode: 'expand-contract', rollback: 'image-compatible', backupRequired: true },
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function yamlString(value) {
  return JSON.stringify(value);
}

function imageRecord(name, digest) {
  if (!IMAGE_NAME.test(name) || name.includes('@') || name.includes(':')) {
    throw new Error(`image name must not contain a tag or digest: ${name}`);
  }
  if (!DIGEST.test(digest)) throw new Error(`image digest is invalid: ${digest}`);
  return {
    name,
    digest,
    immutableReference: `${name}@${digest}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  };
}

export function preparePlatformRelease(options) {
  const versionFile = JSON.parse(
    readFileSync(resolve(options.root, 'deploy/platform-version.json'), 'utf8'),
  );
  const version = versionFile.version;
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error('deploy/platform-version.json contains an invalid version');
  }
  const expectedTag = `initpad-v${version}`;
  if (options.tag !== expectedTag) {
    throw new Error(`release tag must be ${expectedTag}, received ${options.tag}`);
  }
  if (!COMMIT.test(options.sourceCommit)) throw new Error('source commit must be a full SHA-1');
  if (options.sourceRepository !== 'https://github.com/kudrle01/initpad') {
    throw new Error('source repository must be the official InitPad repository');
  }

  const { database } = migrationPolicy(options.root, version);

  const images = {
    api: imageRecord(options.images.api.name, options.images.api.digest),
    web: imageRecord(options.images.web.name, options.images.web.digest),
    supervisor: imageRecord(options.images.supervisor.name, options.images.supervisor.digest),
  };
  const override = [
    'services:',
    '  api:',
    `    image: ${yamlString(images.api.immutableReference)}`,
    '    environment:',
    `      INITPAD_PLATFORM_VERSION: ${yamlString(version)}`,
    '  web:',
    `    image: ${yamlString(images.web.immutableReference)}`,
    '  supervisor:',
    `    image: ${yamlString(images.supervisor.immutableReference)}`,
    '    environment:',
    `      INITPAD_PLATFORM_VERSION: ${yamlString(version)}`,
    '',
  ].join('\n');
  const overrideBytes = Buffer.from(override);
  const manifest = {
    schemaVersion: 1,
    component: 'initpad-platform',
    version,
    source: {
      repository: options.sourceRepository,
      tag: options.tag,
      commit: options.sourceCommit,
    },
    images,
    compose: {
      file: 'initpad-release.override.yml',
      sha256: sha256(overrideBytes),
    },
    database,
  };

  mkdirSync(options.outputDirectory, { recursive: true });
  writeFileSync(
    resolve(options.outputDirectory, 'initpad-platform-release.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(resolve(options.outputDirectory, 'initpad-release.override.yml'), overrideBytes);
  copyFileSync(
    resolve(options.root, 'deploy/install-release.sh'),
    resolve(options.outputDirectory, 'initpad-install-release.sh'),
  );
  chmodSync(resolve(options.outputDirectory, 'initpad-install-release.sh'), 0o755);

  for (const [component, source] of Object.entries(options.sboms)) {
    const value = JSON.parse(readFileSync(source, 'utf8'));
    writeFileSync(
      resolve(options.outputDirectory, `initpad-${component}-sbom.json`),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  }

  const files = [
    'initpad-api-sbom.json',
    'initpad-install-release.sh',
    'initpad-platform-release.json',
    'initpad-release.override.yml',
    'initpad-supervisor-sbom.json',
    'initpad-web-sbom.json',
  ];
  const sums = files
    .map((file) => {
      const bytes = readFileSync(resolve(options.outputDirectory, file));
      return `${sha256(bytes)}  ${basename(file)}`;
    })
    .join('\n');
  writeFileSync(resolve(options.outputDirectory, 'SHA256SUMS'), `${sums}\n`);
  return { manifest, override };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`invalid argument ${key ?? ''}`);
    values[key.slice(2)] = value;
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  preparePlatformRelease({
    root,
    outputDirectory: resolve(args.output),
    tag: args.tag,
    sourceCommit: args.commit,
    sourceRepository: args.repository,
    images: {
      api: { name: args['api-image'], digest: args['api-digest'] },
      web: { name: args['web-image'], digest: args['web-digest'] },
      supervisor: { name: args['supervisor-image'], digest: args['supervisor-digest'] },
    },
    sboms: {
      api: args['api-sbom'],
      web: args['web-sbom'],
      supervisor: args['supervisor-sbom'],
    },
  });
}
