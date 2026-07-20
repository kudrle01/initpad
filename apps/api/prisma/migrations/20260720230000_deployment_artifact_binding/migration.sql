-- Preserve the exact artifact through retry and promotion. A commit SHA is a
-- source revision, not a unique build output.

ALTER TABLE "Environment" ADD COLUMN "buildArtifactId" TEXT;
ALTER TABLE "DeploymentOperation" ADD COLUMN "buildArtifactId" TEXT;

CREATE INDEX "Environment_buildArtifactId_idx" ON "Environment"("buildArtifactId");
CREATE INDEX "DeploymentOperation_buildArtifactId_idx"
    ON "DeploymentOperation"("buildArtifactId");

ALTER TABLE "Environment"
    ADD CONSTRAINT "Environment_buildArtifactId_fkey"
    FOREIGN KEY ("buildArtifactId") REFERENCES "BuildArtifact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeploymentOperation"
    ADD CONSTRAINT "DeploymentOperation_buildArtifactId_fkey"
    FOREIGN KEY ("buildArtifactId") REFERENCES "BuildArtifact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
