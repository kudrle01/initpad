-- Link append-only audit events to the authoritative long-running operation.
-- The reference is deliberately polymorphic and does not cascade: project
-- deletion may remove DeploymentOperation rows while the immutable audit
-- snapshot must retain the original operation identity.
ALTER TABLE "AuditEvent"
ADD COLUMN "operationType" TEXT,
ADD COLUMN "operationId" TEXT;

ALTER TABLE "AuditEvent"
DROP CONSTRAINT IF EXISTS "AuditEvent_outcome_check";

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_outcome_check"
CHECK ("outcome" IN ('accepted', 'succeeded', 'failed', 'cancelled'));

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_operation_pair_check"
CHECK (
    ("operationType" IS NULL AND "operationId" IS NULL)
    OR
    ("operationType" IN ('deployment', 'provisioning') AND "operationId" IS NOT NULL)
);

CREATE INDEX "AuditEvent_operationType_operationId_idx"
ON "AuditEvent"("operationType", "operationId");

CREATE UNIQUE INDEX "AuditEvent_operationType_operationId_action_key"
ON "AuditEvent"("operationType", "operationId", "action");
