-- Stable managed-gateway route reservation (ADR-073). The route is deleted
-- with its environment, while target/allocation deletion remains restricted
-- until the workload and its route have been explicitly torn down.
CREATE TABLE "GatewayRoute" (
  "id" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "desiredState" TEXT NOT NULL DEFAULT 'reserved',
  "desiredRevision" TEXT,
  "observedState" TEXT NOT NULL DEFAULT 'absent',
  "observedRevision" TEXT,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GatewayRoute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GatewayRoute_desiredState_check"
    CHECK ("desiredState" IN ('reserved', 'active', 'stopped', 'absent')),
  CONSTRAINT "GatewayRoute_observedState_check"
    CHECK ("observedState" IN ('absent', 'active', 'stopped', 'failed')),
  CONSTRAINT "GatewayRoute_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "GatewayRoute_hostname_check"
    CHECK ("hostname" = lower("hostname") AND length("hostname") <= 253)
);

CREATE UNIQUE INDEX "GatewayRoute_environmentId_key" ON "GatewayRoute"("environmentId");
CREATE UNIQUE INDEX "GatewayRoute_hostname_key" ON "GatewayRoute"("hostname");
CREATE UNIQUE INDEX "GatewayRoute_publicUrl_key" ON "GatewayRoute"("publicUrl");
CREATE INDEX "GatewayRoute_targetId_desiredState_idx" ON "GatewayRoute"("targetId", "desiredState");
CREATE INDEX "GatewayRoute_allocationId_idx" ON "GatewayRoute"("allocationId");

ALTER TABLE "GatewayRoute"
  ADD CONSTRAINT "GatewayRoute_environmentId_fkey"
  FOREIGN KEY ("environmentId") REFERENCES "Environment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GatewayRoute"
  ADD CONSTRAINT "GatewayRoute_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "Target"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GatewayRoute"
  ADD CONSTRAINT "GatewayRoute_allocationId_fkey"
  FOREIGN KEY ("allocationId") REFERENCES "TargetAllocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
