import { ProjectsLifecycleService } from './projects-lifecycle.service';

describe('ProjectsLifecycleService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('recovers persisted state and owns the periodic expiry sweep', async () => {
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => ({ removed: 0, kept: 0 })),
      runEnvironmentExpiry: jest.fn(async () => 0),
    };
    const lifecycle = new ProjectsLifecycleService(projects as never);

    await lifecycle.onModuleInit();

    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);

    lifecycle.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);
  });

  it('keeps startup available when best-effort sweeps fail', async () => {
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
      runArtifactRetention: jest.fn(async () => {
        throw new Error('artifact store unavailable');
      }),
      runEnvironmentExpiry: jest.fn(async () => {
        throw new Error('deployment target unavailable');
      }),
    };
    const lifecycle = new ProjectsLifecycleService(projects as never);

    await expect(lifecycle.onModuleInit()).resolves.toBeUndefined();

    expect(projects.reconcilePersistedState).toHaveBeenCalledTimes(1);
    expect(projects.runArtifactRetention).toHaveBeenCalledTimes(1);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(1);
    lifecycle.onModuleDestroy();
  });

  it('does not overlap slow expiry sweeps', async () => {
    let finishSweep: (() => void) | undefined;
    const projects = {
      reconcilePersistedState: jest.fn(async () => undefined),
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
    const lifecycle = new ProjectsLifecycleService(projects as never);
    await lifecycle.onModuleInit();

    jest.advanceTimersByTime(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(60_000);
    expect(projects.runEnvironmentExpiry).toHaveBeenCalledTimes(2);

    finishSweep?.();
    await Promise.resolve();
    lifecycle.onModuleDestroy();
  });
});
