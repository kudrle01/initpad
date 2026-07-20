-- Recovery metadata for the provisioning saga. Existing audit rows remain
-- readable but cannot be retried automatically because they have no request.

ALTER TABLE "ProvisioningOperation"
    ADD COLUMN "requestedById" TEXT,
    ADD COLUMN "request" JSONB,
    ADD COLUMN "retryOfId" TEXT,
    ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "leaseOwner" TEXT,
    ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "ProvisioningOperation_workspaceId_status_createdAt_idx"
    ON "ProvisioningOperation"("workspaceId", "status", "createdAt");
CREATE INDEX "ProvisioningOperation_retryOfId_idx"
    ON "ProvisioningOperation"("retryOfId");
