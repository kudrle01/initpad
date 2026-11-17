-- Additive: GitHub organization memberships of team workspace members (ADR-189).
CREATE TABLE "GitHubOrgMembership" (
    "id" TEXT NOT NULL,
    "githubInstallationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "invitedByInitPad" BOOLEAN NOT NULL,
    "state" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubOrgMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GitHubOrgMembership_state_check" CHECK ("state" IN ('pending', 'active'))
);

CREATE UNIQUE INDEX "GitHubOrgMembership_githubInstallationId_userId_key" ON "GitHubOrgMembership"("githubInstallationId", "userId");
CREATE INDEX "GitHubOrgMembership_userId_idx" ON "GitHubOrgMembership"("userId");

ALTER TABLE "GitHubOrgMembership"
ADD CONSTRAINT "GitHubOrgMembership_githubInstallationId_fkey"
FOREIGN KEY ("githubInstallationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubOrgMembership"
ADD CONSTRAINT "GitHubOrgMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
