-- Correct legacy repository owners when the Gitea public URL contains a path
-- prefix (for example https://host/git/owner/repo). The initial migration used
-- the first path segment; the canonical owner is the penultimate segment.
-- Rows already hydrated with an immutable provider id are deliberately left
-- untouched and will be refreshed by normal provider reconciliation.
UPDATE "Project"
SET
  "scmOwner" = substring("repoUrl" from '/([^/]+)/[^/]+/?$'),
  "scmFullName" = substring("repoUrl" from '/([^/]+)/[^/]+/?$') || '/' || "scmRepositoryName"
WHERE
  "scmProvider" = 'gitea'
  AND "scmRepositoryId" IS NULL
  AND NULLIF(substring("repoUrl" from '/([^/]+)/[^/]+/?$'), '') IS NOT NULL;
