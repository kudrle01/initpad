import { ControlPlaneLeaseService } from './control-plane-lease.service';

describe('ControlPlaneLeaseService', () => {
  it('returns the atomically acquired generation and database expiry', async () => {
    const expiresAt = new Date('2026-10-02T21:00:00.000Z');
    const query = jest.fn(async () => [{ generation: 4, expiresAt }]);
    const service = new ControlPlaneLeaseService({ $queryRaw: query } as never);

    await expect(service.acquire('projects-lifecycle', 180_000)).resolves.toEqual({
      generation: 4,
      expiresAt,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns null while another live process owns the lease', async () => {
    const service = new ControlPlaneLeaseService({ $queryRaw: jest.fn(async () => []) } as never);

    await expect(service.acquire('projects-lifecycle', 180_000)).resolves.toBeNull();
  });

  it('rejects unbounded input before querying the database', async () => {
    const query = jest.fn();
    const service = new ControlPlaneLeaseService({ $queryRaw: query } as never);

    await expect(service.acquire('../unsafe', 180_000)).rejects.toThrow('name is invalid');
    await expect(service.acquire('projects-lifecycle', 1_000)).rejects.toThrow('TTL');
    expect(query).not.toHaveBeenCalled();
  });
});
