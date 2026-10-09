import { ProjectsLifecycleService } from './projects-lifecycle.service';

describe('ProjectsLifecycleService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('recovers persisted state and owns the periodic expiry sweep', async () => {
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      reconcileGiteaCredentials: jest.fn(async () => undefined),
      recoverInterruptedExecutions: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest.fn(async () => 0),
    };
    const leases = { acquire: jest.fn(async () => ({ generation: 1 })) };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    await lifecycle.onModuleInit();

    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.recoverInterruptedExecutions).toHaveBeenCalledTimes(1);
    expect(leases.acquire).toHaveBeenCalledTimes(2);

    lifecycle.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
  });

  it('keeps startup available when best-effort sweeps fail', async () => {
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      reconcileGiteaCredentials: jest.fn(async () => undefined),
      recoverInterruptedExecutions: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => {
        throw new Error('artifact store unavailable');
      }),
      runEnvironmentExpiry: jest.fn(async () => {
        throw new Error('deployment target unavailable');
      }),
    };
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      {
        acquire: jest.fn(async () => ({ generation: 1 })),
      } as never,
    );

    await expect(lifecycle.onModuleInit()).resolves.toBeUndefined();

    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);
    lifecycle.onModuleDestroy();
  });

  it('keeps expiry maintenance running when periodic execution recovery fails', async () => {
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      reconcileGiteaCredentials: jest.fn(async () => undefined),
      recoverInterruptedExecutions: jest.fn(async () => {
        throw new Error('database temporarily unavailable');
      }),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest.fn(async () => 0),
    };
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      { acquire: jest.fn(async () => ({ generation: 1 })) } as never,
    );

    await lifecycle.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(projects.recoverInterruptedExecutions).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    lifecycle.onModuleDestroy();
  });

  it('does not overlap slow expiry sweeps', async () => {
    let finishSweep: (() => void) | undefined;
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      reconcileGiteaCredentials: jest.fn(async () => undefined),
      recoverInterruptedExecutions: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest
        .fn()
        .mockResolvedValueOnce(0)
        .mockImplementationOnce(
          () =>
            new Promise<number>((resolve) => {
              finishSweep = () => resolve(0);
            }),
        ),
    };
    const leases = { acquire: jest.fn(async () => ({ generation: 1 })) };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);
    await lifecycle.onModuleInit();

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(leases.acquire).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
    expect(leases.acquire).toHaveBeenCalledTimes(3);

    finishSweep?.();
    await Promise.resolve();
    lifecycle.onModuleDestroy();
  });

  it('keeps follower replicas passive and runs recovery after lease takeover', async () => {
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      reconcileGiteaCredentials: jest.fn(async () => undefined),
      recoverInterruptedExecutions: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest.fn(async () => 0),
    };
    const leases = {
      acquire: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ generation: 2 }),
    };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    await lifecycle.onModuleInit();
    expect(projects.reconcilePersistedState).not.toHaveBeenCalled();
    expect(projects.runEnvironmentExpiry).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);
    lifecycle.onModuleDestroy();
  });

  it('renews leadership while the initial recovery is still running', async () => {
    let finishRecovery: (() => void) | undefined;
    const projects = {
      reconcilePersistedState: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishRecovery = resolve;
          }),
      ),
      reconcileGiteaCredentials: jest.fn(async () => undefined),
      recoverInterruptedExecutions: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest.fn(async () => 0),
    };
    const leases = { acquire: jest.fn(async () => ({ generation: 1 })) };
    const lifecycle = new ProjectsLifecycleService(projects as never, leases as never);

    const initializing = lifecycle.onModuleInit();
    await Promise.resolve();
    expect(leases.acquire).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(leases.acquire).toHaveBeenCalledTimes(2);
    expect(projects.runArtifactRetention).not.toHaveBeenCalled();

    finishRecovery?.();
    await initializing;
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    lifecycle.onModuleDestroy();
  });

  it('reconciles Gitea credentials beside maintenance without delaying startup', async () => {
    let finish!: () => void;
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      reconcileGiteaCredentials: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
      recoverInterruptedExecutions: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest.fn(async () => 0),
    };
    const lifecycle = new ProjectsLifecycleService(
      projects as never,
      { acquire: jest.fn(async () => ({ generation: 1 })) } as never,
    );

    // Startup completes while the credential pass is still running.
    await expect(lifecycle.onModuleInit()).resolves.toBeUndefined();
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
