# InitPad – prototyp IDP

Interní platforma pro vývojáře (diplomová práce). Vývojář klikne „nový projekt“,
vybere šablonu a platforma připraví repo, kód, CI/CD a běžící aplikaci v
promotion pipeline **dev → test → prod**, kde cíl nasazení řídí zvolený
**provider** (Docker / SFTP / SSH).

## Struktura (monorepo)
```
initpad/
├── apps/
│   ├── api/        backend (NestJS) – projekty, šablony, generátor, nasazení, SCM
│   └── web/        frontend (React + Vite) – dashboard, formulář, detail
├── templates/      katalog šablon (data-driven; node-express)
├── infra/          docker-compose (simulované prostředí)
└── package.json    npm workspaces
```

## Spuštění (vývoj)
Potřeba Node 20+ a Docker (kvůli PostgreSQL). Ze složky `initpad/`:
```bash
npm install                                          # workspaces + prisma generate

# 1) databáze (PostgreSQL v Dockeru)
docker compose -f infra/docker-compose.yml up -d postgres

# 2) konfigurace + migrace schématu
cd apps/api && cp .env.example .env && npm run db:migrate && cd ../..

# 3) backend (http://localhost:3000/api)
npm run dev:api

# 4) frontend (http://localhost:5173), v druhém terminálu
npm run dev:web
```
Frontend proxuje `/api` na backend. Otevři `http://localhost:5173`.
Projekty se ukládají do PostgreSQL, takže přežijí restart.

## Gitea (volitelné)
Bez konfigurace zůstává repo jen lokální složkou. Pro reálná Git repa:
```bash
docker compose -f infra/docker-compose.yml up -d gitea   # http://localhost:3001
```
V Gitea web UI založ uživatele a vytvoř access token (Settings → Applications).
Pak v `apps/api/` zkopíruj `.env.example` na `.env` a vyplň
`INITPAD_GITEA_URL/USER/TOKEN`. Po vytvoření projektu platforma založí repo a
pushne do něj scaffold; odkaz se objeví v detailu projektu.

## CI/CD (Gitea Actions)
Vygenerovaný `.gitea/workflows/ci.yml` (joby build → test → docker build →
deploy) běží reálně na Gitea Actions runneru. Stav pipeline platforma čte
z commit statusů Gitey a ukazuje ho v detailu projektu u každého commitu.

Jednorázové zapnutí runneru (Gitea musí běžet a mít založený admin účet):
```bash
docker compose -f infra/docker-compose.yml up -d gitea postgres
./infra/register-runner.sh         # vygeneruje registrační token + vypíše příkaz
# spusť vypsaný příkaz, např.:
INITPAD_RUNNER_TOKEN=<token> \
  docker compose -f infra/docker-compose.yml --profile ci up -d act_runner
```
Runner si registraci uloží do volume `runner-data`, takže token je potřeba jen
poprvé. Krok `docker build` v CI staví image přes hostitelský Docker daemon
(socket je vmountovaný do runneru). Platforma u nově vytvořených repozitářů
Actions zapíná automaticky (`has_actions`).

**Pozn.:** Labely runneru (`ubuntu-latest`) se zapisují **při registraci** z env
`GITEA_RUNNER_LABELS`. Když runner hlásí *„no matching online runner with label
ubuntu-latest"*, je buď offline, nebo se zaregistroval se špatnými labely. Pak je
nutná re-registrace (smaž `runner-data` volume a registruj znovu):
```bash
docker compose -f infra/docker-compose.yml --profile ci down
docker volume rm initpad_runner-data
./infra/register-runner.sh
INITPAD_RUNNER_TOKEN=<token> \
  docker compose -f infra/docker-compose.yml --profile ci up -d act_runner
docker compose -f infra/docker-compose.yml --profile ci logs -f act_runner
```
Stav runneru ověříš v Gitea UI: Site Administration → Actions → Runners (musí být
zelený a mít label `ubuntu-latest`).

## Přihlášení (Gitea OAuth2 SSO)
Aplikace vyžaduje přihlášení přes Gitea. V Gitea: Settings → Applications →
**Create OAuth2 Application**, Redirect URI = `http://localhost:3000/api/auth/callback`.
Vzniklé `Client ID` a `Client Secret` vyplň do `apps/api/.env`
(`INITPAD_OAUTH_CLIENT_ID/SECRET`) spolu s náhodným `INITPAD_JWT_SECRET`.
Po `npm run db:migrate` (vytvoří tabulku uživatelů) se na `:5173` zobrazí
přihlašovací obrazovka; projekty patří přihlášenému uživateli.

## Co už funguje
- **Přihlášení přes Gitea** (OAuth2 SSO), projekty patří uživateli (PostgreSQL)
- katalog šablon z disku (`/api/templates`)
- vytvoření projektu → generování ze šablony (Handlebars) do `.workspace/<projekt>`
- **Gitea**: založení repa + push scaffoldu (s fallbackem na lokální složku)
- **Docker**: reálný build image a běh kontejneru v dev (s fallbackem bez Dockeru)
- **Gitea Actions CI**: workflow build → test → docker build na push reálně proběhne;
  stav pipeline se zobrazuje u commitů v detailu projektu
- prostředí dev/test/prod s providerem, auto-deploy do dev, promote dev → test → prod
- dashboard, formulář, detail s promotion pipeline

## Zatím simulováno (další iterace)
- SftpProvider / SshProvider vracejí výsledek bez reálného uploadu/SSH
- CI → deploy: deploy job v CI je zatím placeholder; nasazení image po úspěšném
  buildu řídí platforma in-process (napojení CI → DeploymentProvider je další krok)

## Mapování na plán
Viz `../PLAN.md` (fáze, providery, šablony, evaluace).
