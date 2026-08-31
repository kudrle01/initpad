-- Latest bounded Agent workload diagnostic projection (ADR-076). Application
-- log tails are deliberately kept outside AgentJob/deployment history and one
-- row per Environment is overwritten by each explicit refresh.
CREATE TABLE "WorkloadDiagnostic" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "currentJobId" TEXT,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "runtimeState" TEXT,
    "revision" TEXT,
    "exitCode" INTEGER,
    "health" TEXT,
    "logs" TEXT NOT NULL DEFAULT '',
    "message" TEXT,
    "requestedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkloadDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkloadDiagnostic_environmentId_key"
ON "WorkloadDiagnostic"("environmentId");
CREATE UNIQUE INDEX "WorkloadDiagnostic_currentJobId_key"
ON "WorkloadDiagnostic"("currentJobId");
CREATE INDEX "WorkloadDiagnostic_status_requestedAt_idx"
ON "WorkloadDiagnostic"("status", "requestedAt");

ALTER TABLE "WorkloadDiagnostic"
ADD CONSTRAINT "WorkloadDiagnostic_environmentId_fkey"
FOREIGN KEY ("environmentId") REFERENCES "Environment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkloadDiagnostic"
ADD CONSTRAINT "WorkloadDiagnostic_currentJobId_fkey"
FOREIGN KEY ("currentJobId") REFERENCES "AgentJob"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
