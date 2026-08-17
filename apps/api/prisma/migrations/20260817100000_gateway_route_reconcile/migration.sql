-- Durable, generation-fenced gateway reconcile projection (ADR-073).
ALTER TABLE "GatewayRoute"
ADD COLUMN "observedGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reconcileJobId" TEXT;

ALTER TABLE "AgentJob"
ADD COLUMN "gatewayRouteId" TEXT;

ALTER TABLE "GatewayRoute"
ADD CONSTRAINT "GatewayRoute_observedGeneration_check"
CHECK (
  "observedGeneration" >= 0
  AND "observedGeneration" <= "generation"
);

CREATE INDEX "AgentJob_gatewayRouteId_idx"
ON "AgentJob"("gatewayRouteId");

ALTER TABLE "AgentJob"
ADD CONSTRAINT "AgentJob_gatewayRouteId_fkey"
FOREIGN KEY ("gatewayRouteId") REFERENCES "GatewayRoute"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
