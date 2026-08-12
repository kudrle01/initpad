-- Durable target-scoped Agent jobs with short leases and hashed fencing tokens
-- (ADR-069). This migration is additive; existing deployment paths and rows are
-- unchanged until an Agent-backed target explicitly uses the delivery path.

CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "allocationId" TEXT,
    "deploymentOperationId" TEXT,
    "leasedByAgentId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseTokenHash" TEXT,
    "leasedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "progressSequence" INTEGER NOT NULL DEFAULT 0,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "progressStage" TEXT NOT NULL DEFAULT 'queued',
    "message" TEXT,
    "resultCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentJob_deploymentOperationId_key" ON "AgentJob"("deploymentOperationId");
CREATE UNIQUE INDEX "AgentJob_dedupeKey_key" ON "AgentJob"("dedupeKey");
CREATE UNIQUE INDEX "AgentJob_leaseTokenHash_key" ON "AgentJob"("leaseTokenHash");
CREATE INDEX "AgentJob_targetId_status_createdAt_idx" ON "AgentJob"("targetId", "status", "createdAt");
CREATE INDEX "AgentJob_status_leaseExpiresAt_idx" ON "AgentJob"("status", "leaseExpiresAt");
CREATE INDEX "AgentJob_allocationId_idx" ON "AgentJob"("allocationId");

ALTER TABLE "AgentJob"
    ADD CONSTRAINT "AgentJob_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentJob"
    ADD CONSTRAINT "AgentJob_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "TargetAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentJob"
    ADD CONSTRAINT "AgentJob_deploymentOperationId_fkey" FOREIGN KEY ("deploymentOperationId") REFERENCES "DeploymentOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentJob"
    ADD CONSTRAINT "AgentJob_leasedByAgentId_fkey" FOREIGN KEY ("leasedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
