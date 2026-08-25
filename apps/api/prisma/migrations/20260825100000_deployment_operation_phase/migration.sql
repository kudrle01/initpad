-- Keep the existing coarse status as the operation lock and add a durable,
-- provider-neutral delivery phase for history, recovery and user feedback.
ALTER TABLE "DeploymentOperation"
ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'queued';

UPDATE "DeploymentOperation"
SET "phase" = CASE
  WHEN "status" = 'succeeded' THEN 'succeeded'
  WHEN "status" = 'failed' AND (
    "message" ILIKE '%health%' OR "message" ILIKE '%unhealthy%'
  ) THEN 'unhealthy'
  WHEN "status" = 'failed' THEN 'failed'
  WHEN "status" = 'cancelled' THEN 'cancelled'
  ELSE 'running'
END;

ALTER TABLE "DeploymentOperation"
ADD CONSTRAINT "DeploymentOperation_phase_check"
CHECK ("phase" IN (
  'queued',
  'assigned',
  'running',
  'verifying',
  'succeeded',
  'failed',
  'unhealthy',
  'cancelled'
));
