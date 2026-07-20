-- Provider-authenticated build artifacts (ADR-049). The artifact bytes are
-- not stored in PostgreSQL; storageKind/storageRef identify the platform-owned
-- copy after digest verification.

CREATE TABLE "BuildArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "providerArtifactId" TEXT NOT NULL,
    "providerRunId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "storageKind" TEXT,
    "storageRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuildArtifact_sourceProvider_providerArtifactId_key"
    ON "BuildArtifact"("sourceProvider", "providerArtifactId");
CREATE INDEX "BuildArtifact_projectId_commitSha_createdAt_idx"
    ON "BuildArtifact"("projectId", "commitSha", "createdAt");
CREATE INDEX "BuildArtifact_status_createdAt_idx"
    ON "BuildArtifact"("status", "createdAt");

ALTER TABLE "BuildArtifact"
    ADD CONSTRAINT "BuildArtifact_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
