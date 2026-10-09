/* eslint-disable no-console */
const { randomUUID } = require('node:crypto');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AGENT_OFFLINE_AFTER_MS = 90_000;

function parseCommand(argv) {
  const [command, marker, operationId, ...rest] = argv;
  if (!['before', 'after', 'cleanup'].includes(command || '') || rest.length > 0) {
    throw new Error('Expected before, after or cleanup plus bounded UUID arguments');
  }
  if (!UUID_V4.test(marker || '')) throw new Error('Acceptance marker must be a UUID v4');
  if (command === 'after' && !UUID_V4.test(operationId || '')) {
    throw new Error('Deployment operation must be a UUID v4');
  }
  if (command !== 'after' && operationId !== undefined) {
    throw new Error(`${command} does not accept a deployment operation`);
  }
  return { command, marker, operationId };
}

function boundedInteger(name, fallback, minimum, maximum, environment = process.env) {
  const raw = environment[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function projectIdentity(environment = process.env) {
  const projectId = (environment.INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID || '').trim();
  const environmentName = (environment.INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT || 'dev').trim();
  if (!UUID_V4.test(projectId)) {
    throw new Error('INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID must be a UUID v4');
  }
  if (!['dev', 'test'].includes(environmentName)) {
    throw new Error('INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT must be dev or test');
  }
  return { projectId, environmentName };
}

function publicOrigin(environment = process.env) {
  const raw = (
    environment.INITPAD_MUTATION_ACCEPTANCE_URL ||
    environment.INITPAD_PLATFORM_PUBLIC_URL ||
    ''
  ).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INITPAD_MUTATION_ACCEPTANCE_URL must be a clean public HTTPS origin');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('INITPAD_MUTATION_ACCEPTANCE_URL must be a clean public HTTPS origin');
  }
  return url.origin;
}

function fixtureUsername(marker) {
  return `agent-failover-${marker.replaceAll('-', '')}`;
}

function assertRecoveredState(state) {
  const failures = [];
  if (!state.scopeMatches) failures.push('deployment operation is outside the acceptance scope');
  if (state.operationStatus !== 'succeeded' || !state.operationFinished) {
    failures.push('deployment operation is not terminal succeeded');
  }
  if (state.environmentStatus !== 'running' || state.activeOperationId !== null) {
    failures.push('environment did not publish one unlocked running state');
  }
  if (state.deploymentRequired || !state.versionMatches || !state.artifactMatches) {
    failures.push('published workload identity does not match the requested artifact');
  }
  if (state.duplicateOperations !== 0) failures.push('request produced duplicate operations');
  if (!state.auditSucceeded) failures.push('terminal deployment audit event is missing');
  if (state.jobCount !== state.expectedJobCount) failures.push('Agent job chain has wrong length');
  if (state.deployJobs !== 1 || state.routeJobs !== state.expectedJobCount - 1) {
    failures.push('Agent job chain has an unexpected shape');
  }
  if (!state.jobsTerminal || !state.jobStepsUnique || !state.jobLeasesCleared) {
    failures.push('Agent job chain is not uniquely terminal and lease-free');
  }
  return failures;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fixtureUser(prisma, marker) {
  return prisma.user.findUnique({
    where: { username: fixtureUsername(marker) },
    select: { id: true },
  });
}

async function cleanup(prisma, marker) {
  await prisma.user.deleteMany({ where: { username: fixtureUsername(marker) } });
}

async function loadEnvironment(prisma, projectId, environmentName) {
  return prisma.environment.findUnique({
    where: { projectId_name: { projectId, name: environmentName } },
    include: {
      project: { select: { workspaceId: true, scmProvider: true } },
      target: { include: { agent: true } },
      allocation: true,
      buildArtifact: true,
    },
  });
}

async function assertBeforePreconditions(prisma, projectId, environmentName) {
  const environment = await loadEnvironment(prisma, projectId, environmentName);
  if (!environment || environment.project.scmProvider !== 'github') {
    throw new Error('The acceptance project must be an existing GitHub SaaS project');
  }
  if (
    environment.status !== 'running' ||
    environment.activeOperationId ||
    !environment.version ||
    environment.deploymentRequired
  ) {
    throw new Error('The acceptance environment must be idle, running and fully deployed');
  }
  if (
    !environment.buildArtifact ||
    environment.buildArtifact.status !== 'available' ||
    environment.buildArtifact.storageKind !== 'object-store' ||
    !environment.buildArtifact.storageRef
  ) {
    throw new Error('The acceptance environment requires one available durable build artifact');
  }
  const target = environment.target;
  if (
    !target ||
    target.kind !== 'docker' ||
    target.scope !== 'user' ||
    target.managementState !== 'active' ||
    !environment.allocation ||
    environment.allocation.status !== 'active'
  ) {
    throw new Error('The acceptance environment must use an active workspace Agent allocation');
  }
  if (!target.agent?.credentialHash || target.agent.disabledAt) {
    throw new Error('The acceptance Agent must be enrolled and enabled');
  }
  if (
    !target.agent.lastSeenAt ||
    Date.now() - target.agent.lastSeenAt.getTime() <= AGENT_OFFLINE_AFTER_MS
  ) {
    throw new Error('Stop the Agent and wait until InitPad reports it offline before this drill');
  }
  const activeJobs = await prisma.agentJob.count({
    where: { targetId: target.id, status: { in: ['blocked', 'queued', 'leased'] } },
  });
  if (activeJobs !== 0) {
    throw new Error('The acceptance Agent target already has an active job');
  }
  return environment;
}

async function waitForQueuedHandoff(prisma, environmentId, deadline) {
  while (Date.now() < deadline) {
    const environment = await prisma.environment.findUnique({
      where: { id: environmentId },
      select: {
        activeOperationId: true,
        target: { select: { agent: { select: { lastSeenAt: true } } } },
      },
    });
    const operation = environment?.activeOperationId
      ? await prisma.deploymentOperation.findUnique({
          where: { id: environment.activeOperationId },
          include: { agentJobs: { orderBy: { operationStep: 'asc' } } },
        })
      : null;
    if (operation?.finishedAt || (operation && operation.status !== 'running')) {
      throw new Error('Deployment became terminal before the durable Agent handoff');
    }
    const job = operation?.agentJobs[0];
    if (job && job.status !== 'queued') {
      throw new Error('The Agent claimed the job; stop it and repeat with a disposable project');
    }
    if (
      operation?.kind === 'redeploy' &&
      operation.executionOwner === null &&
      operation.executionLeaseExpiresAt === null &&
      operation.agentJobs.length === 1 &&
      job?.kind === 'deploy' &&
      job.operationStep === 1 &&
      job.attempt === 0 &&
      job.finishedAt === null
    ) {
      const lastSeenAt = environment?.target?.agent?.lastSeenAt;
      if (!lastSeenAt || Date.now() - lastSeenAt.getTime() <= AGENT_OFFLINE_AFTER_MS) {
        throw new Error('The Agent heartbeat became fresh during the offline handoff gate');
      }
      return operation;
    }
    await sleep(250);
  }
  throw new Error('The redeploy did not reach one durable queued Agent job');
}

async function before(prisma, marker) {
  const { projectId, environmentName } = projectIdentity();
  const origin = publicOrigin();
  const jwtSecret = (process.env.INITPAD_JWT_SECRET || '').trim();
  if (!jwtSecret) throw new Error('INITPAD_JWT_SECRET is required');
  const environment = await assertBeforePreconditions(prisma, projectId, environmentName);
  const username = fixtureUsername(marker);
  const userId = randomUUID();
  const { JwtService } = require('@nestjs/jwt');
  const jwt = new JwtService({ secret: jwtSecret, signOptions: { expiresIn: '10m' } });
  const token = jwt.sign({ sub: userId, ver: 0 });

  await prisma.$transaction([
    prisma.user.create({
      data: {
        id: userId,
        username,
        accessToken: `acceptance-${marker}`,
        active: true,
      },
    }),
    prisma.workspaceMember.create({
      data: { workspaceId: environment.project.workspaceId, userId, role: 'owner' },
    }),
  ]);

  const response = await fetch(`${origin}/api/projects/${projectId}/redeploy/${environmentName}`, {
    method: 'POST',
    headers: {
      // The API reads only the name for its profile (ADR-137).
      cookie: `__Host-initpad_token=${token}; initpad_token=${token}`,
      // Signed-in changes must be JSON (ADR-137).
      'content-type': 'application/json',
      'x-workspace-id': environment.project.workspaceId,
      'cache-control': 'no-store',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  await response.arrayBuffer();
  if (![200, 201].includes(response.status)) {
    throw new Error(`Agent redeploy request returned HTTP ${response.status}`);
  }
  const instance = response.headers.get('x-initpad-instance') || '';
  if (!UUID_V4.test(instance)) throw new Error('Redeploy response omitted its opaque API instance');

  const operation = await waitForQueuedHandoff(prisma, environment.id, Date.now() + 30_000);
  console.log(
    `MUTATION_FAILOVER_PREPARED operation=${operation.id} instance=${instance} job_queued=true`,
  );
}

async function recoveredState(prisma, operationId, projectId, environmentName) {
  const operation = await prisma.deploymentOperation.findUnique({
    where: { id: operationId },
    include: {
      environment: { include: { target: { select: { routingMode: true } } } },
      agentJobs: { orderBy: { operationStep: 'asc' } },
    },
  });
  if (!operation) throw new Error('The deployment operation no longer exists');
  const duplicateOperations =
    (await prisma.deploymentOperation.count({
      where: { correlationId: operation.correlationId },
    })) - 1;
  const auditSucceeded =
    (await prisma.auditEvent.count({
      where: { operationType: 'deployment', operationId, outcome: 'succeeded' },
    })) === 1;
  const managedGateway = operation.environment.target?.routingMode === 'managed-gateway';
  const steps = operation.agentJobs.map((job) => job.operationStep);
  return {
    operation,
    state: {
      scopeMatches:
        operation.environment.projectId === projectId &&
        operation.environment.name === environmentName,
      operationStatus: operation.status,
      operationFinished: operation.finishedAt !== null,
      environmentStatus: operation.environment.status,
      activeOperationId: operation.environment.activeOperationId,
      deploymentRequired: operation.environment.deploymentRequired,
      versionMatches: operation.environment.version === operation.version,
      artifactMatches: operation.environment.buildArtifactId === operation.buildArtifactId,
      duplicateOperations,
      auditSucceeded,
      jobCount: operation.agentJobs.length,
      expectedJobCount: managedGateway ? 2 : 1,
      deployJobs: operation.agentJobs.filter((job) => job.kind === 'deploy').length,
      routeJobs: operation.agentJobs.filter((job) => job.kind === 'gateway-route').length,
      jobsTerminal: operation.agentJobs.every(
        (job) => job.status === 'succeeded' && job.finishedAt !== null && job.attempt >= 1,
      ),
      jobStepsUnique: new Set(steps).size === steps.length,
      jobLeasesCleared: operation.agentJobs.every((job) => job.leaseExpiresAt === null),
    },
  };
}

async function after(prisma, marker, operationId) {
  const { projectId, environmentName } = projectIdentity();
  if (!(await fixtureUser(prisma, marker))) throw new Error('Agent failover fixture is missing');
  const timeoutSeconds = boundedInteger(
    'INITPAD_MUTATION_ACCEPTANCE_TIMEOUT_SECONDS',
    300,
    60,
    900,
  );
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let observed;
  let failures = ['deployment operation is not terminal'];
  while (Date.now() < deadline) {
    observed = await recoveredState(prisma, operationId, projectId, environmentName);
    failures = assertRecoveredState(observed.state);
    if (failures.length === 0) break;
    if (!observed.state.scopeMatches) break;
    if (observed.operation.finishedAt && observed.operation.status !== 'succeeded') break;
    await sleep(2_000);
  }
  if (!observed || failures.length > 0) {
    throw new Error(`Agent failover recovery failed: ${failures.join('; ')}`);
  }
  await cleanup(prisma, marker);
  console.log(
    `MUTATION_FAILOVER_RECOVERED terminal=succeeded jobs=${observed.state.jobCount} ` +
      'duplicate_operations=0 locks_cleared=true',
  );
}

async function main() {
  if (process.env.INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES !== '1') {
    throw new Error(
      'Refusing Agent failover fixtures. Set INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 explicitly.',
    );
  }
  const { command, marker, operationId } = parseCommand(process.argv.slice(2));
  if (command !== 'cleanup') projectIdentity();
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (command === 'before') await before(prisma, marker);
    else if (command === 'after') await after(prisma, marker, operationId);
    else {
      await cleanup(prisma, marker);
      console.log('Agent failover fixture removed. The project operation was not changed.');
    }
  } catch (error) {
    if (command === 'before') await cleanup(prisma, marker).catch(() => undefined);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Agent failover acceptance failed');
    process.exit(1);
  });
}

module.exports = {
  assertRecoveredState,
  boundedInteger,
  fixtureUsername,
  parseCommand,
  projectIdentity,
  publicOrigin,
};
