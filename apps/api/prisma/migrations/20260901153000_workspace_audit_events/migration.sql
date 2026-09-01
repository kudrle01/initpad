-- Append-only workspace audit events (ADR-077). Resource and actor names are
-- snapshots so later rename/removal cannot rewrite the historical meaning.
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorUsername" TEXT NOT NULL,
    "actorDisplayName" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'succeeded',
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceName" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditEvent_outcome_check" CHECK ("outcome" IN ('succeeded', 'failed'))
);

CREATE INDEX "AuditEvent_workspaceId_createdAt_id_idx"
ON "AuditEvent"("workspaceId", "createdAt", "id");
CREATE INDEX "AuditEvent_workspaceId_action_createdAt_idx"
ON "AuditEvent"("workspaceId", "action", "createdAt");
CREATE INDEX "AuditEvent_workspaceId_resourceType_resourceId_createdAt_idx"
ON "AuditEvent"("workspaceId", "resourceType", "resourceId", "createdAt");

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
