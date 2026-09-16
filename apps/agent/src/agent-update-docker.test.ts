import assert from 'node:assert/strict';
import test from 'node:test';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';
import { AgentUpdateDocker } from './agent-update-docker.js';
import type { AgentUpdatePlan } from './release-update.js';

const targetId = '63ec310e-0fd1-48fd-b9e0-f58f77c7a295';
const jobId = '5c7ed49a-c24e-4cb2-a530-161425907048';
const oldImage = `ghcr.io/example/initpad-agent@sha256:${'a'.repeat(64)}`;
const newImage = `ghcr.io/example/initpad-agent@sha256:${'b'.repeat(64)}`;

const plan: AgentUpdatePlan = {
  schemaVersion: 1,
  jobId,
  attempt: 1,
  leaseToken: `initpad_lease_${'c'.repeat(43)}`,
  targetId,
  version: '0.14.0',
  image: newImage,
  createdAt: '2026-09-16T10:00:00.000Z',
};

function response(statusCode: number, body: unknown = ''): DockerHttpResponse {
  return {
    statusCode,
    headers: {},
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function currentInspect() {
  return {
    Id: 'a'.repeat(64),
    Config: {
      Image: oldImage,
      Env: [
        'INITPAD_AGENT_CONTROL_PLANE_URL=https://initpad.example.test',
        `INITPAD_AGENT_TARGET_ID=${targetId}`,
      ],
      Labels: { 'com.initpad.agent': 'true', 'com.initpad.target': targetId },
    },
    State: { Running: true },
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/run/docker.sock',
        Destination: '/var/run/docker.sock',
        RW: true,
      },
      {
        Type: 'bind',
        Source: '/var/lib/initpad-agent',
        Destination: '/var/lib/initpad-agent',
        RW: true,
      },
    ],
  };
}

function dockerHarness(heartbeatExitCode = 0) {
  const requests: DockerHttpRequest[] = [];
  let createCount = 0;
  const transport: DockerTransport = async (request) => {
    requests.push(request);
    if (request.path === '/containers/initpad-agent/json') {
      return response(200, currentInspect());
    }
    if (request.path === '/containers/initpad-agent-previous/json') return response(404);
    if (request.path.startsWith('/containers/create?name=')) {
      createCount += 1;
      return response(201, { Id: String(createCount).repeat(12) });
    }
    if (request.path.includes('/wait?condition=not-running')) {
      return response(200, { StatusCode: 0 });
    }
    if (request.path === '/containers/222222222222/exec') {
      return response(201, { Id: '3'.repeat(12) });
    }
    if (request.path === `/exec/${'3'.repeat(12)}/json`) {
      return response(200, { Running: false, ExitCode: heartbeatExitCode });
    }
    if (request.path.startsWith('/exec/')) return response(200);
    if (request.method === 'DELETE') return response(204);
    if (request.path.includes('/rename?')) return response(204);
    if (request.path.includes('/start') || request.path.includes('/stop?')) return response(204);
    throw new Error(`Unexpected Docker request ${request.method} ${request.path}`);
  };
  return { requests, transport };
}

test('updates through a restricted preflight and removes the rollback slot after heartbeat', async () => {
  const { requests, transport } = dockerHarness();
  const checkpoints: number[] = [];
  const docker = new AgentUpdateDocker('unix:///var/run/docker.sock', transport);

  await docker.apply(plan, new AbortController().signal, async () => {
    checkpoints.push(checkpoints.length + 1);
  });

  assert.equal(checkpoints.length, 3);
  const createRequests = requests.filter((request) =>
    request.path.startsWith('/containers/create'),
  );
  assert.equal(createRequests.length, 2);
  const candidate = JSON.parse(String(createRequests[0]?.body)) as Record<string, unknown>;
  const replacement = JSON.parse(String(createRequests[1]?.body)) as Record<string, unknown>;
  assert.equal(candidate.Image, newImage);
  assert.deepEqual(candidate.Cmd, ['once']);
  assert.deepEqual(replacement.Cmd, ['run']);
  for (const body of [candidate, replacement]) {
    const host = body.HostConfig as Record<string, unknown>;
    assert.equal(host.ReadonlyRootfs, true);
    assert.deepEqual(host.CapDrop, ['ALL']);
    assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
    assert.equal(host.NetworkMode, 'host');
  }
  assert.ok(
    requests.some(
      (request) =>
        request.method === 'DELETE' &&
        request.path.startsWith('/containers/initpad-agent-previous?'),
    ),
  );
});

test('restores the previous Agent when the replacement cannot confirm its heartbeat', async () => {
  const { requests, transport } = dockerHarness(1);
  const docker = new AgentUpdateDocker('unix:///var/run/docker.sock', transport);

  await assert.rejects(
    docker.apply(plan, new AbortController().signal),
    /did not confirm its control-plane heartbeat/,
  );

  assert.ok(
    requests.some(
      (request) =>
        request.method === 'DELETE' && request.path.startsWith('/containers/initpad-agent?'),
    ),
  );
  assert.ok(
    requests.some(
      (request) => request.path === '/containers/initpad-agent-previous/rename?name=initpad-agent',
    ),
  );
  assert.ok(requests.some((request) => request.path === '/containers/initpad-agent/start'));
});

test('refuses to clone a mutable or unmanaged Agent container', async () => {
  const transport: DockerTransport = async (request) => {
    if (request.path === '/containers/initpad-agent/json') {
      const inspect = currentInspect();
      inspect.Config.Image = 'ghcr.io/example/initpad-agent:latest';
      return response(200, inspect);
    }
    throw new Error('No mutation should be attempted');
  };
  const docker = new AgentUpdateDocker('unix:///var/run/docker.sock', transport);

  await assert.rejects(
    docker.apply(plan, new AbortController().signal),
    /not a verified managed release/,
  );
});
