import assert from 'node:assert/strict';
import test from 'node:test';
import { DockerLifecycle, parseLifecyclePayload } from './docker-lifecycle.js';
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
  State: { Running: boolean };
  NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }>> };
}

function fakeEngine(initialImagePresent = false) {
  let imagePresent = initialImagePresent;
  let networkPresent = false;
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
        State: { Running: false },
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
      if (input.method === 'GET' && action === '/logs') return response(200, 'bounded log');
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
    seedForeign: (name: string) => {
      containers.set('foreign-1', {
        Id: 'foreign-1',
        name,
        Config: { Image: IMAGE_REF, Labels: {} },
        State: { Running: true },
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
  assert.deepEqual(host.CapDrop, ['ALL']);
  assert.deepEqual(host.CapAdd, ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID', 'NET_BIND_SERVICE']);
  assert.deepEqual(host.SecurityOpt, ['no-new-privileges']);
  assert.deepEqual(host.RestartPolicy, { Name: 'no' });
  assert.ok(engine.requests.some((item) => item.path.endsWith('/update')));
  assert.equal((first.Labels as Record<string, string>)['com.initpad.allocation.id'], PAYLOAD.allocationId);
  assert.equal((first.Labels as Record<string, string>)['com.initpad.target'], 'target-1');
});
