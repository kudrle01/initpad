import { describe, expect, it } from 'vitest';
import type { Target } from '@/types';
import { targetIsReady, targetNotReadyLabel } from './EnvironmentTargetFields';

function agentTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: 'agent',
    name: 'Production Agent',
    kind: 'docker',
    scope: 'user',
    capabilities: ['node'],
    managementState: 'active',
    routingMode: 'managed-gateway',
    gatewayPreflight: { adapter: 'caddy', status: 'running', checkedAt: null, error: null },
    verifiedAt: null,
    agentReady: false,
    ...overrides,
  } as Target;
}

describe('targetNotReadyLabel', () => {
  it('names a gateway check that is still running instead of a generic Agent problem', () => {
    expect(targetNotReadyLabel(agentTarget())).toBe('gateway check running');
    expect(
      targetNotReadyLabel(
        agentTarget({
          gatewayPreflight: { adapter: 'caddy', status: 'failed', checkedAt: null, error: 'x' },
        }),
      ),
    ).toBe('gateway check failed');
    expect(targetNotReadyLabel(agentTarget({ routingMode: 'direct-port' }))).toBe(
      'Agent not ready',
    );
  });

  it('keeps a built-in target the server reports as unusable out of the selectable set', () => {
    const builtin = agentTarget({
      id: 'builtin-docker',
      scope: 'builtin',
      routingMode: 'direct-port',
      gatewayPreflight: null,
      agentReady: undefined,
      unavailableReason: 'The workload port is bound to 127.0.0.1',
    });
    expect(targetIsReady(builtin)).toBe(false);
    expect(targetNotReadyLabel(builtin)).toBe('not configured');
    expect(targetIsReady({ ...builtin, unavailableReason: undefined })).toBe(true);
  });
});
