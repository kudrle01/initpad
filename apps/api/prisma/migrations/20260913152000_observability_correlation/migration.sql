-- Add stable, non-secret workflow correlation without invalidating historical
-- deployments. Existing operation/job IDs are already UUIDs and therefore make
-- deterministic backfill values; new rows receive application-generated UUIDs.

ALTER TABLE "DeploymentOperation" ADD COLUMN "correlationId" TEXT;
UPDATE "DeploymentOperation" SET "correlationId" = "id" WHERE "correlationId" IS NULL;
ALTER TABLE "DeploymentOperation" ALTER COLUMN "correlationId" SET NOT NULL;

ALTER TABLE "AgentJob" ADD COLUMN "correlationId" TEXT;
UPDATE "AgentJob" AS job
SET "correlationId" = COALESCE(operation."correlationId", job."id")
FROM "DeploymentOperation" AS operation
WHERE job."deploymentOperationId" = operation."id" AND job."correlationId" IS NULL;
UPDATE "AgentJob" SET "correlationId" = "id" WHERE "correlationId" IS NULL;
ALTER TABLE "AgentJob" ALTER COLUMN "correlationId" SET NOT NULL;

CREATE INDEX "DeploymentOperation_correlationId_idx" ON "DeploymentOperation"("correlationId");
CREATE INDEX "AgentJob_correlationId_idx" ON "AgentJob"("correlationId");
