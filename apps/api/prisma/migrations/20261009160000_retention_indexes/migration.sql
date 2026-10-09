-- The retention sweep removes rows by age (ADR-150).
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

CREATE INDEX "AgentJob_finishedAt_idx" ON "AgentJob"("finishedAt");
