-- OAuth callback state and OIDC grants must survive API restarts and be shared
-- by every replica. Browser/token plaintext is never persisted.
CREATE TABLE "ExternalOAuthState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalOAuthState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OidcGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "clientId" TEXT,
    "redirectUri" TEXT,
    "nonce" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OidcGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExternalOAuthState_tokenHash_key" ON "ExternalOAuthState"("tokenHash");
CREATE INDEX "ExternalOAuthState_provider_expiresAt_idx" ON "ExternalOAuthState"("provider", "expiresAt");
CREATE INDEX "ExternalOAuthState_expiresAt_idx" ON "ExternalOAuthState"("expiresAt");

CREATE UNIQUE INDEX "OidcGrant_tokenHash_key" ON "OidcGrant"("tokenHash");
CREATE INDEX "OidcGrant_userId_kind_idx" ON "OidcGrant"("userId", "kind");
CREATE INDEX "OidcGrant_kind_expiresAt_idx" ON "OidcGrant"("kind", "expiresAt");
CREATE INDEX "OidcGrant_expiresAt_idx" ON "OidcGrant"("expiresAt");

ALTER TABLE "OidcGrant"
ADD CONSTRAINT "OidcGrant_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
