-- A deployment operation can contain multiple durable Agent jobs. Existing
-- single-job operations become step 1; future managed-gateway workflows use
-- two ordered steps protected by the compound unique constraint.
DROP INDEX "AgentJob_deploymentOperationId_key";

ALTER TABLE "AgentJob" ADD COLUMN "operationStep" INTEGER;

ALTER TABLE "AgentJob"
ADD CONSTRAINT "AgentJob_operationStep_positive_check"
CHECK ("operationStep" IS NULL OR "operationStep" > 0);

UPDATE "AgentJob"
SET "operationStep" = 1
WHERE "deploymentOperationId" IS NOT NULL;

CREATE INDEX "AgentJob_deploymentOperationId_status_idx"
ON "AgentJob"("deploymentOperationId", "status");

CREATE UNIQUE INDEX "AgentJob_deploymentOperationId_operationStep_key"
ON "AgentJob"("deploymentOperationId", "operationStep");
