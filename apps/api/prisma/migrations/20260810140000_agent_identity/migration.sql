-- Outbound-only Agent identity bound one-to-one to a physical Target
-- (ADR-066). Plaintext enrollment and runtime credentials are never stored.

CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "enrollmentTokenHash" TEXT,
    "enrollmentExpiresAt" TIMESTAMP(3),
    "credentialHash" TEXT,
    "credentialGeneration" INTEGER NOT NULL DEFAULT 0,
    "protocolVersion" INTEGER NOT NULL DEFAULT 1,
    "version" TEXT,
    "capabilities" JSONB,
    "enrolledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Agent_targetId_key" ON "Agent"("targetId");
CREATE UNIQUE INDEX "Agent_enrollmentTokenHash_key" ON "Agent"("enrollmentTokenHash");
CREATE UNIQUE INDEX "Agent_credentialHash_key" ON "Agent"("credentialHash");
CREATE INDEX "Agent_lastSeenAt_idx" ON "Agent"("lastSeenAt");
CREATE INDEX "Agent_disabledAt_idx" ON "Agent"("disabledAt");

ALTER TABLE "Agent"
    ADD CONSTRAINT "Agent_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Target"("id") ON DELETE CASCADE ON UPDATE CASCADE;
