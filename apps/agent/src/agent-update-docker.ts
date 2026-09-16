import { dockerError, dockerHttpRequest } from './docker-http.js';
import type { DockerHttpRequest, DockerHttpResponse, DockerTransport } from './docker-http.js';
import type { AgentUpdatePlan } from './release-update.js';

const AGENT_NAME = 'initpad-agent';
const PREVIOUS_NAME = `${AGENT_NAME}-previous`;
const IMMUTABLE_IMAGE = /^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$/;
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/;
const SAFE_ENV = /^(DOCKER_HOST|INITPAD_AGENT_[A-Z0-9_]+|NODE_EXTRA_CA_CERTS)=([^\0\r\n]{0,2048})$/;

interface MountInspect {
  Type?: string;
  Source?: string;
  Destination?: string;
  RW?: boolean;
}

interface ContainerInspect {
  Id?: string;
  Config?: {
    Image?: string;
    Env?: string[];
    Labels?: Record<string, string>;
  };
  State?: {
    Running?: boolean;
    ExitCode?: number;
    Health?: { Status?: string };
  };
  Mounts?: MountInspect[];
}

interface AgentRuntime {
  currentImage: string;
  env: string[];
  binds: string[];
}

function json<T>(response: DockerHttpResponse, action: string): T {
  if (response.statusCode < 200 || response.statusCode >= 300) throw dockerError(response, action);
  try {
    return JSON.parse(response.body.toString('utf8')) as T;
  } catch {
    throw new Error(`Docker API returned invalid JSON for ${action}`);
  }
}

function allowedMountDestinations(env: string[]): Set<string> {
  const destinations = new Set(['/var/run/docker.sock', '/var/lib/initpad-agent']);
  for (const item of env) {
    const [key, ...parts] = item.split('=');
    const value = parts.join('=');
    if (key === 'NODE_EXTRA_CA_CERTS' && SAFE_PATH.test(value)) destinations.add(value);
    if (key === 'INITPAD_AGENT_GATEWAY_ADMIN_SOCKET' && SAFE_PATH.test(value)) {
      destinations.add(value.slice(0, value.lastIndexOf('/')) || '/');
    }
  }
  return destinations;
}

function runtimeFromInspect(container: ContainerInspect, targetId: string): AgentRuntime {
  if (
    !container.Id ||
    container.Config?.Labels?.['com.initpad.agent'] !== 'true' ||
    !container.Config.Image ||
    !IMMUTABLE_IMAGE.test(container.Config.Image)
  ) {
    throw new Error('The running InitPad Agent container is not a verified managed release');
  }
  const env = (container.Config.Env ?? []).filter((item) => SAFE_ENV.test(item));
  if (
    (container.Config.Env ?? []).some(
      (item) => item.startsWith('INITPAD_AGENT_') && !SAFE_ENV.test(item),
    )
  ) {
    throw new Error('The running InitPad Agent has an unsafe environment value');
  }
  const allowed = allowedMountDestinations(env);
  const mounts = container.Mounts ?? [];
  const selected = mounts.filter((mount) => mount.Destination && allowed.has(mount.Destination));
  if (selected.length !== mounts.length) {
    throw new Error('The running InitPad Agent has an unsupported mount');
  }
  const binds = selected.map((mount) => {
    if (
      mount.Type !== 'bind' ||
      !mount.Source ||
      !mount.Destination ||
      !SAFE_PATH.test(mount.Source) ||
      !SAFE_PATH.test(mount.Destination)
    ) {
      throw new Error('The running InitPad Agent has an invalid bind mount');
    }
    return `${mount.Source}:${mount.Destination}${mount.RW === false ? ':ro' : ''}`;
  });
  for (const required of ['/var/run/docker.sock', '/var/lib/initpad-agent']) {
    if (!selected.some((mount) => mount.Destination === required && mount.RW !== false)) {
      throw new Error(`The running InitPad Agent is missing required mount ${required}`);
    }
  }
  const labeledTarget = container.Config.Labels?.['com.initpad.target'];
  if (labeledTarget && labeledTarget !== targetId) {
    throw new Error('The running InitPad Agent belongs to a different target');
  }
  return { currentImage: container.Config.Image, env, binds };
}

