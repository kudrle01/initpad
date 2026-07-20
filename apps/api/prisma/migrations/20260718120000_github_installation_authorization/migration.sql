-- Secure GitHub App installation setup and workspace authorization (ADR-044).
-- Existing installation rows remain valid legacy records, but accountId is
-- intentionally nullable until a verified webhook/setup callback supplies the
-- immutable GitHub account id.

ALTER TABLE "GitHubInstallation"
  ADD COLUMN "accountId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "GitHubInstallation_accountId_idx"
  ON "GitHubInstallation"("accountId");

CREATE TABLE "GitHubInstallationAccess" (
  "id" TEXT NOT NULL,
  "githubInstallationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "authorizedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GitHubInstallationAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubInstallationAccess_githubInstallationId_workspaceId_key"
  ON "GitHubInstallationAccess"("githubInstallationId", "workspaceId");
CREATE INDEX "GitHubInstallationAccess_workspaceId_idx"
  ON "GitHubInstallationAccess"("workspaceId");
CREATE INDEX "GitHubInstallationAccess_authorizedById_idx"
  ON "GitHubInstallationAccess"("authorizedById");

ALTER TABLE "GitHubInstallationAccess"
  ADD CONSTRAINT "GitHubInstallationAccess_githubInstallationId_fkey"
  FOREIGN KEY ("githubInstallationId") REFERENCES "GitHubInstallation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallationAccess"
  ADD CONSTRAINT "GitHubInstallationAccess_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallationAccess"
  ADD CONSTRAINT "GitHubInstallationAccess_authorizedById_fkey"
  FOREIGN KEY ("authorizedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GitHubInstallationSetup" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GitHubInstallationSetup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubInstallationSetup_tokenHash_key"
  ON "GitHubInstallationSetup"("tokenHash");
CREATE INDEX "GitHubInstallationSetup_userId_workspaceId_idx"
  ON "GitHubInstallationSetup"("userId", "workspaceId");
CREATE INDEX "GitHubInstallationSetup_expiresAt_idx"
  ON "GitHubInstallationSetup"("expiresAt");

ALTER TABLE "GitHubInstallationSetup"
  ADD CONSTRAINT "GitHubInstallationSetup_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubInstallationSetup"
  ADD CONSTRAINT "GitHubInstallationSetup_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
