import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Applied deliveries are kept long enough to cover GitHub's manual
// redelivery window many times over; the rows are tiny and rare.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Remembers GitHub webhook deliveries that changed state (ADR-145). GitHub
 * signs the body without a timestamp, so a captured delivery would otherwise
 * replay forever: an old `created` could revive an uninstalled App.
 */
@Injectable()
export class GitHubWebhookDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async applied(deliveryId: string): Promise<boolean> {
    return (await this.prisma.gitHubWebhookDelivery.count({ where: { deliveryId } })) > 0;
  }

  /**
   * Recorded only after the delivery was applied, so a failed delivery stays
   * eligible for GitHub's redelivery with the same id.
   */
  async record(deliveryId: string, event: string): Promise<void> {
    const now = Date.now();
    await this.prisma.gitHubWebhookDelivery.createMany({
      data: [{ deliveryId, event, receivedAt: new Date(now) }],
      skipDuplicates: true,
    });
    await this.prisma.gitHubWebhookDelivery.deleteMany({
      where: { receivedAt: { lt: new Date(now - RETENTION_MS) } },
    });
  }
}
