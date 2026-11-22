import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  allocationDockerScope,
  DIRECT_PROXY_IMAGE,
  directPortRangeFromEnv,
  directProxyImageFromEnv,
  DockerLifecycle,
  healthTimeoutFromEnv,
  legacyWorkloadContainerName,
  managedWorkloadContainerName,
  parseDiagnosticPayload,
  parseLifecyclePayload,
  parseProjectDelivery,
  parseProjectPayload,
  workloadContainerName,
  workloadNetworkName,
} from './docker-lifecycle.js';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';

const IMAGE_REF = `nginx@sha256:${'a'.repeat(64)}`;
const NO_DRAIN = 0;
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
  cpuLimitMillicores: 750,
  memoryLimitMb: 384,
  pidsLimit: 128,
};

function lifecycleFor(
  engine: { transport: DockerTransport },
  options: { range?: { first: number; last: number }; proxyImage?: string } = {},
) {
  return new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
    1_000,
    options.range ?? { first: 30_000, last: 32_767 },
    options.proxyImage ?? DIRECT_PROXY_IMAGE,
    NO_DRAIN,
  );
}

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
  NetworkSettings: {
    Ports: Record<string, Array<{ HostIp?: string; HostPort: string }>>;
    Networks?: Record<string, { Aliases: string[] }>;
  };
}

