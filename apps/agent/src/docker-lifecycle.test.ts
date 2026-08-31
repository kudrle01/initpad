import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  DockerLifecycle,
  parseDiagnosticPayload,
  parseLifecyclePayload,
  parseProjectDelivery,
  parseProjectPayload,
} from './docker-lifecycle.js';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';

const IMAGE_REF = `nginx@sha256:${'a'.repeat(64)}`;
const PAYLOAD = {
  allocationId: '123e4567-e89b-42d3-a456-426614174000',
  namespace: 'team-alpha',
  projectSlug: 'agent-lifecycle-check',
  environment: 'diagnostic',
  revision: 'probe-a',
  imageRef: IMAGE_REF,
  containerPort: 80,
  healthPath: '/',
  routingMode: 'direct-port' as const,
};

function response(statusCode: number, body: unknown = ''): DockerHttpResponse {
  return {
    statusCode,
    headers: {},
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

interface FakeContainer {
  Id: string;
  name: string;
  Config: { Image: string; Labels: Record<string, string> };
  State: { Running: boolean; ExitCode: number };
  NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }>> };
}

function fakeEngine(initialImagePresent = false) {
  let imagePresent = initialImagePresent;
  let networkPresent = false;
  let loadedBytes = Buffer.alloc(0);
  let networkLabels: Record<string, string> = {};
  let nextId = 1;
  const containers = new Map<string, FakeContainer>();
  const requests: DockerHttpRequest[] = [];
  const createdBodies: Array<Record<string, unknown>> = [];

  function findContainer(idOrName: string): FakeContainer | undefined {
    return [...containers.values()].find((item) => item.Id === idOrName || item.name === idOrName);
  }

  const transport: DockerTransport = async (input) => {
    requests.push(input);
    const decodedPath = decodeURIComponent(input.path);
    if (input.method === 'GET' && decodedPath.startsWith('/images/')) {
      return imagePresent
        ? response(200, { Id: 'sha256:image', RepoDigests: [IMAGE_REF] })
        : response(404, { message: 'not found' });
    }
    if (input.method === 'POST' && input.path.startsWith('/images/create')) {
      imagePresent = true;
      return response(200, '{"status":"pulled"}\n');
    }
    if (input.method === 'POST' && input.path.startsWith('/images/load')) {
      const chunks: Buffer[] = [];
      if (input.body && typeof input.body === 'object' && Symbol.asyncIterator in input.body) {
        for await (const chunk of input.body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
      }
      loadedBytes = Buffer.concat(chunks);
      imagePresent = true;
      return response(200, '{"stream":"Loaded image"}\n');
    }
    if (input.method === 'DELETE' && decodedPath.startsWith('/images/')) {
      imagePresent = false;
      return response(200, []);
    }
    if (input.method === 'GET' && decodedPath.startsWith('/networks/')) {
      return networkPresent
        ? response(200, {
            Name: decodedPath.slice('/networks/'.length),
            Containers: {},
            Labels: networkLabels,
          })
        : response(404);
    }
    if (input.method === 'POST' && input.path === '/networks/create') {
      networkPresent = true;
      networkLabels = (JSON.parse(String(input.body)) as { Labels: Record<string, string> }).Labels;
      return response(201, { Id: 'network-1' });
    }
    if (input.method === 'DELETE' && decodedPath.startsWith('/networks/')) {
      networkPresent = false;
      return response(204);
    }
    if (input.method === 'GET' && decodedPath.startsWith('/containers/json?')) {
      return response(200, [...containers.values()].map((container) => ({
        Id: container.Id,
        Names: [`/${container.name}`],
        Image: container.Config.Image,
        Labels: container.Config.Labels,
      })));
    }
    if (input.method === 'POST' && input.path.startsWith('/containers/create?name=')) {
      const name = decodeURIComponent(input.path.split('=')[1] ?? '');
      const body = JSON.parse(String(input.body)) as Record<string, unknown>;
      createdBodies.push(body);
      const hostConfig = body.HostConfig as { PortBindings: Record<string, unknown> };
      const portKey = Object.keys(hostConfig.PortBindings)[0];
      const container: FakeContainer = {
        Id: `container-${nextId++}`,
        name,
        Config: {
          Image: String(body.Image),
          Labels: body.Labels as Record<string, string>,
        },
        State: { Running: false, ExitCode: 0 },
        NetworkSettings: { Ports: { [portKey]: [{ HostPort: String(32_000 + nextId) }] } },
      };
      containers.set(container.Id, container);
      return response(201, { Id: container.Id });
    }
    const containerMatch = decodedPath.match(/^\/containers\/([^/?]+)(\/json|\/start|\/stop|\/rename|\/logs|\/update)?/);
    if (containerMatch) {
      const container = findContainer(containerMatch[1]);
      const action = containerMatch[2];
      if (!container) return response(404, { message: 'not found' });
      if (input.method === 'GET' && action === '/json') return response(200, container);
      if (input.method === 'POST' && action === '/start') {
        container.State.Running = true;
        return response(204);
      }
      if (input.method === 'POST' && action === '/stop') {
        container.State.Running = false;
        return response(204);
      }
      if (input.method === 'POST' && action === '/rename') {
        container.name = new URL(`http://docker${input.path}`).searchParams.get('name') ?? container.name;
        return response(204);
      }
      if (input.method === 'POST' && action === '/update') return response(200, {});
      if (input.method === 'GET' && action === '/logs') {
        return response(200, '\u001b[31mbounded\u001b[0m\u0000 log');
      }
      if (input.method === 'DELETE') {
        containers.delete(container.Id);
        return response(204);
      }
    }
    return response(500, { message: `Unhandled fake request ${input.method} ${input.path}` });
  };
  return {
    transport,
    containers,
    requests,
    createdBodies,
    imagePresent: () => imagePresent,
    networkPresent: () => networkPresent,
    loadedBytes: () => loadedBytes,
    seedForeign: (name: string) => {
      containers.set('foreign-1', {
        Id: 'foreign-1',
        name,
        Config: { Image: IMAGE_REF, Labels: {} },
        State: { Running: true, ExitCode: 0 },
        NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '32000' }] } },
      });
    },
  };
}

