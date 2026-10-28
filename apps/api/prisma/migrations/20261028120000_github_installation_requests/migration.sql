-- GitHub App installation requests (ADR-044). A non-owner organization member
-- can only request the App; the org owner approves it later, outside the
-- one-time setup redirect. The requester's GitHub id from the signed
-- `installation.created` webhook and the requested setup state let the
-- requester's workspace claim the approved installation.

ALTER TABLE "GitHubInstallation"
  ADD COLUMN "requesterAccountId" TEXT;

ALTER TABLE "GitHubInstallationSetup"
  ADD COLUMN "requestedAt" TIMESTAMP(3);