function fakeEngine(initialImagePresent = false) {
  let imagePresent = initialImagePresent;
  let proxyImagePresent = false;
  let proxyPullFailure = false;
  let imageLoadFailure: string | null = null;
  let exitOnNextStart = false;
  let failNextRestartPolicyUpdate = false;
  let networkPresent = false;
  let loadedBytes = Buffer.alloc(0);
  let networkLabels: Record<string, string> = {};
  let nextId = 1;
  const occupiedOutsideDocker = new Set<string>();
  let conflictingStarts = 0;
  const containers = new Map<string, FakeContainer>();
  const requests: DockerHttpRequest[] = [];
  const createdBodies: Array<Record<string, unknown>> = [];

  function findContainer(idOrName: string): FakeContainer | undefined {
    return [...containers.values()].find((item) => item.Id === idOrName || item.name === idOrName);
  }

  const transport: DockerTransport = async (input) => {
    requests.push(input);
    const decodedPath = decodeURIComponent(input.path);
    if (decodedPath.includes('caddy:')) {
      if (input.method === 'GET') {
        return proxyImagePresent
          ? response(200, { Id: 'sha256:proxy', RepoDigests: [DIRECT_PROXY_IMAGE] })
          : response(404, { message: 'not found' });
      }
      if (input.method === 'POST') {
        if (proxyPullFailure) return response(500, { message: 'registry unreachable' });
        proxyImagePresent = true;
        return response(200, '{"status":"pulled"}\n');
      }
    }
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
      if (imageLoadFailure) {
        const message = imageLoadFailure;
        imageLoadFailure = null;
        // Model Docker having written partial image data before the daemon
        // reports ENOSPC. The caller must actively remove that partial state.
        imagePresent = true;
        return response(500, { message });
      }
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
    const networkAction = /^\/networks\/([^/]+)\/(connect|disconnect)$/.exec(decodedPath);
    if (input.method === 'POST' && networkAction) {
      const body = JSON.parse(String(input.body)) as {
        Container: string;
        EndpointConfig?: { Aliases?: string[] };
      };
      const container = findContainer(body.Container);
      if (!container) return response(404, { message: 'no such container' });
      const networks = (container.NetworkSettings.Networks ??= {});
      if (networkAction[2] === 'disconnect') delete networks[networkAction[1]];
      else networks[networkAction[1]] = { Aliases: body.EndpointConfig?.Aliases ?? [] };
      return response(200);
    }
    if (input.method === 'DELETE' && decodedPath.startsWith('/networks/')) {
      networkPresent = false;
      return response(204);
    }
    if (input.method === 'GET' && decodedPath.startsWith('/containers/json?')) {
      return response(
        200,
        [...containers.values()].map((container) => ({
          Id: container.Id,
          Names: [`/${container.name}`],
          Image: container.Config.Image,
          Labels: container.Config.Labels,
          Ports: container.State.Running
            ? Object.values(container.NetworkSettings.Ports).flatMap((items) =>
                items.map((item) => ({ PublicPort: Number(item.HostPort) })),
              )
            : [],
        })),
      );
    }
    if (input.method === 'POST' && input.path.startsWith('/containers/create?name=')) {
      const name = decodeURIComponent(input.path.split('=')[1] ?? '');
      const body = JSON.parse(String(input.body)) as Record<string, unknown>;
      createdBodies.push(body);
      const hostConfig = body.HostConfig as {
        PortBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
      };
      const portKey = Object.keys(hostConfig.PortBindings)[0];
      const requestedPort = hostConfig.PortBindings[portKey]?.[0]?.HostPort;
      const requestedIp = hostConfig.PortBindings[portKey]?.[0]?.HostIp;
      const container: FakeContainer = {
        Id: `container-${nextId++}`,
        name,
        Config: {
          Image: String(body.Image),
          Labels: body.Labels as Record<string, string>,
        },
        State: { Running: false, ExitCode: 0 },
        NetworkSettings: {
          Ports: {
            [portKey]: [
              { HostIp: requestedIp, HostPort: requestedPort || String(33_000 + nextId) },
            ],
          },
        },
      };
      containers.set(container.Id, container);
      return response(201, { Id: container.Id });
    }
    const containerMatch = decodedPath.match(
      /^\/containers\/([^/?]+)(\/json|\/start|\/stop|\/rename|\/logs|\/update)?/,
    );
    if (containerMatch) {
      const container = findContainer(containerMatch[1]);
      const action = containerMatch[2];
      if (!container) return response(404, { message: 'not found' });
      if (input.method === 'GET' && action === '/json') return response(200, container);
      if (input.method === 'POST' && action === '/start') {
        if (conflictingStarts > 0) {
          conflictingStarts -= 1;
          return response(500, {
            message:
              'driver failed programming external connectivity: failed to bind port 0.0.0.0:42021/tcp: listen tcp4 0.0.0.0:42021: bind: address already in use',
          });
        }
        const port = Object.values(container.NetworkSettings.Ports)[0]?.[0]?.HostPort ?? '';
        const taken = [...containers.values()].some(
          (other) =>
            other !== container &&
            other.State.Running &&
            Object.values(other.NetworkSettings.Ports).some((items) =>
              items.some((item) => item.HostIp === '0.0.0.0' && item.HostPort === port),
            ),
        );
        if (occupiedOutsideDocker.has(port) || taken) {
          return response(500, {
            message: `driver failed programming external connectivity: Bind for 0.0.0.0:${port} failed: port is already allocated`,
          });
        }
        if (exitOnNextStart) {
          exitOnNextStart = false;
          container.State.Running = false;
          container.State.ExitCode = 1;
        } else {
          container.State.Running = true;
        }
        return response(204);
      }
      if (input.method === 'POST' && action === '/stop') {
        container.State.Running = false;
        return response(204);
      }
      if (input.method === 'POST' && action === '/rename') {
        container.name =
          new URL(`http://docker${input.path}`).searchParams.get('name') ?? container.name;
        return response(204);
      }
      if (input.method === 'POST' && action === '/update') {
        if (failNextRestartPolicyUpdate) {
          failNextRestartPolicyUpdate = false;
          return response(500, { message: 'simulated interruption before publication' });
        }
        return response(200, {});
      }
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
    proxyImagePresent: () => proxyImagePresent,
    failProxyPull: () => {
      proxyPullFailure = true;
    },
    networkPresent: () => networkPresent,
    loadedBytes: () => loadedBytes,
    occupyOutsideDocker: (port: number) => occupiedOutsideDocker.add(String(port)),
    conflictNextStarts: (count: number) => {
      conflictingStarts = count;
    },
    failNextImageLoad: (message = 'no space left on device') => {
      imageLoadFailure = message;
    },
    exitNextContainerStart: () => {
      exitOnNextStart = true;
    },
    interruptNextPublication: () => {
      failNextRestartPolicyUpdate = true;
    },
    seedForeign: (name: string) => {
      containers.set('foreign-1', {
        Id: 'foreign-1',
        name,
        Config: { Image: IMAGE_REF, Labels: {} },
        State: { Running: true, ExitCode: 0 },
        NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '32000' }] } },
      });
    },
    seedOwned: (name: string, payload: typeof PAYLOAD, hostPort = '32000') => {
      containers.set('owned-legacy-1', {
        Id: 'owned-legacy-1',
        name,
        Config: {
          Image: payload.imageRef,
          Labels: {
            'com.initpad.managed': 'true',
            'com.initpad.target': 'target-1',
            'com.initpad.allocation.id': payload.allocationId,
            'com.initpad.allocation.namespace': payload.namespace,
            'com.initpad.project': payload.projectSlug,
            'com.initpad.environment': payload.environment,
            'com.initpad.routing.mode': payload.routingMode,
            'com.initpad.workload': `${payload.allocationId}:${payload.projectSlug}:${payload.environment}`,
            'com.initpad.revision': payload.revision,
          },
        },
        State: { Running: true, ExitCode: 0 },
        NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: hostPort }] } },
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
  assert.throws(
    () => parseProjectPayload({ ...payload, configFingerprint: 'raw-secret' }),
    /fingerprint/,
  );
  assert.throws(
    () =>
      parseProjectDelivery({
        artifact: { path: 'https://attacker.test/archive', sha256: 'c'.repeat(64), sizeBytes: 10 },
        envVars: {},
      }),
    /artifact path/,
  );
  assert.throws(
    () =>
      parseProjectDelivery({
        artifact: { path: '/api/agent/jobs/job-1/artifact', sha256: 'c'.repeat(64), sizeBytes: 10 },
        envVars: { PORT: '9999' },
      }),
    /invalid variable/,
  );
});

