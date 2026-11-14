-- Additive only (ADR-178, ADR-179).
-- CI runtime secrets are rewritten only when their configuration changes.
ALTER TABLE "Project"
ADD COLUMN "ciRuntimeSecretsFingerprint" TEXT;

-- Latest-wins queue for a CI callback that arrives while dev is busy.
ALTER TABLE "Environment"
ADD COLUMN "pendingCiVersion" TEXT,
ADD COLUMN "pendingCiArtifactId" TEXT,
ADD COLUMN "pendingCiArtifactDigest" TEXT,
ADD COLUMN "pendingCiQueuedAt" TIMESTAMP(3);

CREATE INDEX "Environment_targetId_idx" ON "Environment"("targetId");
CREATE INDEX "Environment_pendingCiQueuedAt_idx" ON "Environment"("pendingCiQueuedAt");
