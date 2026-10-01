/* eslint-disable no-console */
const { createHash, randomBytes } = require('node:crypto');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { PrismaClient } = require('@prisma/client');

const MARKER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCEPTANCE_SCHEMA = 'initpad_acceptance';
const ACCEPTANCE_TABLE = `${ACCEPTANCE_SCHEMA}.recovery_markers`;

function validateMarker(value, label) {
  if (!MARKER_PATTERN.test(value || '')) {
    throw new Error(`${label} must be a UUID v4`);
  }
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function s3Configuration() {
  return {
    bucket: requiredEnvironment('INITPAD_ARTIFACT_S3_BUCKET'),
    client: new S3Client({
      endpoint: process.env.INITPAD_ARTIFACT_S3_ENDPOINT || undefined,
      region: process.env.INITPAD_ARTIFACT_S3_REGION || 'us-east-1',
      forcePathStyle: (process.env.INITPAD_ARTIFACT_S3_FORCE_PATH_STYLE || 'true') !== 'false',
      credentials: {
        accessKeyId: requiredEnvironment('INITPAD_ARTIFACT_S3_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnvironment('INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY'),
      },
    }),
  };
}

function markerKey(marker) {
  return `acceptance/recovery/${validateMarker(marker, 'marker')}.json`;
}

function isNotFound(error) {
  return (
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.Code === 'NoSuchKey' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

async function bodyBytes(body) {
  if (!body) throw new Error('artifact read returned no body');
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function databaseState(prisma) {
  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(`
      SELECT
        count(*) FILTER (
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        )::int AS "applied",
        count(*) FILTER (
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        )::int AS "failed"
      FROM "_prisma_migrations"
    `);
  } catch {
    throw new Error('database migration state could not be read');
  }
  const state = rows[0];
  if (!state || state.applied < 1 || state.failed !== 0) {
    throw new Error('database migrations are incomplete or failed');
  }
  return state;
}

async function artifactRoundTrip(client, bucket) {
  const key = `acceptance/probe/${randomBytes(16).toString('hex')}`;
  const payload = randomBytes(32);
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: payload,
        ContentLength: payload.length,
        ContentType: 'application/octet-stream',
      }),
    );
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const received = await bodyBytes(response.Body);
    if (
      createHash('sha256').update(received).digest('hex') !==
      createHash('sha256').update(payload).digest('hex')
    ) {
      throw new Error('artifact round-trip changed the payload');
    }
  } catch (error) {
    if (error?.message === 'artifact round-trip changed the payload') throw error;
    throw new Error('artifact store round-trip failed');
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
  }
}

async function artifactStoreReady(client, bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    throw new Error('artifact store health check failed');
  }
}

async function ensureMarkerTable(prisma) {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${ACCEPTANCE_SCHEMA}`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${ACCEPTANCE_TABLE} (
      marker uuid PRIMARY KEY,
      phase text NOT NULL CHECK (phase IN ('baseline', 'post-backup')),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function createRecoveryMarker(prisma, client, bucket, marker, phase) {
  validateMarker(marker, 'marker');
  if (!['baseline', 'post-backup'].includes(phase)) throw new Error('marker phase is invalid');
  const key = markerKey(marker);
  const body = Buffer.from(JSON.stringify({ marker, phase }), 'utf8');
  let databaseMarkerCreated = false;
  try {
    await ensureMarkerTable(prisma);
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${ACCEPTANCE_TABLE} (marker, phase) VALUES ($1::uuid, $2)`,
      marker,
      phase,
    );
    databaseMarkerCreated = true;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: 'application/json',
      }),
    );
  } catch {
    if (databaseMarkerCreated) {
      await prisma
        .$executeRawUnsafe(`DELETE FROM ${ACCEPTANCE_TABLE} WHERE marker = $1::uuid`, marker)
        .catch(() => undefined);
    }
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    throw new Error(`${phase} recovery marker could not be created`);
  }
}

