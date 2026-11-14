# Contributing to InitPad

InitPad is an internal developer platform and a university thesis project. Bug
reports, focused fixes, documentation improvements and additional acceptance
evidence are welcome.

## Before opening a change

- Use a GitHub issue or discussion for a change that alters architecture,
  security boundaries or user-visible workflow.
- Keep pull requests focused. Do not combine an unrelated refactor with a
  functional change.
- Never commit credentials, enrollment tokens, private keys, runtime `.env`
  files, backups or machine-specific notes.
- Report security issues privately according to [SECURITY.md](SECURITY.md).

## Development setup

The supported local toolchain is the Node.js 26 LTS line (`.node-version`; CI,
release workflows and every platform image use the same line) and Docker with
the Compose plugin.

```bash
npm ci
docker compose -f infra/docker-compose.yml up -d postgres gitea
cp apps/api/.env.example apps/api/.env
npm run db:migrate --workspace @initpad/api
npm run dev:api
```

Run `npm run dev:web` in a second terminal. See [README.md](README.md) and
[deploy/README.md](deploy/README.md) for the complete development and
self-hosted flows.

## Required checks

Run the same deterministic, offline gate that CI runs on every pull request:

```bash
npm run check
npm run check:compose
```

`check:compose` renders the self-hosted Compose stack with `.env.example`, the
platform-release override and every profile, exactly as CI does, so it works
on a clean checkout. The encrypted backup test needs
[age](https://github.com/FiloSottile/age); without it the test is skipped with
a warning locally and fails in CI (or with `INITPAD_REQUIRE_AGE=1`).

`npm run audit:dependencies` compares production dependencies with the live
advisory database. It needs network access, so CI runs it on `main` and
nightly instead of on pull requests; `npm run check:release` runs both gates
before a release-sensitive change.

Changes to templates, container images, `package.json` or `package-lock.json`
must pass the `Container images` check. It runs on every pull request and
finishes as a no-op when no image input changed, so it can be required in the
`main` ruleset; Dependabot auto-merge waits for it only while it is required
there.

`main` accepts changes only through pull requests that pass the required
checks, for maintainers too, and never a force push. A platform release is
prepared with `npm run release:platform:prepare -- <version>`, merged as a
`chore(release): prepare InitPad <version>` pull request, and tagged from the
updated `main` with `npm run release:platform:tag -- <version>`.

## Database and compatibility

- Use additive Prisma migrations and keep historical migrations intact.
- Preserve upgrade, backup and restore paths for existing self-hosted installs.
- Treat public API, Agent job and release manifest formats as versioned
  contracts.
- Add a regression test before changing a security or lifecycle invariant.

## Commits and documentation

Use small commits with an imperative subject such as `fix(agent): ...` or
`docs(release): ...`. Update the relevant ADR or roadmap entry when a decision
or milestone changes. Local review notes, editor instructions, scratch files
and generated runtime data do not belong in the repository. Comments should
explain an invariant, security boundary or non-obvious trade-off; do not narrate
code that is already clear from its names and types.

Documentation is kept current by three checks:

- `npm run audit:repo` (every pull request) fails on a Markdown link to a
  missing file and on an `npm run` command that no `package.json` defines.
- `npm run audit:docs` compares `README.md`, `docs/RELEASE_READINESS.md`,
  `THREAT_MODEL.md` and `apps/agent/README.md` with the newest published
  platform release and the reviewed Agent in `deploy/agent-release.env`. The
  *Documentation freshness* workflow runs it after every release and weekly,
  and keeps one issue open while the documents are behind.
- The pull request template asks which documents a change affects.

When a release changes what these documents describe, update them in the
release pull request or right after the release, keeping verified history
(such as the live acceptance baseline) separate from the newest release.

By contributing, you agree that your contribution is licensed under the
Apache License 2.0 used by this project.
