-- Durable, encrypted transactional outbox for authentication e-mails.
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payloadEncrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockOwner" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailOutbox_kind_check" CHECK ("kind" IN ('email_verify', 'password_reset', 'activation')),
    CONSTRAINT "EmailOutbox_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed')),
    CONSTRAINT "EmailOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "EmailOutbox_status_availableAt_idx" ON "EmailOutbox"("status", "availableAt");
CREATE INDEX "EmailOutbox_status_lockedAt_idx" ON "EmailOutbox"("status", "lockedAt");
CREATE INDEX "EmailOutbox_userId_createdAt_idx" ON "EmailOutbox"("userId", "createdAt");

ALTER TABLE "EmailOutbox"
ADD CONSTRAINT "EmailOutbox_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve only the newest unused link if a legacy instance ever issued two
-- concurrently, then enforce the single-live-link invariant in PostgreSQL.
WITH ranked AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "userId", "kind" ORDER BY "createdAt" DESC, "id" DESC
    ) AS position
    FROM "AuthToken"
    WHERE "usedAt" IS NULL
)
UPDATE "AuthToken"
SET "usedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE "AuthToken"."id" = ranked."id" AND ranked.position > 1;

CREATE UNIQUE INDEX "AuthToken_userId_kind_unused_key"
ON "AuthToken"("userId", "kind") WHERE "usedAt" IS NULL;
