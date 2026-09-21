-- Agent updates use the same authoritative-operation audit link as
-- deployments and provisioning. Keep the pair atomic while extending the
-- existing polymorphic constraint; no historical rows are rewritten.

ALTER TABLE "AuditEvent"
DROP CONSTRAINT IF EXISTS "AuditEvent_operation_pair_check";

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_operation_pair_check"
CHECK (
    ("operationType" IS NULL AND "operationId" IS NULL)
    OR
    (
        "operationType" IN ('deployment', 'provisioning', 'agent-job')
        AND "operationId" IS NOT NULL
    )
);
