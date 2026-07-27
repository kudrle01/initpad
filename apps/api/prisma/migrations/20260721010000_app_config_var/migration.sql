-- Per-environment application config & secrets (ADR-061). Additive.

CREATE TABLE "AppConfigVar" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppConfigVar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppConfigVar_environmentId_key_key" ON "AppConfigVar"("environmentId", "key");
CREATE INDEX "AppConfigVar_environmentId_idx" ON "AppConfigVar"("environmentId");

ALTER TABLE "AppConfigVar"
    ADD CONSTRAINT "AppConfigVar_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
