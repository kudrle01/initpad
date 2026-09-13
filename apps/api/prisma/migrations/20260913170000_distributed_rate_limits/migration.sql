-- Cross-replica rate-limit buckets. Subjects are HMACed by the application;
-- the table never stores a client IP, account identity or plaintext token.

CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "RateLimitBucket_count_check" CHECK ("count" > 0),
    CONSTRAINT "RateLimitBucket_dimension_check" CHECK ("dimension" IN ('ip', 'subject'))
);

CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
CREATE INDEX "RateLimitBucket_scope_expiresAt_idx" ON "RateLimitBucket"("scope", "expiresAt");