test('rejects untrusted lifecycle fields before contacting Docker', () => {
  assert.throws(
    () => parseLifecyclePayload({ ...PAYLOAD, imageRef: 'nginx:latest' }),
    /immutable image reference/,
  );
  assert.throws(
    () => parseLifecyclePayload({ ...PAYLOAD, projectSlug: '../../other-workspace' }),
    /project slug/,
  );
  assert.throws(
    () => parseLifecyclePayload({ ...PAYLOAD, healthPath: 'http://attacker/' }),
    /health path/,
  );
  assert.throws(
    () => parseLifecyclePayload({ ...PAYLOAD, command: ['sh', '-c', 'id'] }),
    /invalid|contains/i,
  );
  assert.throws(
    () => parseLifecyclePayload({ ...PAYLOAD, routingMode: 'host-network' }),
    /routing mode/,
  );
  const { routingMode: _routingMode, ...legacyPayload } = PAYLOAD;
  assert.equal(parseLifecyclePayload(legacyPayload).routingMode, 'direct-port');
});

test('validates project artifact metadata and transient config independently', () => {
  const payload = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/acme/api:${'a'.repeat(40)}`,
    configFingerprint: 'b'.repeat(64),
  };
  assert.deepEqual(parseProjectPayload(payload), payload);
  assert.throws(() => parseProjectPayload({ ...payload, command: ['sh'] }), /unsupported fields/);
  assert.throws(() => parseProjectPayload({ ...payload, configFingerprint: 'raw-secret' }), /fingerprint/);
  assert.throws(
    () => parseProjectDelivery({
      artifact: { path: 'https://attacker.test/archive', sha256: 'c'.repeat(64), sizeBytes: 10 },
      envVars: {},
    }),
    /artifact path/,
  );
  assert.throws(
    () => parseProjectDelivery({
      artifact: { path: '/api/agent/jobs/job-1/artifact', sha256: 'c'.repeat(64), sizeBytes: 10 },
      envVars: { PORT: '9999' },
    }),
    /invalid variable/,
  );
});

test('accepts only the bounded allocation-scoped diagnostic payload', () => {
  const { imageRef: _imageRef, configFingerprint: _fingerprint, ...diagnostic } = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    configFingerprint: 'b'.repeat(64),
  };
  assert.deepEqual(parseDiagnosticPayload(diagnostic), diagnostic);
  assert.throws(
    () => parseDiagnosticPayload({ ...diagnostic, command: ['sh', '-c', 'env'] }),
    /unsupported fields/,
  );
  assert.throws(
    () => parseDiagnosticPayload({ ...diagnostic, healthPath: 'https://attacker.test/' }),
    /health path/,
  );
});

test('streams and verifies an image archive before publishing an isolated project workload', async () => {
  const bytes = Buffer.from('verified-image-archive');
  const payload = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/acme/api:${'a'.repeat(40)}`,
    configFingerprint: 'b'.repeat(64),
  };
  const delivery = {
    artifact: {
      path: '/api/agent/jobs/job-1/artifact',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    },
    envVars: { APP_ENV: 'production', DATABASE_PASSWORD: 'never-log-this' },
  };
  const engine = fakeEngine();
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );
  const progress: number[] = [];

  const status = await lifecycle.deployProject(
    payload,
    delivery,
    (async function* () { yield bytes; })(),
    'job-1',
    new AbortController().signal,
    async (item) => { progress.push(item.percent); },
  );

  assert.equal(status.state, 'running');
  assert.equal(status.revision, payload.revision);
  assert.deepEqual(progress, [8, 38, 82, 96]);
  assert.deepEqual(engine.loadedBytes(), bytes);
  assert.equal(engine.containers.size, 1);
  const created = engine.createdBodies[0];
  assert.deepEqual(created.Env, [
    'APP_ENV=production',
    'DATABASE_PASSWORD=never-log-this',
  ]);
  assert.equal(
    (created.Labels as Record<string, string>)['com.initpad.config-fingerprint'],
    payload.configFingerprint,
  );
});

