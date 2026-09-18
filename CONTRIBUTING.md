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

The supported local toolchain is Node.js 22.12 or newer and Docker with the
Compose plugin.

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

Run the same deterministic gate used by CI:

```bash
npm run check
```

Before a release-sensitive change, also run:

```bash
npm run check:release
docker compose -f deploy/docker-compose.yml --profile runner config --quiet
```

Changes to templates or container images must pass the dedicated image workflow
or the relevant local image probes.

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

By contributing, you agree that your contribution is licensed under the
Apache License 2.0 used by this project.