function createBody(
  runtime: AgentRuntime,
  image: string,
  command: string[],
  labels: Record<string, string>,
  autoRemove: boolean,
) {
  if (!IMMUTABLE_IMAGE.test(image)) throw new Error('Agent update image is not immutable');
  return {
    Image: image,
    Cmd: command,
    Env: runtime.env,
    Labels: labels,
    Healthcheck:
      command[0] === 'run'
        ? {
            Test: ['CMD', 'node', '/app/dist/cli.js', 'health'],
            Interval: 30_000_000_000,
            Timeout: 10_000_000_000,
            Retries: 3,
            StartPeriod: 10_000_000_000,
          }
        : undefined,
    HostConfig: {
      Binds: runtime.binds,
      NetworkMode: 'host',
      AutoRemove: autoRemove,
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'size=16m,mode=1777' },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Memory: 384 * 1024 * 1024,
      NanoCpus: 500_000_000,
      PidsLimit: 128,
      RestartPolicy: command[0] === 'run' ? { Name: 'unless-stopped' } : { Name: 'no' },
    },
  };
}

export class AgentUpdateDocker {
  constructor(
    private readonly dockerHost = process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
    private readonly transport: DockerTransport = dockerHttpRequest,
  ) {}

  async launchHelper(plan: AgentUpdatePlan, planPath: string, signal: AbortSignal): Promise<void> {
    const runtime = await this.runtime(plan.targetId, signal);
    const name = `initpad-agent-updater-${plan.jobId.slice(0, 8)}-${plan.attempt}`;
    const created = await this.create(
      name,
      createBody(
        runtime,
        runtime.currentImage,
        ['update-helper', '--plan', planPath],
        {
          'com.initpad.agent.updater': 'true',
          'com.initpad.target': plan.targetId,
          'com.initpad.job': plan.jobId,
        },
        true,
      ),
      signal,
    );
    await this.expect(
      [204, 304],
      { method: 'POST', path: `/containers/${encodeURIComponent(created)}/start`, signal },
      'start Agent updater',
    );
  }

