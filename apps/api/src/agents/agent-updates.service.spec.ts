import { AgentUpdatesService } from './agent-updates.service';

function catalog(version: string | null) {
  return {
    latestAgentRelease: jest.fn(async () => ({
      enabled: true,
      checkedAt: '2026-09-16T10:00:00.000Z',
      stale: false,
      release: version
        ? {
            manifest: {
              version,
              image: { immutableReference: `ghcr.io/initpad/agent@sha256:${'a'.repeat(64)}` },
            },
            releaseUrl: `https://github.com/initpad/releases/${version}`,
            publishedAt: '2026-09-16T09:00:00.000Z',
          }
        : null,
      error: null,
    })),
  };
}

function agents(version: string | null) {
  return {
    requireTargetAccess: jest.fn(async () => ({ id: 'target-1' })),
    getForTarget: jest.fn(async () => ({ version })),
  };
}

describe('AgentUpdatesService', () => {
  it('marks the 0.12 to 0.13 bootstrap as a manual update', async () => {
    const service = new AgentUpdatesService(agents('0.12.1') as never, catalog('0.13.0') as never);
    await expect(service.status('target-1', 'owner-1')).resolves.toMatchObject({
      currentVersion: '0.12.1',
      latestVersion: '0.13.0',
      updateAvailable: true,
      updateMethod: 'manual',
    });
  });

  it('allows remote updates only from an Agent with the update protocol', async () => {
    const service = new AgentUpdatesService(agents('0.13.0') as never, catalog('0.14.0') as never);
    await expect(service.status('target-1', 'owner-1')).resolves.toMatchObject({
      updateAvailable: true,
      updateMethod: 'remote',
    });
  });

  it('does not downgrade a newer Agent', async () => {
    const service = new AgentUpdatesService(agents('0.14.0') as never, catalog('0.13.0') as never);
    await expect(service.status('target-1', 'owner-1')).resolves.toMatchObject({
      updateAvailable: false,
      updateMethod: 'none',
    });
  });
});
