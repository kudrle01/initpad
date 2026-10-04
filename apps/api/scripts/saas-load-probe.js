/* eslint-disable no-console */
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function boundedInteger(name, fallback, minimum, maximum, environment = process.env) {
  const raw = environment[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function boundedNumber(name, fallback, minimum, maximum, environment = process.env) {
  const raw = environment[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function percentile(samples, quantile) {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1);
  return ordered[Math.max(0, index)];
}

function evaluateLoadResult(result, thresholds) {
  const failures = [];
  if (result.requests < thresholds.minimumRequests) {
    failures.push(`only ${result.requests} requests completed`);
  }
  if (result.errorRate > thresholds.maximumErrorRate) {
    failures.push(`error rate ${(result.errorRate * 100).toFixed(2)}% exceeded the limit`);
  }
  if (result.p95Ms > thresholds.maximumP95Ms) {
    failures.push(`p95 ${result.p95Ms.toFixed(1)} ms exceeded the limit`);
  }
  if (result.instances < thresholds.minimumInstances) {
    failures.push(`only ${result.instances} API instance(s) answered through the edge`);
  }
  return failures;
}

function publicOrigin(environment = process.env) {
  const raw = (
    environment.INITPAD_LOAD_ACCEPTANCE_URL ||
    environment.INITPAD_PLATFORM_PUBLIC_URL ||
    ''
  ).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INITPAD_LOAD_ACCEPTANCE_URL must be a clean public HTTPS origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('INITPAD_LOAD_ACCEPTANCE_URL must be a clean public HTTPS origin');
  }
  return url.origin;
}

async function main() {
  if (process.env.INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES !== '1') {
    throw new Error(
      'Refusing to create load fixtures. Set INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 explicitly.',
    );
  }
  const jwtSecret = (process.env.INITPAD_JWT_SECRET || '').trim();
  if (!jwtSecret) throw new Error('INITPAD_JWT_SECRET is required');

  const durationSeconds = boundedInteger('INITPAD_LOAD_ACCEPTANCE_DURATION_SECONDS', 30, 10, 300);
  const concurrency = boundedInteger('INITPAD_LOAD_ACCEPTANCE_CONCURRENCY', 16, 2, 200);
  const requestTimeoutMs = boundedInteger(
    'INITPAD_LOAD_ACCEPTANCE_REQUEST_TIMEOUT_MS',
    10_000,
    1_000,
    30_000,
  );
  const thresholds = {
    minimumRequests: boundedInteger('INITPAD_LOAD_ACCEPTANCE_MIN_REQUESTS', 300, 20, 1_000_000),
    minimumInstances: boundedInteger('INITPAD_LOAD_ACCEPTANCE_MIN_INSTANCES', 2, 2, 20),
    maximumP95Ms: boundedNumber('INITPAD_LOAD_ACCEPTANCE_MAX_P95_MS', 1_000, 50, 30_000),
    maximumErrorRate: boundedNumber('INITPAD_LOAD_ACCEPTANCE_MAX_ERROR_RATE', 0.01, 0, 0.2),
  };
  const origin = publicOrigin();

  const { JwtService } = require('@nestjs/jwt');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { user: randomUUID(), workspace: randomUUID() };
  const username = `load-acceptance-${suffix}`;
  const workspaceSlug = `load-acceptance-${suffix}`;
  const jwt = new JwtService({ secret: jwtSecret, signOptions: { expiresIn: '10m' } });
  const token = jwt.sign({ sub: ids.user, ver: 0 });

  try {
    const [activeDeployments, activeProvisioning] = await Promise.all([
      prisma.deploymentOperation.count({ where: { status: 'running', finishedAt: null } }),
      prisma.provisioningOperation.count({
        where: {
          status: { in: ['running', 'retrying', 'cleaning'] },
          finishedAt: null,
        },
      }),
    ]);
    if (activeDeployments > 0 || activeProvisioning > 0) {
      throw new Error(
        'Load acceptance requires a quiescent staging control plane with no active project operations',
      );
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.user.create({
        data: {
          id: ids.user,
          username,
          accessToken: `acceptance-${suffix}`,
          active: true,
        },
      });
      await transaction.workspace.create({
        data: {
          id: ids.workspace,
          slug: workspaceSlug,
          name: 'Load acceptance fixture',
          type: 'team',
        },
      });
      await transaction.workspaceMember.create({
        data: { workspaceId: ids.workspace, userId: ids.user, role: 'owner' },
      });
    });

    const endpoints = [
      '/api/auth/me',
      '/api/workspaces',
      '/api/projects',
      `/api/workspaces/${ids.workspace}/capacity`,
      `/api/workspaces/${ids.workspace}/portfolio`,
    ];
    const latencies = [];
    const instances = new Set();
    const failureSamples = [];
    let requests = 0;
    let errors = 0;
    let sequence = 0;
    const startedAt = performance.now();
    const deadline = startedAt + durationSeconds * 1_000;

    // The staging orchestrator waits for this bounded marker before injecting
    // a replica restart. It contains no identity, URL or fixture data.
    console.log('LOAD_STARTED');

    async function worker() {
      while (performance.now() < deadline) {
        const path = endpoints[sequence++ % endpoints.length];
        const requestStartedAt = performance.now();
        try {
          const response = await fetch(`${origin}${path}`, {
            headers: {
              cookie: `initpad_token=${token}`,
              'x-workspace-id': ids.workspace,
              'cache-control': 'no-store',
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          await response.arrayBuffer();
          const instance = response.headers.get('x-initpad-instance');
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          if (!instance || !UUID_V4.test(instance)) {
            throw new Error('missing opaque API instance header');
          }
          instances.add(instance);
        } catch (error) {
          errors += 1;
          if (failureSamples.length < 5) {
            failureSamples.push(
              error instanceof Error ? error.message.slice(0, 120) : 'request failed',
            );
          }
        } finally {
          requests += 1;
          latencies.push(performance.now() - requestStartedAt);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1_000);
    const result = {
      requests,
      errors,
      errorRate: errors / Math.max(1, requests),
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99),
      requestsPerSecond: requests / elapsedSeconds,
      instances: instances.size,
    };
    const failures = evaluateLoadResult(result, thresholds);
    console.log(
      [
        'LOAD_RESULT',
        `requests=${result.requests}`,
        `errors=${result.errors}`,
        `error_rate=${result.errorRate.toFixed(4)}`,
        `p50_ms=${result.p50Ms.toFixed(1)}`,
        `p95_ms=${result.p95Ms.toFixed(1)}`,
        `p99_ms=${result.p99Ms.toFixed(1)}`,
        `rps=${result.requestsPerSecond.toFixed(1)}`,
        `instances=${result.instances}`,
      ].join(' '),
    );
    if (failures.length > 0) {
      if (failureSamples.length > 0)
        console.error(`Bounded failures: ${failureSamples.join('; ')}`);
      throw new Error(`Load acceptance failed: ${failures.join('; ')}`);
    }
  } finally {
    await prisma.workspace.deleteMany({ where: { id: ids.workspace } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Load acceptance failed');
    process.exit(1);
  });
}

module.exports = {
  boundedInteger,
  boundedNumber,
  evaluateLoadResult,
  percentile,
  publicOrigin,
};
