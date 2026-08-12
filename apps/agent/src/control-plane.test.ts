import assert from 'node:assert/strict';
import test from 'node:test';
import { enroll, heartbeat } from './control-plane.js';
import type { AgentConfig } from './types.js';

test('uses separate enrollment and bearer-authenticated heartbeat requests', async () => {
  const requests: Array<{ authorization?: string; body: Record<string, unknown>; url: string }> = [];
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
      return new Response(JSON.stringify({
          agentId: 'agent-1', targetId: 'target-1',
          credential: `initpad_agent_${'b'.repeat(43)}`,
          credentialGeneration: 2, protocolVersion: 1,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
          targetId: 'target-1', credentialGeneration: 2,
          acceptedAt: '2026-08-10T12:00:00.000Z', nextHeartbeatSeconds: 30,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  await heartbeat(config, {
    engineVersion: '27.5.1', apiVersion: '1.47', os: 'linux', arch: 'amd64',
    rootless: false, cpus: 2, memoryBytes: 1_073_741_824,
  }, fetchImpl as typeof fetch);

  assert.equal(requests[0].url, '/api/agent/enroll');
  assert.equal(requests[0].authorization, undefined);
  assert.equal(requests[0].body.token, enrollmentToken);
  assert.equal(requests[1].url, '/api/agent/heartbeat');
  assert.equal(requests[1].authorization, `Bearer ${enrollment.credential}`);
  assert.equal('token' in requests[1].body, false);
});