test('accepts only the bounded allocation-scoped diagnostic payload', () => {
  const {
    imageRef: _imageRef,
    configFingerprint: _fingerprint,
    cpuLimitMillicores: _cpu,
    memoryLimitMb: _memory,
    pidsLimit: _pids,
    ...diagnostic
  } = {
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
    (async function* () {
      yield bytes;
    })(),
    'job-1',
    new AbortController().signal,
    async (item) => {
      progress.push(item.percent);
    },
  );

  assert.equal(status.state, 'running');
  assert.equal(status.revision, payload.revision);
  assert.deepEqual(progress, [8, 38, 82, 96]);
  assert.deepEqual(engine.loadedBytes(), bytes);
  // The revision and the stable-port proxy of the environment.
  assert.equal(engine.containers.size, 2);
  assert.ok(status.hostPort && status.hostPort >= 30_000);
  const created = engine.createdBodies[0];
  assert.deepEqual(created.Env, ['APP_ENV=production', 'DATABASE_PASSWORD=never-log-this']);
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
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
  );

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
      (async function* () {
        yield bytes;
      })(),
      'job-1',
      new AbortController().signal,
      async () => undefined,
    ),
    /SHA-256/,
  );
  assert.equal(engine.containers.size, 0);
  assert.equal(engine.imagePresent(), false);
});

