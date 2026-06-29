# InitPad – prototyp IDP

Interní platforma pro vývojáře (diplomová práce). Vývojář klikne „nový projekt“,
vybere šablonu a platforma připraví repo, kód, CI/CD a běžící aplikaci v
promotion pipeline **dev → test → prod**, kde cíl nasazení řídí zvolený
**provider** (Docker / SFTP / SSH).

## Struktura (monorepo)
```
platform/
├── apps/
│   ├── api/        backend (NestJS) – projekty, šablony, generátor, nasazení
│   └── web/        frontend (React + Vite) – dashboard, formulář, detail
├── templates/      katalog šablon (data-driven; node-express)
├── infra/          docker-compose (simulované prostředí)
└── package.json    npm workspaces
```

## Spuštění (vývoj)
Potřeba Node 20+. Ze složky `platform/`:
```bash
npm install            # nainstaluje workspaces

# terminál 1 – backend (http://localhost:3000/api)
npm run dev:api

# terminál 2 – frontend (http://localhost:5173)
npm run dev:web
```
Frontend proxuje `/api` na backend. Otevři `http://localhost:5173`.

## Co už funguje (F2 skeleton)
- katalog šablon z disku (`/api/templates`)
- vytvoření projektu → generování ze šablony (Handlebars) do `.workspace/<projekt>`
- prostředí dev/test/prod s providerem, auto-deploy do dev
- promote dev → test → prod
- dashboard, formulář, detail s promotion pipeline

## Zatím simulováno (další iterace)
- nasazení (DockerProvider/SftpProvider/SshProvider vrací výsledek bez reálného
  spuštění) → F2/F3 reálné Docker API, SFTP upload, SSH
- Gitea repo + Gitea Actions CI → zatím lokální složka jako repo
- PostgreSQL → zatím in-memory store

## Mapování na plán
Viz `../PLAN.md` (fáze, providery, šablony, evaluace).