test('rejects a corrupt project archive without publishing a workload', async () => {
  const bytes = Buffer.from('corrupt-image-archive');
  const payload = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/acme/api:${'a'.repeat(40)}`,
    configFingerprint: 'b'.repeat(64),
  };
  const engine = fakeEngine();
  const lifecycle = new DockerLifecycle('target-1', 'tcp://docker:2375', engine.transport, 'docker');

  await assert.rejects(
    lifecycle.deployProject(
      payload,
      {
        artifact: {
          path: '/api/agent/jobs/job-1/artifact',
          sha256: 'f'.repeat(64),
          sizeBytes: bytes.length,
        },
        envVars: {},
      },
      (async function* () { yield bytes; })(),
      'job-1',
      new AbortController().signal,
      async () => undefined,
    ),
    /SHA-256/,
  );
  assert.equal(engine.containers.size, 0);
  assert.equal(engine.imagePresent(), false);
});

test('returns only bounded logs, runtime state, exit code and health for an owned workload', async () => {
  const bytes = Buffer.from('verified-image-archive');
  const payload = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/acme/api:${'a'.repeat(40)}`,
    configFingerprint: 'b'.repeat(64),
  };
  const diagnostic = {
    allocationId: payload.allocationId,
    namespace: payload.namespace,
    projectSlug: payload.projectSlug,
    environment: payload.environment,
    revision: payload.revision,
    containerPort: payload.containerPort,
    healthPath: payload.healthPath,
    routingMode: payload.routingMode,
  };
  const engine = fakeEngine();
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );
  await lifecycle.deployProject(
    payload,
    {
      artifact: {
        path: '/api/agent/jobs/job-1/artifact',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
      },
      envVars: {},
    },
    (async function* () { yield bytes; })(),
    'job-1',
    new AbortController().signal,
    async () => undefined,
  );

  const running = await lifecycle.diagnostics(diagnostic, new AbortController().signal);
  assert.equal(running.state, 'running');
  assert.equal(running.revision, payload.revision);
  assert.equal(running.health, 'healthy');
  assert.equal(running.logs, 'bounded log');
  await lifecycle.stop(payload, new AbortController().signal);
  const stopped = await lifecycle.diagnostics(diagnostic, new AbortController().signal);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.exitCode, 0);
  assert.equal(stopped.health, 'not-running');
  assert.equal(stopped.logs, 'bounded log');
  assert.equal(
    engine.requests.some((request) =>
      request.method === 'GET'
      && request.path.includes('/logs?stdout=1&stderr=1&tail=200')
      && request.maxResponseBytes === 32 * 1024 + 8 * 200),
    true,
  );
});

test('preserves an immutable diagnostic image that was already cached', async () => {
  const engine = fakeEngine(true);
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );

  await lifecycle.acceptance(
    PAYLOAD,
    'job-2',
    new AbortController().signal,
    async () => undefined,
  );

  assert.equal(engine.imagePresent(), true);
  assert.equal(engine.networkPresent(), false);
});