test('cleans a partially loaded image when Docker reports a full disk', async () => {
  const bytes = Buffer.from('verified-image-archive');
  const payload = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/acme/api:${'a'.repeat(40)}`,
    configFingerprint: 'b'.repeat(64),
  };
  const engine = fakeEngine();
  engine.failNextImageLoad();
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
  );

  await assert.rejects(
    lifecycle.deployProject(
      payload,
      {
        artifact: {
          path: '/api/agent/jobs/job-1/artifact',
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: bytes.length,
        },
        envVars: {},
      },
      (async function* () {
        yield bytes;
      })(),
      'job-disk-full',
      new AbortController().signal,
      async () => undefined,
    ),
    /no space left on device/,
  );

  assert.equal(engine.containers.size, 0);
  assert.equal(engine.imagePresent(), false);
  assert.equal(
    engine.requests.some(
      (request) => request.method === 'DELETE' && request.path.startsWith('/images/'),
    ),
    true,
  );
});

test('keeps the previous workload when a replacement exits before health verification', async () => {
  const engine = fakeEngine(true);
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => new Response('ok', { status: 200 }),
  );
  const previous = { ...PAYLOAD, revision: 'probe-a' };
  const replacement = { ...PAYLOAD, revision: 'probe-b' };

  await lifecycle.deploy(previous, 'job-previous', new AbortController().signal);
  const previousContainer = [...engine.containers.values()].find(
    (item) => item.Config.Labels['com.initpad.role'] !== 'proxy',
  )!;
  engine.exitNextContainerStart();

  await assert.rejects(
    lifecycle.deploy(replacement, 'job-replacement', new AbortController().signal),
    /Candidate workload failed its health check/,
  );

  // The previous revision and its proxy; the failed candidate is gone.
  assert.equal(engine.containers.size, 2);
  assert.equal(engine.containers.has(previousContainer.Id), true);
  assert.equal(previousContainer.State.Running, true);
  assert.equal(previousContainer.Config.Labels['com.initpad.revision'], previous.revision);
});

test('resumes the same candidate after interruption and finishes with one workload', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  const previous = { ...PAYLOAD, revision: 'probe-a' };
  const replacement = { ...PAYLOAD, revision: 'probe-b' };

  await lifecycle.deploy(previous, 'job-previous', new AbortController().signal);
  engine.interruptNextPublication();

  await assert.rejects(
    lifecycle.deploy(replacement, 'job-attempt-1', new AbortController().signal),
    /simulated interruption before publication/,
  );
  // Previous revision, its proxy and the interrupted candidate.
  assert.equal(engine.containers.size, 3);

  const recovered = await lifecycle.deploy(
    replacement,
    'job-attempt-2',
    new AbortController().signal,
  );

  assert.equal(recovered.state, 'running');
  assert.equal(recovered.revision, replacement.revision);
  assert.equal(engine.containers.size, 2);
  // Revision a, proxy and the candidate that was resumed instead of recreated.
  assert.equal(engine.createdBodies.length, 3);
  assert.equal(
    [...engine.containers.values()].find(
      (item) => item.Config.Labels['com.initpad.role'] !== 'proxy',
    )!.Config.Labels['com.initpad.revision'],
    replacement.revision,
  );
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
    (async function* () {
      yield bytes;
    })(),
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
    engine.requests.some(
      (request) =>
        request.method === 'GET' &&
        request.path.includes('/logs?stdout=1&stderr=1&tail=200') &&
        request.maxResponseBytes === 32 * 1024 + 8 * 200,
    ),
    true,
  );
});

test('preserves an immutable diagnostic image that was already cached', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);

  await lifecycle.acceptance(PAYLOAD, 'job-2', new AbortController().signal, async () => undefined);

  assert.equal(engine.imagePresent(), true);
  assert.equal(engine.networkPresent(), false);
});

test('refuses to operate on a same-named container outside the allocation', async () => {
  const engine = fakeEngine();
  engine.seedForeign(workloadContainerName(PAYLOAD));
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
  );

  await assert.rejects(
    lifecycle.remove(PAYLOAD, new AbortController().signal),
    /name collision outside allocation/,
  );
  assert.equal(engine.containers.has('foreign-1'), true);
});

test('scopes Docker resource names by immutable allocation identity', () => {
  const replacement = { ...PAYLOAD, allocationId: '223e4567-e89b-42d3-a456-426614174000' };

  assert.match(allocationDockerScope(PAYLOAD.allocationId), /^[a-f0-9]{12}$/);
  assert.notEqual(workloadContainerName(PAYLOAD), workloadContainerName(replacement));
  assert.notEqual(workloadNetworkName(PAYLOAD), workloadNetworkName(replacement));
  assert.match(workloadContainerName(PAYLOAD), /-a[a-f0-9]{12}-/);
  assert.match(workloadNetworkName(PAYLOAD), /-a[a-f0-9]{12}-/);
  assert.match(managedWorkloadContainerName(PAYLOAD, 'a1b2c3d4e5f6'), /-rev-a1b2c3d4e5f6$/);
});

test('migrates an owned legacy direct-port container on the next deployment', async () => {
  const engine = fakeEngine(true);
  const previous = { ...PAYLOAD, revision: 'previous' };
  const desired = { ...PAYLOAD, revision: 'replacement' };
  engine.seedOwned(legacyWorkloadContainerName(previous), previous);
  const lifecycle = lifecycleFor(engine);

  await lifecycle.deploy(desired, 'job-replacement', new AbortController().signal);

  const names = [...engine.containers.values()].map((item) => item.name).sort();
  assert.deepEqual(names, [
    workloadContainerName(desired),
    `${workloadContainerName(desired)}-proxy`,
  ]);
  assert.equal(engine.containers.has('owned-legacy-1'), false);
});

test('ignores a foreign legacy name while removing the scoped allocation', async () => {
  const engine = fakeEngine();
  engine.seedForeign(legacyWorkloadContainerName(PAYLOAD));
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
  );

  await lifecycle.remove(PAYLOAD, new AbortController().signal);

  assert.equal(engine.containers.has('foreign-1'), true);
});

test('runs the lifecycle suite with isolation, hardening, rollback and cleanup', async () => {
  const engine = fakeEngine();
  const progress: number[] = [];
  const lifecycle = lifecycleFor(engine);

  await lifecycle.acceptance(PAYLOAD, 'job-1', new AbortController().signal, async (item) => {
    progress.push(item.percent);
  });

  assert.deepEqual(progress, [8, 24, 40, 52, 64, 76, 90]);
  assert.equal(engine.containers.size, 0);
  assert.equal(engine.imagePresent(), false);
  assert.equal(engine.networkPresent(), false);
  // The shared proxy image is not the workload's to remove.
  assert.equal(engine.proxyImagePresent(), true);
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
  assert.equal(host.NetworkMode, workloadNetworkName(PAYLOAD));
  // Revisions keep no host-port label; the proxy owns the stable port (ADR-191).
  assert.equal((first.Labels as Record<string, string>)['com.initpad.host-port'], undefined);
  assert.deepEqual((host.PortBindings as Record<string, unknown>)['80/tcp'], [
    { HostIp: '127.0.0.1', HostPort: '' },
  ]);
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.CapAdd, ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID', 'NET_BIND_SERVICE']);
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
  assert.deepEqual(host.RestartPolicy, { Name: 'no' });
  assert.equal(host.NanoCpus, 750_000_000);
  assert.equal(host.Memory, 384 * 1024 * 1024);
  assert.equal(host.MemorySwap, 384 * 1024 * 1024);
  assert.equal(host.PidsLimit, 128);
  assert.ok(engine.requests.some((item) => item.path.endsWith('/update')));
  assert.equal(
    (first.Labels as Record<string, string>)['com.initpad.allocation.id'],
    PAYLOAD.allocationId,
  );
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
  assert.equal(host.NetworkMode, workloadNetworkName(managed));
  assert.deepEqual((host.PortBindings as Record<string, unknown>)['80/tcp'], [
    { HostIp: '127.0.0.1', HostPort: '' },
  ]);
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
  const secondStatus = await lifecycle.deploy(
    second,
    'job-managed-b',
    new AbortController().signal,
  );

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

test('the proxy gets a stable explicit host port that skips used ports and conflicts', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine, { range: { first: 40_000, last: 40_002 } });
  engine.seedForeign('someone-else');
  engine.containers.get('foreign-1')!.NetworkSettings.Ports['80/tcp'] = [{ HostPort: '40000' }];
  engine.occupyOutsideDocker(40_001);

  const status = await lifecycle.deploy(PAYLOAD, 'job-1', new AbortController().signal);

  // 40000 is used by a running container, 40001 by a host process: 40002 wins.
  assert.equal(status.hostPort, 40_002);
  const proxy = [...engine.containers.values()].find(
    (item) => item.Config.Labels['com.initpad.role'] === 'proxy',
  )!;
  assert.equal(proxy.Config.Labels['com.initpad.host-port'], '40002');
  // The conflicting attempt was cleaned up; the foreign container, revision and proxy remain.
  assert.equal(engine.containers.size, 3);
});

test('a candidate whose random health port is taken outside Docker is recreated', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  engine.conflictNextStarts(2);

  const status = await lifecycle.deploy(PAYLOAD, 'job-1', new AbortController().signal);

  assert.equal(status.state, 'running');
  // Only the published revision and its proxy remain, the failed attempts are gone.
  assert.equal(engine.containers.size, 2);
  assert.ok([...engine.containers.values()].every((item) => !item.name.includes('-next-')));
});

test('a candidate health failure names the URL, last status and the log tail', async () => {
  const engine = fakeEngine(true);
  let probes = 0;
  const lifecycle = new DockerLifecycle(
    'target-1',
    'tcp://docker:2375',
    engine.transport,
    'docker',
    async () => {
      probes += 1;
      return new Response('starting', { status: 503 });
    },
    1_200,
  );
  const started = Date.now();

  await assert.rejects(
    lifecycle.deploy(PAYLOAD, 'job-1', new AbortController().signal),
    (error: Error) => {
      assert.match(
        error.message,
        /^Candidate workload failed its health check: GET http:\/\/docker:\d+\/ returned HTTP 503 after 1 s; last log: bounded/,
      );
      return true;
    },
  );
  // Budget-based, not a fixed attempt count: it waited for the configured time.
  assert.ok(Date.now() - started >= 700);
  assert.ok(probes >= 2);
  assert.equal(engine.containers.size, 0);
});

test('reads the health budget and port range from the Agent environment', () => {
  assert.equal(healthTimeoutFromEnv(undefined), 60_000);
  assert.equal(healthTimeoutFromEnv('180'), 180_000);
  assert.equal(healthTimeoutFromEnv('1'), 5_000);
  assert.deepEqual(directPortRangeFromEnv(undefined), { first: 30_000, last: 32_767 });
  assert.deepEqual(directPortRangeFromEnv('20000-20100'), { first: 20_000, last: 20_100 });
  assert.deepEqual(directPortRangeFromEnv('80-90'), { first: 30_000, last: 32_767 });
});

test('a direct-port redeploy removes the replaced project image', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  const first = {
    ...PAYLOAD,
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/acme/api:${'a'.repeat(40)}`,
    configFingerprint: 'b'.repeat(64),
  };
  const second = {
    ...first,
    revision: 'c'.repeat(40),
    imageRef: `registry.test/acme/api:${'c'.repeat(40)}`,
  };

  await lifecycle.deploy(first, 'job-1', new AbortController().signal);
  await lifecycle.deploy(second, 'job-2', new AbortController().signal);

  const removed = engine.requests
    .filter((request) => request.method === 'DELETE' && request.path.startsWith('/images/'))
    .map((request) => decodeURIComponent(request.path));
  assert.equal(removed.length, 1);
  assert.ok(removed[0].startsWith(`/images/${first.imageRef}?`));
});

