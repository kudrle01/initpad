-- ADR-134: InitPad-managed Gitea tokens are scoped per consumer. Existing
-- accounts stay NULL until startup reconciliation has moved their repository
-- secrets to package-only tokens and revoked the legacy full-scope tokens.
ALTER TABLE "User" ADD COLUMN "giteaCredentialsScopedAt" TIMESTAMP(3);
