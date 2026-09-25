-- Authentication identifiers are case-insensitive. Keep Prisma's exact unique
-- constraints and add database-level functional indexes so concurrent writes
-- cannot create identities such as `Carol` and `carol`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    GROUP BY LOWER("username")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enable case-insensitive usernames: duplicate identities exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "email" IS NOT NULL
    GROUP BY LOWER("email")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enable case-insensitive e-mails: duplicate identities exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "User_username_ci_key" ON "User" (LOWER("username"));
CREATE UNIQUE INDEX "User_email_ci_key" ON "User" (LOWER("email")) WHERE "email" IS NOT NULL;