function proxyOf(engine: ReturnType<typeof fakeEngine>) {
  return [...engine.containers.values()].find(
    (item) => item.Config.Labels['com.initpad.role'] === 'proxy',
  );
}

test('the proxy image pin equals the gateway image pin in install.sh', () => {
  const install = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  const match = /^CADDY_IMAGE='([^']+)'$/m.exec(install);
  assert.ok(match, 'install.sh defines CADDY_IMAGE');
  assert.equal(DIRECT_PROXY_IMAGE, match[1]);
  assert.equal(directProxyImageFromEnv(undefined), DIRECT_PROXY_IMAGE);
  assert.equal(
    directProxyImageFromEnv(`registry.test/mirror/caddy@sha256:${'b'.repeat(64)}`),
    `registry.test/mirror/caddy@sha256:${'b'.repeat(64)}`,
  );
  assert.throws(() => directProxyImageFromEnv('caddy:2-alpine'), /pinned by a sha256 digest/);
});

test('a first direct deploy creates a hardened proxy on an allocated port', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);

  const status = await lifecycle.deploy(PAYLOAD, 'job-1', new AbortController().signal);

  const proxy = proxyOf(engine)!;
  assert.ok(proxy.State.Running);
  assert.equal(proxy.name, `${workloadContainerName(PAYLOAD)}-proxy`);
  const port = Number(proxy.Config.Labels['com.initpad.host-port']);
  assert.ok(port >= 30_000 && port <= 32_767);
  assert.equal(status.hostPort, port);
  assert.equal(proxy.Config.Labels['com.initpad.proxy-upstream'], 'initpad-active:80');
  // The revision answers under the short alias, its long name is never resolved.
  const revision = [...engine.containers.values()].find(
    (item) => item.name === workloadContainerName(PAYLOAD),
  )!;
  assert.deepEqual(revision.NetworkSettings.Networks?.[workloadNetworkName(PAYLOAD)], {
    Aliases: ['initpad-active'],
  });
  const [candidateBody, proxyBody] = engine.createdBodies;
  const revisionHost = candidateBody.HostConfig as Record<string, unknown>;
  assert.deepEqual((revisionHost.PortBindings as Record<string, unknown>)['80/tcp'], [
    { HostIp: '127.0.0.1', HostPort: '' },
  ]);
  assert.equal(
    (candidateBody.Labels as Record<string, string>)['com.initpad.host-port'],
    undefined,
  );
  const host = proxyBody.HostConfig as Record<string, unknown>;
  assert.equal(proxyBody.Image, DIRECT_PROXY_IMAGE);
  assert.deepEqual(proxyBody.Entrypoint, ['/bin/sh', '-ec']);
  assert.match(String((proxyBody.Cmd as string[])[0]), /dynamic a[\s\S]*exec caddy run/);
  assert.deepEqual(proxyBody.Env, ['UPSTREAM_HOST=initpad-active', 'UPSTREAM_PORT=80']);
  assert.equal(host.NetworkMode, workloadNetworkName(PAYLOAD));
  assert.deepEqual((host.PortBindings as Record<string, unknown>)['8080/tcp'], [
    { HostIp: '0.0.0.0', HostPort: String(port) },
  ]);
  assert.equal(host.ReadonlyRootfs, true);
  assert.deepEqual(Object.keys(host.Tmpfs as object).sort(), ['/config', '/data', '/tmp']);
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.CapAdd, ['NET_BIND_SERVICE']);
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
  assert.deepEqual(host.RestartPolicy, { Name: 'unless-stopped' });
  assert.equal(host.Memory, 64 * 1024 * 1024);
  assert.equal(host.NanoCpus, 250_000_000);
  assert.equal(host.PidsLimit, 64);
});

