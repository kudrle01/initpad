ALTER TABLE "Agent"
ADD COLUMN "credentialActivatedAt" TIMESTAMP(3),
ADD COLUMN "pendingCredentialHash" TEXT,
ADD COLUMN "pendingCredentialGeneration" INTEGER,
ADD COLUMN "pendingCredentialIssuedAt" TIMESTAMP(3);

UPDATE "Agent"
SET "credentialActivatedAt" = COALESCE("enrolledAt", "updatedAt")
WHERE "credentialHash" IS NOT NULL;

ALTER TABLE "Agent"
ADD CONSTRAINT "Agent_pendingCredential_complete_check"
CHECK (
  (
    "pendingCredentialHash" IS NULL
    AND "pendingCredentialGeneration" IS NULL
    AND "pendingCredentialIssuedAt" IS NULL
  )
  OR
  (
    "pendingCredentialHash" IS NOT NULL
    AND "pendingCredentialGeneration" IS NOT NULL
    AND "pendingCredentialIssuedAt" IS NOT NULL
    AND "pendingCredentialGeneration" > "credentialGeneration"
  )
);

CREATE UNIQUE INDEX "Agent_pendingCredentialHash_key"
ON "Agent"("pendingCredentialHash");
