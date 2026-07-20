-- Durable effect journal for project create/import provisioning. Additive:
-- existing operations remain valid and simply have no effect rows.

CREATE TABLE "ProvisioningEffect" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "metadata" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "compensatedAt" TIMESTAMP(3),

    CONSTRAINT "ProvisioningEffect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProvisioningEffect_operationId_key_key"
    ON "ProvisioningEffect"("operationId", "key");
CREATE INDEX "ProvisioningEffect_operationId_createdAt_idx"
    ON "ProvisioningEffect"("operationId", "createdAt");

ALTER TABLE "ProvisioningEffect"
    ADD CONSTRAINT "ProvisioningEffect_operationId_fkey"
    FOREIGN KEY ("operationId") REFERENCES "ProvisioningOperation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