test('a direct redeploy keeps the proxy and port and retires the previous revision', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  const first = { ...PAYLOAD, revision: 'rev-a' };
  const second = { ...PAYLOAD, revision: 'rev-b' };

  const firstStatus = await lifecycle.deploy(first, 'job-a', new AbortController().signal);
  const proxyId = proxyOf(engine)!.Id;
  const secondStatus = await lifecycle.deploy(second, 'job-b', new AbortController().signal);

  assert.equal(secondStatus.hostPort, firstStatus.hostPort);
  assert.equal(proxyOf(engine)!.Id, proxyId);
  assert.equal(engine.containers.size, 2);
  assert.equal(secondStatus.revision, 'rev-b');
  assert.ok(engine.requests.some((item) => item.path.includes('-retiring-rev-a')));
  assert.ok(engine.requests.some((item) => item.path.includes('/stop?t=10')));
  assert.ok([...engine.containers.values()].every((item) => !item.name.includes('-retiring-')));
  // Same revision again is a no-op for the revision and keeps the proxy.
  const again = await lifecycle.deploy(second, 'job-b2', new AbortController().signal);
  assert.equal(again.hostPort, firstStatus.hostPort);
  assert.equal(engine.containers.size, 2);
});

test('migrating a legacy direct container reuses its public port for the proxy', async () => {
  const engine = fakeEngine(true);
  const previous = { ...PAYLOAD, revision: 'previous' };
  const desired = { ...PAYLOAD, revision: 'replacement' };
  engine.seedOwned(legacyWorkloadContainerName(previous), previous, '31234');
  engine.containers.get('owned-legacy-1')!.Config.Labels['com.initpad.host-port'] = '31234';
  const lifecycle = lifecycleFor(engine);

  const status = await lifecycle.deploy(desired, 'job-new', new AbortController().signal);

  assert.equal(status.hostPort, 31_234);
  assert.equal(engine.containers.has('owned-legacy-1'), false);
  assert.equal(proxyOf(engine)!.Config.Labels['com.initpad.host-port'], '31234');
  assert.ok(proxyOf(engine)!.State.Running);
});