  async apply(
    plan: AgentUpdatePlan,
    signal: AbortSignal,
    checkpoint: () => Promise<void> = () => Promise.resolve(),
  ): Promise<void> {
    const runtime = await this.runtime(plan.targetId, signal);
    const previous = await this.inspect(PREVIOUS_NAME, signal);
    if (previous) throw new Error('A previous Agent update requires manual recovery');

    const candidateName = `initpad-agent-candidate-${plan.jobId.slice(0, 8)}-${plan.attempt}`;
    const candidate = await this.create(
      candidateName,
      createBody(
        runtime,
        plan.image,
        ['once'],
        {
          'com.initpad.agent.candidate': 'true',
          'com.initpad.target': plan.targetId,
          'com.initpad.job': plan.jobId,
        },
        false,
      ),
      signal,
    );
    try {
      await this.expect(
        [204, 304],
        { method: 'POST', path: `/containers/${encodeURIComponent(candidate)}/start`, signal },
        'start Agent update preflight',
      );
      const exitCode = await this.wait(candidate, signal);
      if (exitCode !== 0) throw new Error('The candidate Agent failed its identity preflight');
    } finally {
      await this.remove(candidate, signal).catch(() => undefined);
    }
    await checkpoint();

    let previousParked = false;
    try {
      await this.stop(AGENT_NAME, signal);
      await this.rename(AGENT_NAME, PREVIOUS_NAME, signal);
      previousParked = true;
      const replacement = await this.create(
        AGENT_NAME,
        createBody(
          runtime,
          plan.image,
          ['run'],
          {
            'com.initpad.agent': 'true',
            'com.initpad.target': plan.targetId,
            'com.initpad.agent.version': plan.version,
          },
          false,
        ),
        signal,
      );
      await this.expect(
        [204, 304],
        { method: 'POST', path: `/containers/${encodeURIComponent(replacement)}/start`, signal },
        'start updated Agent',
      );
      await checkpoint();
      await this.execOnce(replacement, signal);
      await checkpoint();
      await this.remove(PREVIOUS_NAME, signal);
    } catch (error) {
      await this.remove(AGENT_NAME, signal).catch(() => undefined);
      if (previousParked) {
        await this.rename(PREVIOUS_NAME, AGENT_NAME, signal).catch(() => undefined);
        await this.expect(
          [204, 304],
          { method: 'POST', path: `/containers/${encodeURIComponent(AGENT_NAME)}/start`, signal },
          'restore previous Agent',
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  private async runtime(targetId: string, signal: AbortSignal): Promise<AgentRuntime> {
    const current = await this.inspect(AGENT_NAME, signal);
    if (!current) throw new Error('The managed InitPad Agent container is missing');
    return runtimeFromInspect(current, targetId);
  }

  private async inspect(name: string, signal: AbortSignal): Promise<ContainerInspect | null> {
    const response = await this.request({
      method: 'GET',
      path: `/containers/${encodeURIComponent(name)}/json`,
      signal,
    });
    if (response.statusCode === 404) return null;
    return json<ContainerInspect>(response, 'inspect Agent container');
  }

  private async create(name: string, body: unknown, signal: AbortSignal): Promise<string> {
    const response = await this.request({
      method: 'POST',
      path: `/containers/create?name=${encodeURIComponent(name)}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const created = json<{ Id?: unknown }>(response, 'create Agent container');
    if (typeof created.Id !== 'string' || !/^[a-f0-9]{12,64}$/.test(created.Id)) {
      throw new Error('Docker returned an invalid Agent container id');
    }
    return created.Id;
  }

  private async stop(name: string, signal: AbortSignal): Promise<void> {
    await this.expect(
      [204, 304],
      { method: 'POST', path: `/containers/${encodeURIComponent(name)}/stop?t=20`, signal },
      'stop Agent',
    );
  }

  private async rename(name: string, next: string, signal: AbortSignal): Promise<void> {
    await this.expect(
      [204],
      {
        method: 'POST',
        path: `/containers/${encodeURIComponent(name)}/rename?name=${encodeURIComponent(next)}`,
        signal,
      },
      'rename Agent container',
    );
  }

  private async remove(name: string, signal: AbortSignal): Promise<void> {
    await this.expect(
      [204, 404],
      {
        method: 'DELETE',
        path: `/containers/${encodeURIComponent(name)}?force=true&v=true`,
        signal,
      },
      'remove Agent container',
    );
  }

  private async wait(id: string, signal: AbortSignal): Promise<number> {
    const response = await this.request({
      method: 'POST',
      path: `/containers/${encodeURIComponent(id)}/wait?condition=not-running`,
      signal,
      timeoutMs: 25_000,
    });
    const result = json<{ StatusCode?: unknown }>(response, 'wait for Agent preflight');
    if (!Number.isInteger(result.StatusCode))
      throw new Error('Docker returned an invalid exit code');
    return Number(result.StatusCode);
  }

  private async execOnce(container: string, signal: AbortSignal): Promise<void> {
    const created = json<{ Id?: unknown }>(
      await this.request({
        method: 'POST',
        path: `/containers/${encodeURIComponent(container)}/exec`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          AttachStdout: true,
          AttachStderr: true,
          Cmd: ['node', '/app/dist/cli.js', 'once'],
        }),
        signal,
      }),
      'create Agent heartbeat verification',
    );
    if (typeof created.Id !== 'string' || !/^[a-f0-9]{12,64}$/.test(created.Id)) {
      throw new Error('Docker returned an invalid Agent exec id');
    }
    await this.expect(
      [200],
      {
        method: 'POST',
        path: `/exec/${encodeURIComponent(created.Id)}/start`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ Detach: false, Tty: false }),
        maxResponseBytes: 64 * 1024,
        timeoutMs: 25_000,
        signal,
      },
      'verify updated Agent heartbeat',
    );
    const inspected = json<{ ExitCode?: unknown; Running?: unknown }>(
      await this.request({
        method: 'GET',
        path: `/exec/${encodeURIComponent(created.Id)}/json`,
        signal,
      }),
      'inspect Agent heartbeat verification',
    );
    if (inspected.Running !== false || inspected.ExitCode !== 0) {
      throw new Error('The updated Agent did not confirm its control-plane heartbeat');
    }
  }

  private request(input: DockerHttpRequest): Promise<DockerHttpResponse> {
    return this.transport(input, this.dockerHost);
  }

  private async expect(
    expected: number[],
    input: DockerHttpRequest,
    action: string,
  ): Promise<void> {
    const response = await this.request(input);
    if (!expected.includes(response.statusCode)) throw dockerError(response, action);
  }
}
