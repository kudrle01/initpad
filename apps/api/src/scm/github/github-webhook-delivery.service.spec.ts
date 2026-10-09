import { GitHubWebhookDeliveryService } from './github-webhook-delivery.service';

describe('GitHubWebhookDeliveryService', () => {
  it('records an applied delivery once and prunes ids older than the retention', async () => {
    const prisma = {
      gitHubWebhookDelivery: {
        count: jest.fn(async () => 1),
        createMany: jest.fn(async () => ({ count: 1 })),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const service = new GitHubWebhookDeliveryService(prisma as never);

    await expect(service.applied('guid-1')).resolves.toBe(true);
    await service.record('guid-1', 'installation');

    expect(prisma.gitHubWebhookDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ deliveryId: 'guid-1', event: 'installation' })],
      skipDuplicates: true,
    });
    const cutoff = (
      prisma.gitHubWebhookDelivery.deleteMany.mock.calls[0] as unknown as [
        { where: { receivedAt: { lt: Date } } },
      ]
    )[0].where.receivedAt.lt;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });
});