test('refuses to operate on a same-named container outside the allocation', async () => {
  const engine = fakeEngine();
  engine.seedForeign('initpad-team-alpha-agent-lifecycle-check-diagnostic');
  const lifecycle = new DockerLifecycle('target-1', 'tcp://docker:2375', engine.transport, 'docker');

  await assert.rejects(
    lifecycle.remove(PAYLOAD, new AbortController().signal),
    /name collision outside allocation/,
  );
  assert.equal(engine.containers.has('foreign-1'), true);
});

test('runs the lifecycle suite with isolation, hardening, rollback and cleanup', async () => {
  const engine = fakeEngine();
  const progress: number[] = [];
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );

  await lifecycle.acceptance(
    PAYLOAD,
    'job-1',
    new AbortController().signal,
    async (item) => { progress.push(item.percent); },
  );

  assert.deepEqual(progress, [8, 24, 40, 52, 64, 76, 90]);
  assert.equal(engine.containers.size, 0);
  assert.equal(engine.imagePresent(), false);
  assert.equal(engine.networkPresent(), false);
  assert.ok(engine.requests.some((item) => item.path.includes('/rename?name=')));
  assert.ok(engine.requests.some((item) => item.path.includes('/stop?t=10')));
  assert.ok(engine.requests.some((item) => item.path.includes('/logs?')));

  assert.ok(engine.createdBodies.length >= 3);
  const first = engine.createdBodies[0];
  const host = first.HostConfig as Record<string, unknown>;
  assert.equal(first.Cmd, undefined);
  assert.equal(first.Entrypoint, undefined);
  assert.equal(host.Privileged, undefined);
  assert.equal(host.Binds, undefined);
  assert.equal(host.NetworkMode, 'net-team-alpha-diagnostic');
  assert.deepEqual(
    (host.PortBindings as Record<string, unknown>)['80/tcp'],
    [{ HostIp: '0.0.0.0', HostPort: '' }],
  );
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.CapAdd, ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID', 'NET_BIND_SERVICE']);
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
  assert.deepEqual(host.RestartPolicy, { Name: 'no' });
  assert.ok(engine.requests.some((item) => item.path.endsWith('/update')));
  assert.equal((first.Labels as Record<string, string>)['com.initpad.allocation.id'], PAYLOAD.allocationId);
  assert.equal((first.Labels as Record<string, string>)['com.initpad.target'], 'target-1');
});

test('isolates a managed-gateway workload network and keeps its health port on loopback', async () => {
  const engine = fakeEngine();
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );
  const managed = { ...PAYLOAD, routingMode: 'managed-gateway' as const };

  await lifecycle.deploy(managed, 'job-managed', new AbortController().signal);

  const host = engine.createdBodies[0].HostConfig as Record<string, unknown>;
  assert.equal(host.NetworkMode, 'net-team-alpha-agent-lifecycle-check-diagnostic');
  assert.deepEqual(
    (host.PortBindings as Record<string, unknown>)['80/tcp'],
    [{ HostIp: '127.0.0.1', HostPort: '' }],
  );
});

test('keeps the previous managed revision until the public route gate commits', async () => {
  const engine = fakeEngine();
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );
  const first = { ...PAYLOAD, revision: 'managed-a', routingMode: 'managed-gateway' as const };
  const second = { ...PAYLOAD, revision: 'managed-b', routingMode: 'managed-gateway' as const };

  const firstStatus = await lifecycle.deploy(first, 'job-managed-a', new AbortController().signal);
  const secondStatus = await lifecycle.deploy(second, 'job-managed-b', new AbortController().signal);

  assert.equal(engine.containers.size, 2);
  assert.notEqual(firstStatus.workloadSlot, secondStatus.workloadSlot);
  assert.ok([...engine.containers.values()].every((container) => container.State.Running));
  assert.ok([...engine.containers.values()].every((container) => container.name.includes('-rev-')));
});

test('full managed project removal deletes every owned revision and its network', async () => {
  const engine = fakeEngine();
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );
  const first = { ...PAYLOAD, revision: 'managed-a', routingMode: 'managed-gateway' as const };
  const second = { ...PAYLOAD, revision: 'managed-b', routingMode: 'managed-gateway' as const };

  await lifecycle.deploy(first, 'job-managed-a', new AbortController().signal);
  await lifecycle.deploy(second, 'job-managed-b', new AbortController().signal);
  await lifecycle.removeProject(second, new AbortController().signal);

  assert.equal(engine.containers.size, 0);
  assert.equal(engine.networkPresent(), false);
  assert.equal(engine.imagePresent(), false);
});
