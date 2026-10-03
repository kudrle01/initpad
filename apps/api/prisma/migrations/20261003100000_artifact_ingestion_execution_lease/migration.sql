ALTER TABLE "BuildArtifact"
    ADD COLUMN "ingestionOwner" TEXT,
    ADD COLUMN "ingestionGeneration" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "ingestionLeaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "BuildArtifact_status_ingestionLeaseExpiresAt_idx"
    ON "BuildArtifact"("status", "ingestionLeaseExpiresAt");

ALTER TABLE "BuildArtifact"
    ADD CONSTRAINT "BuildArtifact_ingestionGeneration_check"
    CHECK ("ingestionGeneration" >= 0);
