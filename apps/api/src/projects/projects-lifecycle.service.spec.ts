import { Logger } from '@nestjs/common';
import { ProjectsLifecycleService } from './projects-lifecycle.service';

function projectsMock(overrides: Record<string, jest.Mock> = {}) {
  return {
    reconcilePersistedState: jest.fn(async () => undefined),
    reconcileScmConfiguration: jest.fn(async () => undefined),
    reconcileGiteaCredentials: jest.fn(async () => undefined),
    recoverInterruptedExecutions: jest.fn(async () => undefined),
    recoverStuckProductionApprovals: jest.fn(async () => 0),
    drainPendingCiDeployments: jest.fn(async () => 0),
    runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
    followRenamedInstallationAccounts: jest.fn(async () => 0),
    runEnvironmentExpiry: jest.fn(async () => 0),
    ...overrides,
  };
}

// Startup work is started, never awaited, by onModuleInit; flush it.
async function flush(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

describe('ProjectsLifecycleService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('recovers persisted state and owns the periodic expiry sweep', async () => {
    const projects = projectsMock();
    const leases = { acquire: jest.fn(async () => ({ generation: 1 })) };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    lifecycle.onModuleInit();
    await flush();

    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.reconcileScmConfiguration).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);
    expect(projects.recoverStuckProductionApprovals).toHaveBeenCalledTimes(1);
    expect(projects.drainPendingCiDeployments).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.reconcileScmConfiguration).toHaveBeenCalledTimes(1);
    expect(projects.recoverInterruptedExecutions).toHaveBeenCalledTimes(1);
    expect(projects.recoverStuckProductionApprovals).toHaveBeenCalledTimes(2);
    expect(projects.drainPendingCiDeployments).toHaveBeenCalledTimes(2);
    expect(leases.acquire).toHaveBeenCalledTimes(2);

    lifecycle.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
  });

  it('never makes module initialization wait for SCM reconciliation', async () => {
    // Regression (audit P0.3): startup awaited repository identity and CI
    // secret reconciliation for every project before the API became ready.
    let finishScm!: () => void;
    let finishLease!: (claim: { generation: number }) => void;
    const projects = projectsMock({
      reconcileScmConfiguration: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishScm = resolve;
          }),
      ),
    });
    const leases = {
      acquire: jest.fn(
        () =>
          new Promise<{ generation: number }>((resolve) => {
            finishLease = resolve;
          }),
      ),
    };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    // Even the lease query is not awaited by onModuleInit.
    expect(lifecycle.onModuleInit()).toBeUndefined();
    finishLease({ generation: 1 });
    await flush();

    expect(projects.reconcileScmConfiguration).toHaveBeenCalledTimes(1);
    // Maintenance went on while the SCM pass is still running.
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);

    finishScm();
    lifecycle.onModuleDestroy();
  });

  it('runs artifact retention hourly on a long-running leader', async () => {
    // Regression (audit P2): retention ran only when the lease changed hands.
    const projects = projectsMock();
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      { acquire: jest.fn(async () => ({ generation: 1 })) } as never,
    );

    lifecycle.onModuleInit();
    await flush();
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(59 * 60_000);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(2);
    lifecycle.onModuleDestroy();
  });

  it('keeps startup available when best-effort sweeps fail', async () => {
    const projects = projectsMock({
      runArtifactRetention: jest.fn(async () => {
        throw new Error('artifact store unavailable');
      }),
      runEnvironmentExpiry: jest.fn(async () => {
        throw new Error('deployment target unavailable');
      }),
      reconcileScmConfiguration: jest.fn(async () => {
        throw new Error('gitea unavailable');
      }),
    });
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      { acquire: jest.fn(async () => ({ generation: 1 })) } as never,
    );

    expect(() => lifecycle.onModuleInit()).not.toThrow();
    await flush();

    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);
    lifecycle.onModuleDestroy();
  });

  it('retries leadership after a failed lease query instead of failing startup', async () => {
    const projects = projectsMock();
    const leases = {
      acquire: jest
        .fn()
        .mockRejectedValueOnce(new Error('database starting'))
        .mockResolvedValue({ generation: 1 }),
    };
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    lifecycle.onModuleInit();
    await flush();
    expect(projects.reconcilePersistedState).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    lifecycle.onModuleDestroy();
  });

  it('keeps expiry maintenance running when periodic execution recovery fails', async () => {
    const projects = projectsMock({
      recoverInterruptedExecutions: jest.fn(async () => {
        throw new Error('database temporarily unavailable');
      }),
    });
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      { acquire: jest.fn(async () => ({ generation: 1 })) } as never,
    );

    lifecycle.onModuleInit();
    await flush();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(projects.recoverInterruptedExecutions).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    lifecycle.onModuleDestroy();
  });

  it('does not overlap slow expiry sweeps', async () => {
    let finishSweep: (() => void) | undefined;
    const projects = projectsMock({
      runEnvironmentExpiry: jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockImplementationOnce(
          () =>
            new Promise<number>((resolve) => {
              finishSweep = () => resolve(0);
            }),
        ),
    });
    const leases = { acquire: jest.fn(async () => ({ generation: 1 })) };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);
    lifecycle.onModuleInit();
    await flush();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(leases.acquire).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(leases.acquire).toHaveBeenCalledTimes(3);

    finishSweep?.();
    await flush();
    lifecycle.onModuleDestroy();
  });

  it('keeps follower replicas passive and runs recovery after lease takeover', async () => {
    const projects = projectsMock();
    const leases = {
      acquire: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ generation: 2 }),
    };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    lifecycle.onModuleInit();
    await flush();
    expect(projects.reconcilePersistedState).not.toHaveBeenCalled();
    expect(projects.runEnvironmentExpiry).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      event: 'control_plane.leader.acquired',
      lease: 'projects-lifecycle',
      generation: 2,
    });
    log.mockRestore();
    lifecycle.onModuleDestroy();
  });

  it('renews leadership while the initial recovery is still running', async () => {
    let finishRecovery: (() => void) | undefined;
    const projects = projectsMock({
      reconcilePersistedState: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRecovery = resolve;
          }),
      ),
    });
    const leases = { acquire: jest.fn(async () => ({ generation: 1 })) };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    lifecycle.onModuleInit();
    await flush();
    expect(leases.acquire).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(leases.acquire).toHaveBeenCalledTimes(2);
    expect(projects.runArtifactRetention).not.toHaveBeenCalled();

    finishRecovery?.();
    await flush();
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    lifecycle.onModuleDestroy();
  });

  it('reconciles Gitea credentials beside maintenance without delaying startup', async () => {
    let finish!: () => void;
    const projects = projectsMock({
      reconcileGiteaCredentials: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      { acquire: jest.fn(async () => ({ generation: 1 })) } as never,
    );

    lifecycle.onModuleInit();
    await flush();
    expect(projects.reconcileGiteaCredentials).toHaveBeenCalledTimes(1);

    // A slow pass is never started twice.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(projects.reconcileGiteaCredentials).toHaveBeenCalledTimes(1);

    finish();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.reconcileGiteaCredentials).toHaveBeenCalledTimes(2);
    lifecycle.onModuleDestroy();
  });
});
