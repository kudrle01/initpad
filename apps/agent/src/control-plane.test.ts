import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimJob,
  completeJob,
  downloadJobArtifact,
  enroll,
  heartbeat,
  renewJobLease,
  reportJobProgress,
} from './control-plane.js';
import type { AgentConfig } from './types.js';

test('uses separate enrollment and bearer-authenticated heartbeat requests', async () => {
  const requests: Array<{ authorization?: string; body: Record<string, unknown>; url: string }> =
    [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    requests.push({
      authorization: headers.get('authorization') || undefined,
      body,
      url: new URL(url).pathname,
    });
    if (url.endsWith('/api/agent/enroll')) {
      return new Response(
        JSON.stringify({
          agentId: 'agent-1',
          targetId: 'target-1',
          credential: `initpad_agent_${'b'.repeat(43)}`,
          credentialGeneration: 2,
          protocolVersion: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/agent/jobs/claim')) {
      return new Response(JSON.stringify({ job: null, nextPollSeconds: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/lease')) {
      return new Response(JSON.stringify({ leaseExpiresAt: '2026-08-10T12:00:30.000Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        targetId: 'target-1',
        credentialGeneration: 2,
        acceptedAt: '2026-08-10T12:00:00.000Z',
        nextHeartbeatSeconds: 30,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const baseUrl = 'http://127.0.0.1:8080';
  const enrollmentToken = `initpad_enroll_${'a'.repeat(43)}`;
  const enrollment = await enroll(baseUrl, enrollmentToken, fetchImpl as typeof fetch);
  const config: AgentConfig = {
    controlPlaneUrl: baseUrl,
    agentId: enrollment.agentId,
    targetId: enrollment.targetId,
    credential: enrollment.credential,
    credentialGeneration: enrollment.credentialGeneration,
    protocolVersion: 1,
    enrolledAt: '2026-08-10T12:00:00.000Z',
  };
  await heartbeat(
    config,
    {
      engineVersion: '27.5.1',
      apiVersion: '1.47',
      os: 'linux',
      arch: 'amd64',
      rootless: false,
      cpus: 2,
      memoryBytes: 1_073_741_824,
    },
    fetchImpl as typeof fetch,
  );
  await claimJob(config, fetchImpl as typeof fetch);
  await renewJobLease(
    config,
    'job-1',
    `initpad_lease_${'c'.repeat(43)}`,
    fetchImpl as typeof fetch,
  );
  await reportJobProgress(
    config,
    'job-1',
    {
      leaseToken: `initpad_lease_${'c'.repeat(43)}`,
      sequence: 1,
      percent: 5,
      stage: 'accepted',
      message: 'Accepted',
    },
    fetchImpl as typeof fetch,
  );
  await completeJob(
    config,
    'job-1',
    {
      leaseToken: `initpad_lease_${'c'.repeat(43)}`,
      status: 'succeeded',
      message: 'Done',
      resultCode: 'ok',
    },
    fetchImpl as typeof fetch,
  );

  assert.equal(requests[0].url, '/api/agent/enroll');
  assert.equal(requests[0].authorization, undefined);
  assert.equal(requests[0].body.token, enrollmentToken);
  assert.equal(requests[1].url, '/api/agent/heartbeat');
  assert.equal(requests[1].authorization, `Bearer ${enrollment.credential}`);
  assert.equal('token' in requests[1].body, false);
  assert.deepEqual(
    requests.slice(2).map((request) => request.url),
    [
      '/api/agent/jobs/claim',
      '/api/agent/jobs/job-1/lease',
      '/api/agent/jobs/job-1/progress',
      '/api/agent/jobs/job-1/complete',
    ],
  );
  assert.equal(
    requests
      .slice(2)
      .every((request) => request.authorization === `Bearer ${enrollment.credential}`),
    true,
  );
});

test('downloads an artifact only through bearer plus lease headers', async () => {
  const config: AgentConfig = {
    controlPlaneUrl: 'https://initpad.example.test',
    agentId: 'agent-1',
    targetId: 'target-1',
    credential: `initpad_agent_${'b'.repeat(43)}`,
    credentialGeneration: 1,
    protocolVersion: 1,
    enrolledAt: '2026-08-12T09:00:00.000Z',
  };
  const leaseToken = `initpad_lease_${'c'.repeat(43)}`;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const headers = new Headers(init?.headers);
    assert.equal(url.pathname, '/api/agent/jobs/job-1/artifact');
    assert.equal(url.search, '');
    assert.equal(headers.get('authorization'), `Bearer ${config.credential}`);
    assert.equal(headers.get('x-initpad-job-lease'), leaseToken);
    return new Response('archive-bytes', { status: 200 });
  };

  const response = await downloadJobArtifact(
    config,
    'job-1',
    leaseToken,
    '/api/agent/jobs/job-1/artifact',
    undefined,
    fetchImpl as typeof fetch,
  );
  assert.equal(await response.text(), 'archive-bytes');

  await assert.rejects(
    () =>
      downloadJobArtifact(
        config,
        'job-1',
        leaseToken,
        'https://attacker.example/artifact',
        undefined,
        fetchImpl as typeof fetch,
      ),
    /invalid Agent artifact path/,
  );
});
