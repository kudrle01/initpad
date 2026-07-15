-- Persistent audit of project provisioning (create/import), Phase 3. Additive
-- table only; existing rows are untouched.

-- CreateTable
CREATE TABLE "ProvisioningOperation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "step" TEXT NOT NULL DEFAULT 'validate',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProvisioningOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProvisioningOperation_workspaceId_createdAt_idx" ON "ProvisioningOperation"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ProvisioningOperation_projectId_idx" ON "ProvisioningOperation"("projectId");
