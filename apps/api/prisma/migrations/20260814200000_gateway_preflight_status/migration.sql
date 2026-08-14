-- Read-only managed-gateway readiness state (ADR-073). The job id fences
-- concurrent tests: only the newest requested preflight may publish status.
ALTER TABLE "Target"
ADD COLUMN "gatewayAdapter" TEXT,
ADD COLUMN "gatewayPreflightStatus" TEXT NOT NULL DEFAULT 'not-run',
ADD COLUMN "gatewayPreflightJobId" TEXT,
ADD COLUMN "gatewayPreflightAt" TIMESTAMP(3),
ADD COLUMN "gatewayPreflightError" TEXT;

UPDATE "Target"
SET "gatewayAdapter" = 'caddy'
WHERE "routingMode" = 'managed-gateway';

ALTER TABLE "Target"
ADD CONSTRAINT "Target_gatewayAdapter_check"
CHECK (
  ("routingMode" = 'direct-port' AND "gatewayAdapter" IS NULL)
  OR ("routingMode" = 'managed-gateway' AND "gatewayAdapter" = 'caddy')
),
ADD CONSTRAINT "Target_gatewayPreflightStatus_check"
CHECK ("gatewayPreflightStatus" IN ('not-run', 'queued', 'running', 'passed', 'failed'));

CREATE INDEX "Target_gatewayPreflightStatus_idx"
ON "Target"("gatewayPreflightStatus");
