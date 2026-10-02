/* eslint-disable no-console */
const { publicOrigin } = require('./saas-load-probe');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function parseCommand(argv) {
  const [command, marker, ...rest] = argv;
  if (!['prepare', 'recover', 'cleanup'].includes(command || '') || rest.length > 0) {
    throw new Error('Expected prepare, recover or cleanup plus one UUID v4 marker');
  }
  if (!marker || !UUID_V4.test(marker)) throw new Error('Acceptance marker must be a UUID v4');
  return { command, marker };
}

function assertQueuedAfterOutage(row) {
  if (!row) throw new Error('The password-reset outbox row was not created');
  if (row.status === 'sent') throw new Error('SMTP is still reachable; enable the outage first');
  if (row.status === 'failed') throw new Error('The test message exhausted every retry');
  return row.status === 'pending' && row.attempts >= 1 && row.payloadEncrypted.length > 0;
}

function assertDeliveredAfterRecovery(row) {
  return Boolean(
    row &&
    row.status === 'sent' &&
    row.attempts >= 2 &&
    row.payloadEncrypted === '' &&
    row.lastError === null,
  );
}

function fixtureUsername(marker) {
  return `smtp-outage-${marker.replaceAll('-', '')}`;
}

function recipient() {
  const value = (process.env.INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT || '').trim();
  if (!value || value.length > 254 || /[\r\n\0]/.test(value) || !value.includes('@')) {
    throw new Error('INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT must be an unused staging inbox');
  }
  return value;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cleanup(prisma, marker) {
  const username = fixtureUsername(marker);
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) return;
  await prisma.$transaction([
    prisma.emailOutbox.deleteMany({ where: { userId: user.id } }),
    prisma.user.deleteMany({ where: { id: user.id } }),
  ]);
}

async function prepare(prisma, marker) {
  const email = recipient();
  const origin = publicOrigin();
  const username = fixtureUsername(marker);
  await prisma.user.create({
    data: {
      username,
      email,
      accessToken: `acceptance-${marker}`,
      // SaaS disables password sign-in. A non-null marker makes this account
      // eligible for the password-reset path without storing a usable secret.
      passwordHash: 'acceptance-not-a-password-hash',
      active: true,
    },
  });

  const response = await fetch(`${origin}/api/auth/password/request-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: email }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  await response.arrayBuffer();
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Password-reset request returned HTTP ${response.status}`);
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { username }, select: { id: true } });
  const deadline = Date.now() + 75_000;
  let row;
  while (Date.now() < deadline) {
    row = await prisma.emailOutbox.findFirst({
      where: { userId: user.id, kind: 'password_reset' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, attempts: true, payloadEncrypted: true },
    });
    if (row?.status === 'sent' || row?.status === 'failed') break;
    if (row && assertQueuedAfterOutage(row)) break;
    await sleep(1_000);
  }
  if (!assertQueuedAfterOutage(row)) {
    throw new Error('The SMTP worker did not preserve a retryable message during the outage');
  }

  const readiness = await fetch(`${origin}/api/health/ready`, {
    signal: AbortSignal.timeout(15_000),
  });
  await readiness.arrayBuffer();
  if (readiness.status !== 200) throw new Error('API readiness failed during the SMTP outage');
  console.log('SMTP_OUTAGE_PREPARED api_ready=true retry_persisted=true');
}

async function recover(prisma, marker) {
  const username = fixtureUsername(marker);
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new Error('SMTP outage fixture is missing');
  const existing = await prisma.emailOutbox.findFirst({
    where: { userId: user.id, kind: 'password_reset' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });
  if (!existing) throw new Error('SMTP outage outbox row is missing');
  if (existing.status === 'failed')
    throw new Error('The message exhausted its retries before recovery');
  if (existing.status === 'pending') {
    await prisma.emailOutbox.update({
      where: { id: existing.id },
      data: { availableAt: new Date() },
    });
  }

  const deadline = Date.now() + 120_000;
  let row;
  while (Date.now() < deadline) {
    row = await prisma.emailOutbox.findUnique({
      where: { id: existing.id },
      select: {
        status: true,
        attempts: true,
        payloadEncrypted: true,
        lastError: true,
      },
    });
    if (row?.status === 'sent' || row?.status === 'failed') break;
    await sleep(2_000);
  }
  if (!assertDeliveredAfterRecovery(row)) {
    throw new Error('The queued message was not safely delivered after SMTP recovery');
  }
  await cleanup(prisma, marker);
  console.log('SMTP_OUTAGE_RECOVERED delivered=true payload_erased=true retry_observed=true');
}

async function main() {
  if (process.env.INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES !== '1') {
    throw new Error(
      'Refusing to create SMTP outage fixtures. Set INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 explicitly.',
    );
  }
  const { command, marker } = parseCommand(process.argv.slice(2));
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (command === 'prepare') await prepare(prisma, marker);
    else if (command === 'recover') await recover(prisma, marker);
    else {
      await cleanup(prisma, marker);
      console.log('SMTP outage fixture removed.');
    }
  } catch (error) {
    if (command === 'prepare') await cleanup(prisma, marker).catch(() => undefined);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'SMTP outage acceptance failed');
    process.exit(1);
  });
}

module.exports = {
  assertDeliveredAfterRecovery,
  assertQueuedAfterOutage,
  fixtureUsername,
  parseCommand,
};
