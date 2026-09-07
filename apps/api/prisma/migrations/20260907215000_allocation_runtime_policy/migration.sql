ALTER TABLE "TargetAllocation"
  ADD COLUMN "cpuLimitMillicores" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "memoryLimitMb" INTEGER NOT NULL DEFAULT 512,
  ADD COLUMN "pidsLimit" INTEGER NOT NULL DEFAULT 256,
  ADD COLUMN "devTtlHours" INTEGER,
  ADD COLUMN "testTtlHours" INTEGER;

ALTER TABLE "Environment"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "expiryWarningAt" TIMESTAMP(3);

CREATE INDEX "Environment_expiresAt_idx" ON "Environment"("expiresAt");
