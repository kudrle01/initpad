-- Existing installations keep their current random-port behaviour. The
-- managed-gateway mode is opt-in and becomes deployable only after its
-- preflight/reconcile path is available (ADR-073).
ALTER TABLE "Target"
ADD COLUMN "routingMode" TEXT NOT NULL DEFAULT 'direct-port';

ALTER TABLE "Target"
ADD CONSTRAINT "Target_routingMode_check"
CHECK ("routingMode" IN ('direct-port', 'managed-gateway'));
