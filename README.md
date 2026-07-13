# InitPad — internal developer platform

InitPad je self-hosted vývojářská platforma pro výuku, malé týmy a organizace,
které chtějí standardizovat založení projektu bez zavedení celého enterprise
platform-engineering stacku. Z jednoho formuláře vytvoří privátní Git repozitář,
zdrojový scaffold, reprodukovatelnou CI pipeline, OCI image a prostředí
`dev → test → prod`.

Nejde o náhradu Kubernetes ani o obecný cloud. Aktuální produkt je bezpečný
single-node control plane a realistická simulace firemního delivery procesu.
Pro větší produkční provoz se mají deployment providery přesunout na oddělené
agenty nebo Kubernetes; viz [THREAT_MODEL.md](THREAT_MODEL.md).

## Co funguje

- platform-native účty, první účet při výchozí instalaci, HTTP-only session a
  OIDC SSO z InitPadu do Gitey;
- Gitea jako SCM, Actions a OCI registry, privátní repozitáře a tokeny oddělené
  pro každý projekt;
- osobní a týmové workspaces, přepínání tenantů, role owner/admin/maintainer/
  member/viewer a synchronizace přístupu do privátních repozitářů;
- izolovaný rootless CI daemon bez přístupu k Docker socketu hostitele;
- skutečné testy, zamčené závislosti a Dockerfile v každém golden pathu;
- build once, deploy many: hash commitu označuje image propagovaný do dev/test/prod;
- Docker, SSH a SFTP targety, ověření spojení, healthchecky, logy, stop/start,
  redeploy, teardown a ochrana proti souběžným deployům;
- verzované Prisma migrace, readiness/liveness, resource limity, security
  headers, backup skript a automatické HTTPS v server profilu.

## Golden paths

Node/JS: Express, NestJS, Next.js, React + Vite, Vue + Vite. Python: Django,
FastAPI, Flask. PHP: jednoduché PHP, Laravel, Nette a Symfony. Laravel/Nette/
Symfony obsahují zdrojový skeleton i `composer.lock`; framework se negeneruje
až během release buildu.

## Instalace jedním příkazem

Požadavek: Docker s Compose pluginem.

```bash
cd deploy
./install.sh
```

Platforma běží na `http://localhost:8080`, Gitea na
`http://gitea.localhost:3001`. Instalátor vygeneruje secrety, vytvoří servisní
účet, aplikuje migrace, nastaví OIDC a zaregistruje runner. Je idempotentní;
upgrade se provádí `git pull && ./install.sh`.

Serverovou instalaci, DNS/TLS, zálohu a restore drill popisuje
[deploy/README.md](deploy/README.md).

## Lokální vývoj

Požadavek: Node.js 20+ a Docker.

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres gitea
cp apps/api/.env.example apps/api/.env
npm run db:migrate --workspace @initpad/api
npm run dev:api
# v druhém terminálu
npm run dev:web
```

Web je na `http://localhost:5173`, API na `http://localhost:3000/api`.
Plný kontejnerový stack v `deploy/` a vývojový stack v `infra/` nespouštějte
současně — sdílejí jméno Compose projektu.

## Architektura a tok změny

```text
Developer → InitPad web/API → Gitea repository
                              ↓ push
                     isolated Actions runner
                              ↓ test/build/push
                         Gitea OCI registry
                              ↓ signed per-repo callback
                      deploy dev → test → prod
```

Zdroj pravdy pro kód je Gitea, pro metadata PostgreSQL a pro artefakty OCI
registry. Asynchronní deployment má per-environment operation lock; po restartu
se přerušená operace označí jako failed a nemůže přepsat novější stav.

## Ověření kvality

```bash
npm run build
npm run test --workspace @initpad/api -- --runInBand
npm audit --audit-level=low
docker compose -f deploy/docker-compose.yml --profile runner config --quiet
```

Každý template se při změně má vyrenderovat se vzorovým názvem a spustit jeho
lockfile install, test a build. PHP frameworky mají navíc `composer audit
--locked` a Docker `test` stage.

## Produktové zaměření

Nejsilnější tržní pozice není „menší Backstage pro enterprise“, ale rychle
nasaditelný paved road pro školy, bootcampy, interní sandboxy a malé týmy:
jednotný onboarding, auditovatelný promotion flow a možnost připojit vlastní
VPS/SFTP bez znalosti CI syntaxe. Další nejhodnotnější investice jsou školní
předměty a pozvánky, import existujících repozitářů, target allocations,
approval flow, template versioning, observability a oddělený deployment agent.

Návrhová rozhodnutí jsou v [DECISIONS.md](DECISIONS.md).