async function databaseMarkerExists(prisma, marker) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT EXISTS(SELECT 1 FROM ${ACCEPTANCE_TABLE} WHERE marker = $1::uuid) AS "exists"`,
      marker,
    );
    return rows[0]?.exists === true;
  } catch {
    throw new Error('recovery marker table was not restored');
  }
}

async function objectMarkerExists(client, bucket, marker) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: markerKey(marker) }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw new Error('artifact recovery marker could not be read');
  }
}

function evaluateRecoveryState(state) {
  return (
    state.baselineDatabase === true &&
    state.baselineObject === true &&
    state.postBackupDatabase === false &&
    state.postBackupObject === false
  );
}

async function verifyRecovery(prisma, client, bucket, baseline, postBackup) {
  const state = {
    baselineDatabase: await databaseMarkerExists(prisma, baseline),
    baselineObject: await objectMarkerExists(client, bucket, baseline),
    postBackupDatabase: await databaseMarkerExists(prisma, postBackup),
    postBackupObject: await objectMarkerExists(client, bucket, postBackup),
  };
  if (!evaluateRecoveryState(state)) {
    throw new Error('database and artifact store were not restored to the same checkpoint');
  }

  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM ${ACCEPTANCE_TABLE} WHERE marker IN ($1::uuid, $2::uuid)`,
      baseline,
      postBackup,
    );
    await Promise.all([
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: markerKey(baseline) })),
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: markerKey(postBackup) })),
    ]);
    const remaining = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS "count" FROM ${ACCEPTANCE_TABLE}`,
    );
    if (remaining[0]?.count === 0) {
      await prisma.$executeRawUnsafe(`DROP SCHEMA ${ACCEPTANCE_SCHEMA} CASCADE`);
    }
  } catch {
    throw new Error('recovery passed but acceptance marker cleanup failed');
  }
}

function parseCommand(args) {
  const [command, ...values] = args;
  if (command === 'probe' && values.length === 0) return { command, values };
  if (['baseline', 'post-backup'].includes(command) && values.length === 1) {
    validateMarker(values[0], 'marker');
    return { command, values };
  }
  if (command === 'verify-restore' && values.length === 2) {
    validateMarker(values[0], 'baseline marker');
    validateMarker(values[1], 'post-backup marker');
    if (values[0] === values[1]) throw new Error('recovery markers must differ');
    return { command, values };
  }
  throw new Error('expected probe, baseline UUID, post-backup UUID, or verify-restore UUID UUID');
}

async function main(args = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCommand(args);
  } catch (error) {
    console.error(`saas-dependency-probe: ${error.message}`);
    return 1;
  }

  let prisma;
  let client;
  try {
    requiredEnvironment('DATABASE_URL');
    prisma = new PrismaClient();
    const s3 = s3Configuration();
    client = s3.client;
    const migrations = await databaseState(prisma);
    if (parsed.command === 'probe') {
      await artifactRoundTrip(client, s3.bucket);
    } else if (parsed.command === 'baseline' || parsed.command === 'post-backup') {
      await artifactStoreReady(client, s3.bucket);
      await createRecoveryMarker(prisma, client, s3.bucket, parsed.values[0], parsed.command);
    } else {
      await artifactStoreReady(client, s3.bucket);
      await verifyRecovery(prisma, client, s3.bucket, parsed.values[0], parsed.values[1]);
    }
    console.log(
      JSON.stringify({
        status: 'ok',
        command: parsed.command,
        migrationsApplied: migrations.applied,
        artifactStore: parsed.command === 'probe' ? 'round-trip-ok' : 'recovery-marker-ok',
      }),
    );
    return 0;
  } catch (error) {
    console.error(`saas-dependency-probe: ${error.message || 'dependency verification failed'}`);
    return 1;
  } finally {
    client?.destroy();
    await prisma?.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  artifactRoundTrip,
  createRecoveryMarker,
  evaluateRecoveryState,
  isNotFound,
  markerKey,
  parseCommand,
  verifyRecovery,
};
