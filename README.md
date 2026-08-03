# InitPad

InitPad je interní vývojářská platforma pro školy, menší týmy a firemní
sandboxy. Z jednoho formuláře připraví soukromý Git repozitář, výchozí kód,
CI pipeline a prostředí `dev → test → prod`. Vývojář tak nemusí pro každý
projekt znovu skládat Docker, CI/CD a základní provozní konfiguraci.

Projekt vzniká jako praktická část diplomové práce na Vysoké škole ekonomické
v Praze. Cílem není nahradit Kubernetes nebo velké platform-engineering
produkty. InitPad zkoumá, jak lze jejich hlavní principy zpřístupnit v menším,
srozumitelném a samostatně nasaditelném systému.

## Co lze vyzkoušet

- registraci nebo administrátorem spravované účty;
- osobní a týmové workspaces s rolemi;
- založení projektu ze dvanácti udržovaných šablon;
- import existujícího repozitáře;
- automatický build, test a nasazení do dev;
- povýšení stejného buildu do testu a produ;
- Docker, SSH a SFTP targety včetně PHP hostingu;
- historii commitů, CI jobů a deployment operací;
- bezpečné odstranění deploymentu i celého projektu.

Self-hosted edice používá vestavěnou Giteu, Gitea Actions a privátní OCI
registry. GitHub varianta umí přihlášení, instalaci GitHub App, založení nebo
import repozitáře a převzetí ověřeného Actions artefaktu. Veřejný SaaS zatím
není hotový produkční profil; vzdálené servery bude bezpečně připojovat
připravovaný InitPad Agent.

## Rychlé spuštění

Jediným požadavkem je Docker s Compose pluginem:

```bash
git clone <adresa-repozitare> initpad
cd initpad/deploy
./install.sh
```

Po dokončení otevři:

- InitPad: <http://localhost:8080>
- Gitea: <http://gitea.localhost:3001>

Instalátor vygeneruje lokální secrety, spustí databázi a služby, aplikuje
migrace, nastaví SSO a zaregistruje izolovaný CI runner. Je idempotentní, takže
slouží i pro aktualizaci existující instalace.

První ověření je jednoduché: vytvoř účet, založ projekt, otevři jeho CI
pipeline a počkej na dev URL. Podrobné nasazení na server, DNS a HTTPS popisuje
[deploy/README.md](deploy/README.md).

## Projektové šablony

| Ekosystém | Šablony |
|---|---|
| JavaScript / TypeScript | Express, NestJS, Next.js, React + Vite, Vue + Vite |
| Python | Django, FastAPI, Flask |
| PHP | PHP, Laravel, Nette, Symfony |

Každá šablona obsahuje reprodukovatelné závislosti, Dockerfile, health
endpoint a CI workflow. PHP frameworky mají verzovaný skeleton i
`composer.lock`; framework se negeneruje až během deploymentu.

## Lokální vývoj

Požadavky: Node.js 20+ a Docker.

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres gitea
cp apps/api/.env.example apps/api/.env
npm run db:migrate --workspace @initpad/api
npm run dev:api
```

Ve druhém terminálu:

```bash
npm run dev:web
```

Web běží na <http://localhost:5173>, API na
<http://localhost:3000/api>. Vývojový stack v `infra/` a kompletní stack v
`deploy/` nespouštěj současně; záměrně sdílejí Compose project name.

## Kontrola změn

```bash
npm run build
npm test --workspace @initpad/api -- --runInBand
npm audit --audit-level=low
docker compose -f deploy/docker-compose.yml --profile runner config --quiet
```

Změna šablony navíc vyžaduje vyrenderovat vzorový projekt a ověřit jeho
instalaci, test a Docker build.

## Důležité omezení

Self-hosted profil je single-node systém určený pro důvěryhodnou organizaci.
Workspace RBAC odděluje data aplikace, ale není bezpečnostní hranicí proti
škodlivému workloadu na sdíleném Docker hostu. Tento profil proto bez další
izolace nevystavuj jako nepřátelský multi-tenant SaaS. Podrobnosti jsou v
[THREAT_MODEL.md](THREAT_MODEL.md).

## Dokumentace

- [deploy/README.md](deploy/README.md) — instalace;
- [deploy/OPERATIONS.md](deploy/OPERATIONS.md) — provoz, zálohy a obnova;
- [deploy/SELF_HOSTED_ACCEPTANCE.md](deploy/SELF_HOSTED_ACCEPTANCE.md) — živé ověření;
- [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md) — stav a další milníky;
- [DECISIONS.md](DECISIONS.md) — architektonická rozhodnutí;
- [THREAT_MODEL.md](THREAT_MODEL.md) — hranice důvěry a produkční podmínky.

Osobní poznámky, handoffy a jednorázová vysvětlení nejsou součástí
produktové dokumentace a do repozitáře se necommitují.
