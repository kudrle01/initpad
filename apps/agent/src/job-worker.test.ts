import assert from 'node:assert/strict';
import test from 'node:test';
import { executeClaimedJob } from './job-worker.js';
import type { AgentJobClient, JobTiming } from './job-worker.js';
import type { AgentJobClaim, AgentJobSummary } from './types.js';

const START = Date.parse('2026-08-12T09:00:00.000Z');
const LEASE = `initpad_lease_${'a'.repeat(43)}`;

function claim(overrides: Partial<AgentJobClaim> = {}): AgentJobClaim {
  return {
    id: 'job-1',
    targetId: 'target-1',
    kind: 'probe',
    protocolVersion: 1,
    payload: { durationSeconds: 35 },
    attempt: 1,
    leaseToken: LEASE,
    leaseExpiresAt: new Date(START + 30_000).toISOString(),
    ...overrides,
  };
}

function summary(
  input: {
    status?: string;
    sequence?: number;
    percent?: number;
  } = {},
): AgentJobSummary {
  return {
    id: 'job-1',
    kind: 'probe',
    status: input.status ?? 'leased',
    attempt: 1,
    progressSequence: input.sequence ?? 0,
    progressPercent: input.percent ?? 0,
    progressStage: 'working',
    message: null,
    resultCode: null,
    createdAt: new Date(START).toISOString(),
    leasedAt: new Date(START).toISOString(),
    leaseExpiresAt: new Date(START + 30_000).toISOString(),
    finishedAt: null,
  };
}

test('renews a long probe and retries lost progress/completion responses idempotently', async () => {
  let now = START;
  const timing: JobTiming = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    renewEveryMs: 10_000,
    progressEveryMs: 5_000,
  };
  const renewals: string[] = [];
  const progress: Array<{ sequence: number; percent: number }> = [];
  const completions: Array<{ status: string; message: string }> = [];
  let loseFirstProgressResponse = true;
  let loseFirstCompletionResponse = true;
  const client: AgentJobClient = {
    renew: async (_jobId, leaseToken) => {
      renewals.push(leaseToken);
      return { leaseExpiresAt: new Date(now + 30_000).toISOString() };
    },
    progress: async (_jobId, input) => {
      progress.push({ sequence: input.sequence, percent: input.percent });
      if (loseFirstProgressResponse) {
        loseFirstProgressResponse = false;
        throw new Error('response lost after server accepted progress');
      }
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async (_jobId, input) => {
      completions.push({ status: input.status, message: input.message });
      if (loseFirstCompletionResponse) {
        loseFirstCompletionResponse = false;
        throw new Error('response lost after server accepted completion');
      }
      return summary({ status: input.status, percent: 100 });
    },
  };

  await executeClaimedJob(claim(), new AbortController().signal, client, { timing });

  assert.ok(renewals.length >= 3);
  assert.equal(
    renewals.every((token) => token === LEASE),
    true,
  );
  assert.deepEqual(
    progress.slice(0, 2).map((item) => item.sequence),
    [1, 1],
  );
  const distinctSequences = [...new Set(progress.map((item) => item.sequence))];
  assert.deepEqual(
    distinctSequences,
    [...distinctSequences].sort((a, b) => a - b),
  );
  assert.equal(progress.at(-1)?.percent, 99);
  assert.equal(completions.length, 2);
  assert.deepEqual(completions[0], completions[1]);
  assert.equal(completions[1]?.status, 'succeeded');
});

