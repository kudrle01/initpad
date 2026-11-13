-- A finished provisioning failure can be acknowledged so it stops occupying
-- the dashboard once it was resolved by hand or can no longer be acted on.
ALTER TABLE "ProvisioningOperation"
ADD COLUMN "dismissedAt" TIMESTAMP(3),
ADD COLUMN "dismissedById" TEXT;
