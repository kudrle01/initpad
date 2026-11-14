-- Tracks managed accounts whose local Gitea password is already randomized,
-- so startup hardening runs only for accounts that still need it.
ALTER TABLE "User" ADD COLUMN "giteaPasswordHardenedAt" TIMESTAMP(3);
