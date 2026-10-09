-- GitHub webhook deliveries that changed state (ADR-145).
CREATE TABLE "GitHubWebhookDelivery" (
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubWebhookDelivery_pkey" PRIMARY KEY ("deliveryId")
);

CREATE INDEX "GitHubWebhookDelivery_receivedAt_idx" ON "GitHubWebhookDelivery"("receivedAt");
