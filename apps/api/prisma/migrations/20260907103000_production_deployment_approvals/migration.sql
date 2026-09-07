-- Production publication is a reviewed, immutable intent (ADR-082).
ALTER TABLE "Workspace"
ADD COLUMN "productionApprovalPolicy" TEXT NOT NULL DEFAULT 'separate-reviewer';

UPDATE "Workspace"
SET "productionApprovalPolicy" = 'self-review'
WHERE "type" = 'personal';

ALTER TABLE "Workspace"
ADD CONSTRAINT "Workspace_productionApprovalPolicy_check"
CHECK ("productionApprovalPolicy" IN ('self-review', 'separate-reviewer'));

ALTER TABLE "Target"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Environment"
ADD COLUMN "configRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProductionDeploymentRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectNameSnapshot" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedByUsername" TEXT NOT NULL,
    "requestedByDisplayName" TEXT,
    "reviewedById" TEXT,
    "reviewedByUsername" TEXT,
    "reviewedByDisplayName" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceEnvironment" TEXT NOT NULL,
    "candidateOperationId" TEXT,
    "candidateStateToken" TEXT,
    "version" TEXT NOT NULL,
    "buildArtifactId" TEXT,
    "artifactDigest" TEXT,
    "targetIdSnapshot" TEXT,
    "allocationIdSnapshot" TEXT,
    "targetNameSnapshot" TEXT NOT NULL,
    "providerSnapshot" TEXT NOT NULL,
    "configRevisionSnapshot" INTEGER NOT NULL,
    "targetRevisionSnapshot" TIMESTAMP(3),
    "allocationRevisionSnapshot" TIMESTAMP(3),
    "stateToken" TEXT NOT NULL,
    "policySnapshot" TEXT NOT NULL,
    "reviewNote" TEXT,
    "deploymentOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionDeploymentRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductionDeploymentRequest_kind_check"
      CHECK ("kind" IN ('promote', 'redeploy', 'rollback')),
    CONSTRAINT "ProductionDeploymentRequest_status_check"
      CHECK ("status" IN ('pending', 'approving', 'approved', 'rejected', 'stale', 'failed', 'cancelled')),
    CONSTRAINT "ProductionDeploymentRequest_policy_check"
      CHECK ("policySnapshot" IN ('self-review', 'separate-reviewer'))
);

CREATE UNIQUE INDEX "ProductionDeploymentRequest_deploymentOperationId_key"
ON "ProductionDeploymentRequest"("deploymentOperationId");

CREATE INDEX "ProductionDeploymentRequest_workspaceId_createdAt_idx"
ON "ProductionDeploymentRequest"("workspaceId", "createdAt");

CREATE INDEX "ProductionDeploymentRequest_projectId_createdAt_idx"
ON "ProductionDeploymentRequest"("projectId", "createdAt");

CREATE INDEX "ProductionDeploymentRequest_environmentId_status_createdAt_idx"
ON "ProductionDeploymentRequest"("environmentId", "status", "createdAt");

CREATE INDEX "ProductionDeploymentRequest_requestedById_status_idx"
ON "ProductionDeploymentRequest"("requestedById", "status");

-- One live request per production environment. The application still uses a
-- serializable transaction; this index is the final concurrency backstop.
CREATE UNIQUE INDEX "ProductionDeploymentRequest_one_live_per_environment_key"
ON "ProductionDeploymentRequest"("environmentId")
WHERE "status" IN ('pending', 'approving');

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_buildArtifactId_fkey"
FOREIGN KEY ("buildArtifactId") REFERENCES "BuildArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductionDeploymentRequest"
ADD CONSTRAINT "ProductionDeploymentRequest_deploymentOperationId_fkey"
FOREIGN KEY ("deploymentOperationId") REFERENCES "DeploymentOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
