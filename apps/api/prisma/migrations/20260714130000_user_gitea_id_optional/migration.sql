-- Allow accounts with no embedded-Gitea identity (GitHub-only SaaS sign-in).
-- Relaxing NOT NULL keeps every existing row and its value; the unique index
-- still holds (Postgres permits multiple NULLs).
ALTER TABLE "User" ALTER COLUMN "giteaId" DROP NOT NULL;
