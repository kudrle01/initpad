-- Store provider user credentials separately from immutable identity data.
-- Every new column is nullable/defaulted so the migration is safe for all
-- existing self-hosted and SaaS accounts. Token values are encrypted by the
-- application before they reach these columns.
ALTER TABLE "ExternalIdentity"
  ADD COLUMN "accessTokenEncrypted" TEXT,
  ADD COLUMN "accessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "refreshTokenEncrypted" TEXT,
  ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "credentialRefreshingAt" TIMESTAMP(3);
