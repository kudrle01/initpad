# Předání práce (session → další agent / Codex)

Shrnutí toho, co bylo hotové v této session, ať navazující agent plynule převezme.
Pracovalo se přesně podle `CLAUDE_HANDOFF.md` (malé atomické commity, aditivní
migrace, „hotovo" = podložené testem). Fázové sekce v `CLAUDE_HANDOFF.md` a
`PRODUCT_ROADMAP.md` jsou aktualizované.

## Výchozí bod a HEAD

- Baseline před touto session: `d6ea2d8^` (poslední commit této session je `48d5885`).
- **HEAD = `48d5885`**.
- Build zelený: `apps/api` `tsc` ✓, **53 test suites / 328 testů** ✓; `apps/web` `tsc` ✓.

## Co bylo dokončeno

**1. Durable artifact object storage — ADR-059 (Fáze 1) ✅**
Ověřený build se ukládá do S3-compatible object storage (MinIO lokálně / S3 cloud),
ne jen do lokálního Docker daemonu.
- `apps/api/src/artifacts/`: `ArtifactStore` (put/head/getToFile/delete/presignGet),
  `S3ArtifactStore`, `InMemoryArtifactStore`, `artifactObjectKey` (tenant-scoped),
  daemon-free `assertImageArchiveIdentity`, `ArtifactsModule` (S3 když nakonfig.,
  jinak in-memory; SaaS selže hlasitě přes `validateConfig`).
- Atomický ingest + rehydratace + retention/GC + job-scoped presigned GET
  v `projects.service.ts`. `storageKind=object-store`, `storageRef=<opaque key>`;
  Docker image ref se odvozuje zvlášť (`artifactImageRef`).
- `deploy/docker-compose.yml`: `minio` + `minio-init` (private bucket) + `minio-data`
  volume; `INITPAD_ARTIFACT_S3_*` v `.env.example`.

**2. Workspace-scoped TargetAllocation — ADR-060 (Fáze 2/„Fáze 4" roadmapy) ✅**
Odděluje fyzický `Target` (+credentials) od jeho použití workspace.
- Model `TargetAllocation` + `Environment.allocationId` (aditivní migrace).
- Startup backfill/reconcile (zachová URL a ESO cesty), deploy routovaný přes
  allocation, CRUD `/allocations` + role (owner/admin spravuje, member čte,
  cizí workspace **404**), kvóty + `disabled` při deploy, UI sekce „Allocations".
- Otevřené: **živý dvou-workspace acceptance test** (automatická izolace je pokrytá testy).

**3. Per-environment app config & secrets — ADR-061 ✅**
Nasazovaná aplikace má konfiguraci/secrety na (projekt, prostředí).
- Model `AppConfigVar` (aditivní migrace); secrety šifrované at-rest, v API maskované.
- CRUD `/projects/:id/environments/:env/config` (project-write role); injektáž do
  Docker container `Env` při deploy (build-once zachován). UI: sekce „Configuration".
- Otevřené rozšíření: injektáž i pro SSH/SFTP, sdílené vary na úrovni workspace/allocation.

**4. Provozní zajištění self-hosted — ADR-062 ✅**
- `deploy/backup.sh` (pg_dump + tar volumes vč. **minio-data**, rotace),
  `deploy/restore.sh` (destruktivní, potvrzovaný), `deploy/cleanup.sh` (bezpečný prune),
  `deploy/OPERATIONS.md` (runbook).
- Volitelné interní-CA HTTPS: `INITPAD_TLS_DIRECTIVE="tls internal"` (Caddyfile + compose).

## Nové DB migrace (nutné aplikovat na reálné DB)

- `apps/api/prisma/migrations/20260721000000_target_allocation`
- `apps/api/prisma/migrations/20260721010000_app_config_var`

Obě jsou **aditivní**. Na reálném nasazení: `prisma migrate deploy` (nebo `./install.sh`
přestaví API; migrace se aplikují běžným způsobem projektu).

## Nová ADR

ADR-059, ADR-060, ADR-061, ADR-062 v `DECISIONS.md`.

## Commity této session (nejnovější nahoře)

```
48d5885 docs(ops): operations runbook (ADR-062 OB.4)
24c04eb feat(ops): internal-CA HTTPS + safe disk cleanup (ADR-062 OB.3)
fbdb83c feat(ops): backup rotation + minio-data + restore (ADR-062 OB.2)
9b6a4e1 docs: ADR-062 operational readiness
112b8e2 docs: record per-env config & secrets (ADR-061 FC.6)
5e16e45 feat(web): environment variables UI (ADR-061 FC.5)
9438ca5 feat(config): inject config at deploy (ADR-061 FC.4)
4d7f37c feat(config): config & secrets CRUD API (ADR-061 FC.3)
5e23cb9 feat(config): AppConfigVar model + migration (ADR-061 FC.2)
a4e077f docs: ADR-061 per-environment app config & secrets
9018045 feat(web): allocations UI + Phase 2 docs (ADR-060 P2.6)
4fabb26 feat(targets): allocation quota + disabled (ADR-060 P2.5)
b83014a feat(targets): allocation CRUD API + role auth (ADR-060 P2.4)
e6bda5c feat(targets): route deploy through allocation (ADR-060 P2.3)
d87192c feat(targets): backfill + reconcile (ADR-060 P2.2)
61971b0 feat(targets): TargetAllocation model + migration (ADR-060 P2.1)
b8c3d7c docs: ADR-060 TargetAllocation foundation
b097cb3 feat(artifacts): MinIO compose + env + tests (ADR-059 P1.9)
f2ce61a feat(artifacts): job-scoped presigned GET (ADR-059 P1.8)
963d1bc feat(artifacts): retention GC + delete cleanup (ADR-059 P1.7)
bfb121f feat(artifacts): atomic ingest + rehydration (ADR-059 P1.5/P1.6)
8f642e8 refactor(artifacts): daemon-free archive verifier (ADR-059 P1.4)
1ca43d9 feat(artifacts): S3ArtifactStore + module (ADR-059 P1.2)
a08f7bc feat(artifacts): ArtifactStore + keys + config (ADR-059 P1.2/P1.3)
d6ea2d8 docs: ADR-059 durable artifact object storage
```

## NETKNOUT (netrackované, ponech)

- `VYSVETLENI_zmen.md` (uživatelův soubor).
- `deploy/DEPLOYMENT_RASPBERRY_PI.md` (uživatel řekl „jen pro mě", necommitovat).

## Poznámky k prostředí (stejný sandbox)

- macOS→Linux mount blokuje `unlink()`: git commituj přes `/tmp/gitc.sh`
  (GIT_INDEX_FILE v /tmp; stale locky se odsouvají). Varování „unable to unlink"
  u git objektů jsou neškodná, commit projde.
- `prisma generate`: přejmenuj `node_modules/.prisma/client` → `client.stale.<ts>`
  (nelze `unlink`) a pak `npx prisma generate`.
- `vite build` v sandboxu selže (chybí `@rolldown/binding-linux-arm64-gnu`);
  web se ověřuje přes `tsc --noEmit`. Na reálném x86 hostu build v Docker image projde.

## Co zbývá / doporučené pořadí

1. **Živý dvou-workspace acceptance test Fáze 2** (izolace: cizí allocation 404,
   nezávislé namespace/kvóty) — dělá se nasazením self-hosted na reálný host/VM.
2. **Fáze 0** (odloženo): živý GitHub E2E po ADR-058 (potřebuje veřejné HTTPS).
3. **Fáze 3 — InitPad Agent** (ADR-029): enrollment, identita, HTTPS polling,
   durable leased job; první řez `DEPLOY_SERVICE`/`GET_SERVICE_STATUS`/`REMOVE_SERVICE`,
   allocation-scoped, artifact přes presigned GET. Nezačínat před bodem 1.
4. **Fáze 4** — reálný SaaS profil bez Gitey.
5. Volitelně školní vylepšení (roster + SMTP, učitelský dohled napříč týmy),
   rozšíření config injektáže na SSH/SFTP.

## Rychlé ověření

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json && npx jest
cd ../web && npx tsc --noEmit
```
