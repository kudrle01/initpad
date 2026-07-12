ALTER TABLE "Environment" ADD COLUMN "activeOperationId" TEXT;

CREATE TABLE "DeploymentOperation" (
  "id" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "version" TEXT,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "DeploymentOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeploymentOperation_environmentId_createdAt_idx"
  ON "DeploymentOperation"("environmentId", "createdAt");
CREATE INDEX "DeploymentOperation_status_idx" ON "DeploymentOperation"("status");

ALTER TABLE "DeploymentOperation"
  ADD CONSTRAINT "DeploymentOperation_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