test('aborts deployment without completion when lease renewal cannot reach the control plane', async () => {
  let now = START;
  let releaseRenewal: (() => void) | undefined;
  let workloadStarted: (() => void) | undefined;
  const workloadReady = new Promise<void>((resolve) => {
    workloadStarted = resolve;
  });
  const timing: JobTiming = {
    now: () => now,
    sleep: async (_ms, signal) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          signal.removeEventListener('abort', finish);
          resolve();
        };
        releaseRenewal = () => {
          now = START + 30_000;
          finish();
        };
        signal.addEventListener('abort', finish, { once: true });
      }),
    renewEveryMs: 10_000,
    progressEveryMs: 5_000,
  };
  let completions = 0;
  const bytes = Buffer.from('archive');
  const client: AgentJobClient = {
    renew: async () => {
      throw new Error('control plane unavailable');
    },
    progress: async () => {
      throw new Error('progress must stop with the lease');
    },
    complete: async () => {
      completions += 1;
      return summary({ status: 'succeeded' });
    },
    downloadArtifact: async () => new Response(bytes),
  };
  const execution = executeClaimedJob(
    claim({
      kind: 'deploy',
      payload: {
        allocationId: '123e4567-e89b-42d3-a456-426614174000',
        namespace: 'team-alpha',
        projectSlug: 'alice-api',
        environment: 'dev',
        revision: 'a'.repeat(40),
        imageRef: `registry.test/alice/api:${'a'.repeat(40)}`,
        containerPort: 3000,
        healthPath: '/health',
        routingMode: 'direct-port',
        configFingerprint: 'b'.repeat(64),
      },
      delivery: {
        artifact: {
          path: '/api/agent/jobs/job-1/artifact',
          sha256: 'd'.repeat(64),
          sizeBytes: bytes.length,
        },
        envVars: {},
      },
    }),
    new AbortController().signal,
    client,
    {
      timing,
      lifecycle: {
        acceptance: async () => undefined,
        deployProject: async (_payload, _delivery, _archive, _jobId, signal) => {
          workloadStarted?.();
          await new Promise<void>((_resolve, reject) => {
            const aborted = () => reject(new Error('deployment aborted after lease loss'));
            if (signal.aborted) aborted();
            else signal.addEventListener('abort', aborted, { once: true });
          });
          throw new Error('unreachable');
        },
      },
    },
  );

  await workloadReady;
  assert.ok(releaseRenewal);
  releaseRenewal();
  await assert.rejects(execution, /control plane unavailable/);
  assert.equal(completions, 0);
});

test('fails a future or unknown job without interpreting its payload as a command', async () => {
  const calls: string[] = [];
  const client: AgentJobClient = {
    renew: async () => {
      throw new Error('must not renew');
    },
    progress: async () => {
      throw new Error('must not report progress');
    },
    complete: async (_jobId, input) => {
      calls.push(`${input.status}:${input.resultCode}`);
      return summary({ status: input.status });
    },
  };

  await executeClaimedJob(
    claim({ kind: 'shell', payload: { command: 'rm -rf /' } }),
    new AbortController().signal,
    client,
  );

  assert.deepEqual(calls, ['failed:unsupported_job']);
});

test('runs the fixed gateway preflight interface without accepting an admin URL', async () => {
  const progress: number[] = [];
  const completions: string[] = [];
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) => {
      progress.push(input.percent);
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async (_jobId, input) => {
      completions.push(`${input.status}:${input.resultCode}`);
      return summary({ status: input.status });
    },
  };

  await executeClaimedJob(
    claim({
      kind: 'gateway-preflight',
      payload: { adapter: 'caddy', publicUrl: 'https://apps.example.test' },
    }),
    new AbortController().signal,
    client,
    {
      gateway: {
        run: async (_payload, _signal, report) => {
          await report({ percent: 15, stage: 'working', message: 'DNS ready' });
          await report({ percent: 80, stage: 'verifying', message: 'Caddy ready' });
        },
      },
    },
  );

  assert.deepEqual(progress, [15, 80]);
  assert.deepEqual(completions, ['succeeded:ok']);
});

test('runs the bounded gateway route interface and reports its generation', async () => {
  const progress: number[] = [];
  const completions: Array<{ status: string; message: string }> = [];
  const payload = {
    adapter: 'caddy',
    routeId: '123e4567-e89b-42d3-a456-426614174000',
    generation: 4,
    desiredState: 'active',
    hostname: 'portal-dev-a1b2c3d4e5f6.team.apps.example.test',
    allocationId: '223e4567-e89b-42d3-a456-426614174000',
    namespace: 'team-alpha',
    projectSlug: 'customer-portal',
    environment: 'dev',
    revision: 'abc123',
    containerPort: 8080,
    healthPath: '/health',
    workloadSlot: 'a1b2c3d4e5f6',
    activation: 'deploy',
  };
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) => {
      progress.push(input.percent);
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async (_jobId, input) => {
      completions.push({ status: input.status, message: input.message });
      return summary({ status: input.status });
    },
  };

  await executeClaimedJob(
    claim({ kind: 'gateway-route', payload }),
    new AbortController().signal,
    client,
    {
      gatewayRoute: {
        run: async (_payload, _signal, report) => {
          await report({ percent: 60, stage: 'working', message: 'Applying route' });
          await report({ percent: 95, stage: 'verifying', message: 'Verifying route' });
          return { cleanupComplete: true };
        },
      },
    },
  );

  assert.deepEqual(progress, [60, 95]);
  assert.deepEqual(completions, [
    {
      status: 'succeeded',
      message: 'Gateway route generation 4 reconciled to active',
    },
  ]);
});

