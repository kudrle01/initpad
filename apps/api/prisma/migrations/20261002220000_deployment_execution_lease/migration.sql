ALTER TABLE "DeploymentOperation"
    ADD COLUMN "executionOwner" TEXT,
    ADD COLUMN "executionGeneration" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "executionLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "DeploymentOperation_status_executionLeaseExpiresAt_idx"
    ON "DeploymentOperation"("status", "executionLeaseExpiresAt");

ALTER TABLE "DeploymentOperation"
    ADD CONSTRAINT "DeploymentOperation_executionGeneration_check"
    CHECK ("executionGeneration" >= 0);