test('a legacy direct container reports its own port and is left alone by a no-op deploy', async () => {
  const engine = fakeEngine(true);
  engine.seedOwned(workloadContainerName(PAYLOAD), PAYLOAD, '31500');
  const lifecycle = lifecycleFor(engine);

  const status = await lifecycle.deploy(PAYLOAD, 'job-noop', new AbortController().signal);
  assert.equal(status.hostPort, 31_500);
  assert.equal(proxyOf(engine), undefined);
  assert.equal(engine.containers.has('owned-legacy-1'), true);
});

test('a changed container port recreates the proxy on the same host port', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  const first = { ...PAYLOAD, revision: 'rev-a' };
  const second = { ...PAYLOAD, revision: 'rev-b', containerPort: 3000 };

  const firstStatus = await lifecycle.deploy(first, 'job-a', new AbortController().signal);
  const oldProxyId = proxyOf(engine)!.Id;
  const secondStatus = await lifecycle.deploy(second, 'job-b', new AbortController().signal);

  const proxy = proxyOf(engine)!;
  assert.notEqual(proxy.Id, oldProxyId);
  assert.equal(secondStatus.hostPort, firstStatus.hostPort);
  assert.equal(proxy.Config.Labels['com.initpad.host-port'], String(firstStatus.hostPort));
  assert.equal(proxy.Config.Labels['com.initpad.proxy-upstream'], 'initpad-active:3000');
  assert.equal(engine.containers.size, 2);
});