test('runs only the explicit Docker lifecycle acceptance interface', async () => {
  const progress: number[] = [];
  const completions: string[] = [];
  const lifecycleCalls: string[] = [];
  const payload = {
    allocationId: '123e4567-e89b-42d3-a456-426614174000',
    namespace: 'team-alpha',
    projectSlug: 'agent-lifecycle-check',
    environment: 'diagnostic',
    revision: 'probe-a',
    imageRef: `nginx@sha256:${'a'.repeat(64)}`,
    containerPort: 80,
    healthPath: '/',
  };
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) => {
      progress.push(input.percent);
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async (_jobId, input) => {
      completions.push(`${input.status}:${input.resultCode}`);
      return summary({ status: input.status, percent: input.status === 'succeeded' ? 100 : 0 });
    },
  };

  await executeClaimedJob(
    claim({ kind: 'lifecycle-test', payload }),
    new AbortController().signal,
    client,
    {
      lifecycle: {
        acceptance: async (received, jobId, _signal, report) => {
          lifecycleCalls.push(`${jobId}:${(received as typeof payload).namespace}`);
          await report({ percent: 25, stage: 'working', message: 'Created' });
          await report({ percent: 90, stage: 'verifying', message: 'Verified' });
        },
      },
    },
  );

  assert.deepEqual(lifecycleCalls, ['job-1:team-alpha']);
  assert.deepEqual(progress, [25, 90]);
  assert.deepEqual(completions, ['succeeded:ok']);
});

test('collects project diagnostics through the fixed bounded Agent interface', async () => {
  const payload = {
    allocationId: '123e4567-e89b-42d3-a456-426614174000',
    namespace: 'team-alpha',
    projectSlug: 'alice-api',
    environment: 'dev',
    revision: 'a'.repeat(40),
    containerPort: 3000,
    healthPath: '/health',
    routingMode: 'managed-gateway' as const,
  };
  const completions: Array<Record<string, unknown>> = [];
  const progress: number[] = [];
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) => {
      progress.push(input.percent);
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async (_jobId, input) => {
      completions.push(input as unknown as Record<string, unknown>);
      return summary({ status: input.status, percent: 100 });
    },
  };

  await executeClaimedJob(claim({ kind: 'logs', payload }), new AbortController().signal, client, {
    lifecycle: {
      acceptance: async () => undefined,
      diagnostics: async () => ({
        state: 'stopped',
        revision: payload.revision,
        workloadSlot: 'a1b2c3d4e5f6',
        exitCode: 137,
        health: 'not-running',
        logs: 'bounded application tail',
      }),
    },
  });

  assert.deepEqual(progress, [20, 90]);
  assert.deepEqual(completions, [
    {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Workload is stopped and not-running',
      resultCode: 'ok',
      result: {
        state: 'stopped',
        revision: payload.revision,
        workloadSlot: 'a1b2c3d4e5f6',
      },
      diagnostic: {
        exitCode: 137,
        health: 'not-running',
        logs: 'bounded application tail',
      },
    },
  ]);
});

