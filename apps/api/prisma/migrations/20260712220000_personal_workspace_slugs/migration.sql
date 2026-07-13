-- Reserve the personal-* namespace so a team created before a future user
-- cannot block that user's personal workspace during registration.
UPDATE "Workspace"
SET "slug" = 'personal-' || "slug"
WHERE "type" = 'personal' AND "slug" NOT LIKE 'personal-%';
