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

## Co už funguje
- katalog šablon z disku (`/api/templates`)
- vytvoření projektu → generování ze šablony (Handlebars) do `.workspace/<projekt>`
- **Gitea**: založení repa + push scaffoldu (s fallbackem na lokální složku)
- **Docker**: reálný build image a běh kontejneru v dev (s fallbackem bez Dockeru)
- prostředí dev/test/prod s providerem, auto-deploy do dev, promote dev → test → prod
- dashboard, formulář, detail s promotion pipeline

## Zatím simulováno (další iterace)
- SftpProvider / SshProvider vracejí výsledek bez reálného uploadu/SSH
- Gitea Actions CI (build/test v repu) → zatím neběží
- PostgreSQL → zatím in-memory store

## Mapování na plán
Viz `../PLAN.md` (fáze, providery, šablony, evaluace).
