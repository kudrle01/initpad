-- Fingerprint of the gateway CA root, reported by the Agent after a passed preflight.
ALTER TABLE "Target"
ADD COLUMN "gatewayCaSha256" TEXT;