test('downloads and runs a project artifact without exposing config to progress or completion', async () => {
  const bytes = Buffer.from('archive');
  const digest = 'd'.repeat(64);
  const payload = {
    allocationId: '123e4567-e89b-42d3-a456-426614174000',
    namespace: 'team-alpha',
    projectSlug: 'alice-api',
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/alice/api:${'a'.repeat(40)}`,
    containerPort: 3000,
    healthPath: '/health',
    configFingerprint: 'b'.repeat(64),
  };
  const delivery = {
    artifact: {
      path: '/api/agent/jobs/job-1/artifact',
      sha256: digest,
      sizeBytes: bytes.length,
    },
    envVars: { DATABASE_PASSWORD: 'top-secret' },
  };
  const progressMessages: string[] = [];
  const completions: Array<Record<string, unknown>> = [];
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) => {
      progressMessages.push(input.message);
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async (_jobId, input) => {
      completions.push(input as unknown as Record<string, unknown>);
      return summary({ status: input.status, percent: 100 });
    },
    downloadArtifact: async (_jobId, leaseToken, path) => {
      assert.equal(leaseToken, LEASE);
      assert.equal(path, delivery.artifact.path);
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-length': String(bytes.length),
          'x-initpad-artifact-sha256': digest,
        },
      });
    },
  };
  const lifecycleCalls: unknown[] = [];

  await executeClaimedJob(
    claim({ kind: 'deploy', payload, delivery }),
    new AbortController().signal,
    client,
    {
      lifecycle: {
        acceptance: async () => undefined,
        deployProject: async (
          receivedPayload,
          receivedDelivery,
          archive,
          _jobId,
          _signal,
          report,
        ) => {
          lifecycleCalls.push(receivedPayload, receivedDelivery);
          const chunks: Buffer[] = [];
          for await (const chunk of archive) chunks.push(Buffer.from(chunk));
          assert.deepEqual(Buffer.concat(chunks), bytes);
          await report({ percent: 50, stage: 'working', message: 'Creating workload' });
          return { state: 'running', revision: payload.revision, hostPort: 32780 };
        },
      },
    },
  );

  assert.equal(lifecycleCalls.length, 2);
  assert.deepEqual(progressMessages, ['Creating workload']);
  assert.deepEqual(completions, [
    {
      leaseToken: LEASE,
      status: 'succeeded',
      message: 'Deployment is running and healthy',
      resultCode: 'ok',
      result: { state: 'running', revision: payload.revision, hostPort: 32780 },
    },
  ]);
  assert.equal(JSON.stringify(progressMessages).includes('top-secret'), false);
  assert.equal(JSON.stringify(completions).includes('top-secret'), false);
});

test('executes only explicit project stop/start/remove lifecycle methods', async () => {
  const payload = {
    allocationId: '123e4567-e89b-42d3-a456-426614174000',
    namespace: 'team-alpha',
    projectSlug: 'alice-api',
    environment: 'dev',
    revision: 'a'.repeat(40),
    imageRef: `registry.test/alice/api:${'a'.repeat(40)}`,
    containerPort: 3000,
    healthPath: '/health',
    configFingerprint: 'b'.repeat(64),
  };
  for (const kind of ['stop', 'start', 'remove'] as const) {
    const calls: string[] = [];
    const completions: Array<Record<string, unknown>> = [];
    const client: AgentJobClient = {
      renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
      progress: async (_jobId, input) =>
        summary({ sequence: input.sequence, percent: input.percent }),
      complete: async (_jobId, input) => {
        completions.push(input as unknown as Record<string, unknown>);
        return summary({ status: input.status });
      },
    };
    await executeClaimedJob(claim({ kind, payload }), new AbortController().signal, client, {
      lifecycle: {
        acceptance: async () => undefined,
        start: async () => {
          calls.push('start');
        },
        stop: async () => {
          calls.push('stop');
        },
        removeProject: async () => {
          calls.push('remove');
        },
        status: async () =>
          kind === 'remove'
            ? { state: 'missing' }
            : {
                state: kind === 'stop' ? 'stopped' : 'running',
                revision: payload.revision,
                hostPort: 32780,
              },
      },
    });
    assert.deepEqual(calls, [kind]);
    assert.equal(completions[0]?.status, 'succeeded');
    assert.deepEqual(
      (completions[0]?.result as Record<string, unknown>).state,
      kind === 'remove' ? 'missing' : kind === 'stop' ? 'stopped' : 'running',
    );
  }
});

test('hands an Agent update to the local supervisor without completing it in the old process', async () => {
  const progress: Array<{ sequence: number; percent: number }> = [];
  let completions = 0;
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) => {
      progress.push({ sequence: input.sequence, percent: input.percent });
      return summary({ sequence: input.sequence, percent: input.percent });
    },
    complete: async () => {
      completions += 1;
      return summary({ status: 'succeeded' });
    },
  };

  const result = await executeClaimedJob(
    claim({ kind: 'agent-update', payload: { signed: 'server-selected' } }),
    new AbortController().signal,
    client,
    {
      agentUpdate: {
        handoff: async (_job, _signal, report) => {
          await report({ percent: 8, stage: 'verifying', message: 'Verifying release' });
          await report({ percent: 42, stage: 'working', message: 'Starting supervisor' });
        },
      },
    },
  );

  assert.equal(result, 'handed-off');
  assert.deepEqual(progress, [
    { sequence: 1, percent: 8 },
    { sequence: 2, percent: 42 },
  ]);
  assert.equal(completions, 0);
});

test('fails an Agent update job when verification or handoff fails before replacement', async () => {
  const completions: Array<Record<string, unknown>> = [];
  const client: AgentJobClient = {
    renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() }),
    progress: async (_jobId, input) =>
      summary({ sequence: input.sequence, percent: input.percent }),
    complete: async (_jobId, input) => {
      completions.push(input as unknown as Record<string, unknown>);
      return summary({ status: input.status });
    },
  };

  await executeClaimedJob(
    claim({ kind: 'agent-update', payload: { image: 'mutable:latest' } }),
    new AbortController().signal,
    client,
    {
      agentUpdate: {
        handoff: async () => {
          throw new Error('Agent update signature is invalid');
        },
      },
    },
  );

  assert.deepEqual(completions, [
    {
      leaseToken: LEASE,
      status: 'failed',
      message: 'Agent update signature is invalid',
      resultCode: 'agent_update_failed',
    },
  ]);
});