test('stop, start and remove handle the proxy and keep the port while stopped', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  const signal = new AbortController().signal;
  const deployed = await lifecycle.deploy(PAYLOAD, 'job-1', signal);

  await lifecycle.stop(PAYLOAD, signal);
  assert.ok([...engine.containers.values()].every((item) => !item.State.Running));
  const stopped = await lifecycle.status(PAYLOAD, signal);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.hostPort, deployed.hostPort);

  await lifecycle.start(PAYLOAD, signal);
  assert.ok([...engine.containers.values()].every((item) => item.State.Running));
  assert.equal((await lifecycle.status(PAYLOAD, signal)).hostPort, deployed.hostPort);

  await lifecycle.removeProject(PAYLOAD, signal);
  assert.equal(engine.containers.size, 0);
  assert.equal(engine.networkPresent(), false);
});

test('a revision behind the proxy with a public health bind is not treated as legacy', async () => {
  const previous = process.env.INITPAD_AGENT_MANAGED_HEALTH_BIND;
  process.env.INITPAD_AGENT_MANAGED_HEALTH_BIND = '0.0.0.0';
  try {
    const engine = fakeEngine(true);
    const lifecycle = lifecycleFor(engine);
    const signal = new AbortController().signal;
    const deployed = await lifecycle.deploy(PAYLOAD, 'job-1', signal);
    const proxy = proxyOf(engine)!;
    engine.containers.delete(proxy.Id);

    await lifecycle.stop(PAYLOAD, signal);
    await lifecycle.start(PAYLOAD, signal);

    assert.ok(proxyOf(engine), 'start must recreate the missing proxy');
    assert.equal((await lifecycle.status(PAYLOAD, signal)).hostPort, deployed.hostPort);
  } finally {
    if (previous === undefined) delete process.env.INITPAD_AGENT_MANAGED_HEALTH_BIND;
    else process.env.INITPAD_AGENT_MANAGED_HEALTH_BIND = previous;
  }
});

test('removal also deletes retiring leftovers of an interrupted switch', async () => {
  const engine = fakeEngine(true);
  const lifecycle = lifecycleFor(engine);
  const signal = new AbortController().signal;
  const previous = { ...PAYLOAD, revision: 'rev-a' };
  await lifecycle.deploy(previous, 'job-a', signal);
  engine.seedOwned(`${workloadContainerName(PAYLOAD)}-retiring-rev-z`, previous, '31999');

  await lifecycle.remove(PAYLOAD, signal);

  assert.equal(engine.containers.size, 0);
});

test('a failed proxy pull leaves no candidate or container behind', async () => {
  const engine = fakeEngine(true);
  engine.failProxyPull();
  const lifecycle = lifecycleFor(engine);

  await assert.rejects(
    lifecycle.deploy(PAYLOAD, 'job-1', new AbortController().signal),
    /Cannot pull the stable-port proxy image/,
  );
  assert.equal(engine.containers.size, 0);
  assert.equal(engine.createdBodies.length, 0);
  assert.equal(engine.networkPresent(), false);
});
