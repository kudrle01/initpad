-- Workspace-scoped usage of a physical Target (ADR-060). Additive: no existing
-- column changes, Environment gains a nullable allocationId backfilled later.

CREATE TABLE "TargetAllocation" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "rootPath" TEXT,
    "publicUrl" TEXT,
    "capabilities" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "maxEnvironments" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TargetAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TargetAllocation_workspaceId_targetId_key" ON "TargetAllocation"("workspaceId", "targetId");
CREATE INDEX "TargetAllocation_targetId_idx" ON "TargetAllocation"("targetId");

ALTER TABLE "TargetAllocation"
    ADD CONSTRAINT "TargetAllocation_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TargetAllocation"
    ADD CONSTRAINT "TargetAllocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Environment" ADD COLUMN "allocationId" TEXT;
CREATE INDEX "Environment_allocationId_idx" ON "Environment"("allocationId");
ALTER TABLE "Environment"
    ADD CONSTRAINT "Environment_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "TargetAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
