-- Instance-wide audit of signed self-hosted platform updates. Release bundles,
-- credentials and backup contents deliberately remain outside the database.

CREATE TABLE "PlatformUpdateOperation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supervisorOperationId" TEXT,
    "requestedById" TEXT,
    "requestedByUsername" TEXT NOT NULL,
    "requestedByDisplayName" TEXT,
    "fromVersion" TEXT NOT NULL,
    "toVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requesting',
    "stage" TEXT NOT NULL DEFAULT 'requesting',
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUpdateOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformUpdateOperation_requestId_key"
ON "PlatformUpdateOperation"("requestId");
CREATE UNIQUE INDEX "PlatformUpdateOperation_supervisorOperationId_key"
ON "PlatformUpdateOperation"("supervisorOperationId");
CREATE INDEX "PlatformUpdateOperation_createdAt_idx"
ON "PlatformUpdateOperation"("createdAt");
CREATE INDEX "PlatformUpdateOperation_status_createdAt_idx"
ON "PlatformUpdateOperation"("status", "createdAt");
