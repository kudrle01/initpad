-- Team membership is now limited to existing accounts (added directly by
-- username/e-mail), so the token-based invitation subsystem is removed. This
-- only drops pending invitations; user accounts, workspaces and memberships
-- are untouched.

-- DropForeignKey
ALTER TABLE "WorkspaceInvitation" DROP CONSTRAINT "WorkspaceInvitation_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceInvitation" DROP CONSTRAINT "WorkspaceInvitation_invitedById_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceInvitation" DROP CONSTRAINT "WorkspaceInvitation_acceptedById_fkey";

-- DropTable
DROP TABLE "WorkspaceInvitation";
