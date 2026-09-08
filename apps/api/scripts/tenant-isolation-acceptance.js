/* eslint-disable no-console */
const { randomUUID } = require('node:crypto');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');

if (process.env.INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES !== '1') {
  throw new Error(
    'Refusing to create acceptance fixtures. Set INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 explicitly.',
  );
}
if (!process.env.INITPAD_JWT_SECRET) {
  throw new Error('INITPAD_JWT_SECRET is required');
}

const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const ids = {
  alice: randomUUID(),
  bob: randomUUID(),
  workspaceA: randomUUID(),
  workspaceB: randomUUID(),
  targetA: randomUUID(),
  targetB: randomUUID(),
  allocationA: randomUUID(),
  allocationB: randomUUID(),
  projectA: randomUUID(),
  projectB: randomUUID(),
  environmentA: randomUUID(),
  environmentB: randomUUID(),
  provisioningB: randomUUID(),
};
const slugs = {
  workspaceA: `tenant-e2e-a-${suffix}`,
  workspaceB: `tenant-e2e-b-${suffix}`,
  alice: `tenant-e2e-alice-${suffix}`,
  bob: `tenant-e2e-bob-${suffix}`,
};
const apiBase = (process.env.INITPAD_ACCEPTANCE_API_URL || 'http://127.0.0.1:3000/api')
  .replace(/\/+$/, '');

const jwt = new JwtService({
  secret: process.env.INITPAD_JWT_SECRET,
  signOptions: { expiresIn: '10m' },
});

function session(userId) {
  return jwt.sign({ sub: userId, ver: 0 });
}

async function request(label, token, path, expectedStatus, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      cookie: `initpad_token=${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.workspaceId ? { 'x-workspace-id': options.workspaceId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
  const responseText = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label}: expected HTTP ${expectedStatus}, received ${response.status}: ${responseText.slice(0, 240)}`,
    );
  }
  console.log(`PASS ${label} (${response.status})`);
  return responseText;
}

async function createFixtures() {
  await prisma.user.createMany({
    data: [
      {
        id: ids.alice,
        username: slugs.alice,
        accessToken: `fixture-${suffix}-alice`,
      },
      {
        id: ids.bob,
        username: slugs.bob,
        accessToken: `fixture-${suffix}-bob`,
      },
    ],
  });
  await prisma.workspace.createMany({
    data: [
      { id: ids.workspaceA, slug: slugs.workspaceA, name: 'Tenant E2E A', type: 'team' },
      { id: ids.workspaceB, slug: slugs.workspaceB, name: 'Tenant E2E B', type: 'team' },
    ],
  });
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ids.workspaceA, userId: ids.alice, role: 'owner' },
      { workspaceId: ids.workspaceA, userId: ids.bob, role: 'viewer' },
      { workspaceId: ids.workspaceB, userId: ids.bob, role: 'owner' },
    ],
  });
  await prisma.target.createMany({
    data: [
      {
        id: ids.targetA,
        name: `Tenant target A ${suffix}`,
        kind: 'docker',
        scope: 'user',
        capabilities: 'static,node',
        publicUrl: 'https://apps.example.test',
        ownerId: ids.alice,
        workspaceId: ids.workspaceA,
      },
      {
        id: ids.targetB,
        name: `Tenant target B ${suffix}`,
        kind: 'docker',
        scope: 'user',
        capabilities: 'static,node',
        publicUrl: 'https://apps.example.test',
        ownerId: ids.bob,
        workspaceId: ids.workspaceB,
      },
    ],
  });
  await prisma.targetAllocation.createMany({
    data: [
      {
        id: ids.allocationA,
        targetId: ids.targetA,
        workspaceId: ids.workspaceA,
        namespace: slugs.workspaceA,
        capabilities: 'static,node',
      },
      {
        id: ids.allocationB,
        targetId: ids.targetB,
        workspaceId: ids.workspaceB,
        namespace: slugs.workspaceB,
        capabilities: 'static,node',
      },
    ],
  });
  await prisma.project.createMany({
    data: [
      {
        id: ids.projectA,
        name: `tenant-project-a-${suffix}`,
        templateId: 'react-vite',
        repoPath: `/tmp/tenant-e2e/${suffix}/a`,
        scmProvider: 'gitea',
        scmRepositoryId: `tenant-e2e-a-${suffix}`,
        scmOwner: slugs.alice,
        scmRepositoryName: `tenant-project-a-${suffix}`,
        scmFullName: `${slugs.alice}/tenant-project-a-${suffix}`,
        lastCommit: 'acceptance fixture',
        ownerId: ids.alice,
        workspaceId: ids.workspaceA,
      },
      {
        id: ids.projectB,
        name: `tenant-project-b-${suffix}`,
        templateId: 'react-vite',
        repoPath: `/tmp/tenant-e2e/${suffix}/b`,
        scmProvider: 'gitea',
        scmRepositoryId: `tenant-e2e-b-${suffix}`,
        scmOwner: slugs.bob,
        scmRepositoryName: `tenant-project-b-${suffix}`,
        scmFullName: `${slugs.bob}/tenant-project-b-${suffix}`,
        lastCommit: 'acceptance fixture',
        ownerId: ids.bob,
        workspaceId: ids.workspaceB,
      },
    ],
  });
  await prisma.environment.createMany({
    data: [
      {
        id: ids.environmentA,
        projectId: ids.projectA,
        name: 'dev',
        order: 0,
        provider: 'docker',
        status: 'empty',
        targetId: ids.targetA,
        allocationId: ids.allocationA,
      },
      {
        id: ids.environmentB,
        projectId: ids.projectB,
        name: 'dev',
        order: 0,
        provider: 'docker',
        status: 'empty',
        targetId: ids.targetB,
        allocationId: ids.allocationB,
      },
    ],
  });
  await prisma.provisioningOperation.create({
    data: {
      id: ids.provisioningB,
      workspaceId: ids.workspaceB,
      projectId: ids.projectB,
      projectName: `tenant-project-b-${suffix}`,
      kind: 'create',
      status: 'failed',
      step: 'ci',
      message: 'Acceptance fixture',
      requestedById: ids.bob,
      request: { name: `tenant-project-b-${suffix}`, templateId: 'react-vite' },
      attempt: 1,
      finishedAt: new Date(),
    },
  });
}

