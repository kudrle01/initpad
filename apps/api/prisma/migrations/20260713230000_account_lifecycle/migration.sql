-- Account lifecycle fields (ADR-040): deactivation, forced password change,
-- session invalidation via a token version, and an e-mail verification
-- timestamp. Every column is additive with a safe default, so existing rows
-- keep working (active, never forced to change, token version 0, unverified).
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