async function cleanupFixtures() {
  const workspaceIds = [ids.workspaceA, ids.workspaceB];
  await prisma.provisioningOperation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.target.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.alice, ids.bob] } } });
}

async function run() {
  const alice = session(ids.alice);
  const bob = session(ids.bob);
  await createFixtures();

  await request('foreign project deployment history is hidden', alice,
    `/projects/${ids.projectB}/deployments`, 404);
  await request('foreign project diagnostics are hidden', alice,
    `/projects/${ids.projectB}/diagnostics/dev`, 404);
  await request('foreign project config is hidden', alice,
    `/projects/${ids.projectB}/environments/dev/config`, 404);
  await request('foreign workspace header is hidden', alice, '/targets', 404,
    { workspaceId: ids.workspaceB });
  await request('foreign target mutation is hidden', alice, `/targets/${ids.targetB}`, 404,
    { method: 'PUT', body: { name: 'Must not change' } });
  await request('foreign allocation is hidden', alice, `/allocations/${ids.allocationB}`, 404);
  await request('foreign Agent is hidden', alice, `/targets/${ids.targetB}/agent`, 404);
  await request('foreign provisioning retry is hidden', alice,
    `/provisioning/${ids.provisioningB}/retry`, 404, { method: 'POST' });
  await request('foreign audit is hidden', alice, '/audit-events?limit=30', 404,
    { workspaceId: ids.workspaceB });
  await request('foreign portfolio is hidden', alice,
    `/workspaces/${ids.workspaceB}/portfolio`, 404);
  await request('foreign metrics are hidden', alice,
    `/workspaces/${ids.workspaceB}/metrics?format=json`, 404);

  await request('viewer reads project deployment history', bob,
    `/projects/${ids.projectA}/deployments`, 200);
  await request('viewer reads masked project config', bob,
    `/projects/${ids.projectA}/environments/dev/config`, 200);
  await request('viewer reads allocation', bob, `/allocations/${ids.allocationA}`, 200);
  await request('viewer reads workspace portfolio', bob,
    `/workspaces/${ids.workspaceA}/portfolio`, 200);
  await request('viewer reads workspace audit', bob, '/audit-events?limit=30', 200,
    { workspaceId: ids.workspaceA });
  await request('viewer cannot redeploy', bob, `/projects/${ids.projectA}/redeploy/dev`, 403,
    { method: 'POST' });
  await request('viewer cannot change config', bob,
    `/projects/${ids.projectA}/environments/dev/config/SAFE_KEY`, 403,
    { method: 'PUT', body: { value: 'must-not-persist' } });
  await request('viewer cannot change target', bob, `/targets/${ids.targetA}`, 403,
    { method: 'PUT', body: { name: 'Must not change' } });
  await request('viewer cannot change allocation', bob, `/allocations/${ids.allocationA}`, 403,
    { method: 'PUT', body: { status: 'disabled' } });
  await request('viewer cannot issue Agent credentials', bob,
    `/targets/${ids.targetA}/agent/enrollment`, 403, { method: 'POST' });
  await request('viewer cannot export metrics', bob,
    `/workspaces/${ids.workspaceA}/metrics?format=json`, 403);
  await request('owner exports own workspace metrics', bob,
    `/workspaces/${ids.workspaceB}/metrics?format=json`, 200);

  const [targetA, allocationA, configCount, operationCount, provisioningB] = await Promise.all([
    prisma.target.findUniqueOrThrow({ where: { id: ids.targetA }, select: { name: true } }),
    prisma.targetAllocation.findUniqueOrThrow({
      where: { id: ids.allocationA },
      select: { status: true },
    }),
    prisma.appConfigVar.count({ where: { environmentId: ids.environmentA } }),
    prisma.deploymentOperation.count({ where: { environmentId: ids.environmentA } }),
    prisma.provisioningOperation.findUniqueOrThrow({
      where: { id: ids.provisioningB },
      select: { status: true },
    }),
  ]);
  if (targetA.name !== `Tenant target A ${suffix}`) throw new Error('Target mutation escaped RBAC');
  if (allocationA.status !== 'active') throw new Error('Allocation mutation escaped RBAC');
  if (configCount !== 0) throw new Error('Config mutation escaped RBAC');
  if (operationCount !== 0) throw new Error('Deployment mutation escaped RBAC');
  if (provisioningB.status !== 'failed') throw new Error('Provisioning mutation escaped RBAC');
  console.log('PASS rejected mutations left every fixture unchanged');
}

run()
  .then(() => console.log('Tenant isolation HTTP acceptance: PASS'))
  .catch((error) => {
    console.error(`Tenant isolation HTTP acceptance: FAIL\n${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupFixtures();
    } catch (error) {
      console.error(`Fixture cleanup failed: ${error.stack || error.message}`);
      process.exitCode = 1;
    }
    await prisma.$disconnect();
  });
