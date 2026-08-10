# InitPad — provozní runbook (self-hosted)

Provozní příručka pro self-hosted nasazení na jednom hostu (ADR-062). Cílem je,
aby InitPad byl bezpečně provozovatelný ve škole nebo malé firmě: data se
neztratí, běží spolehlivě a jde snadno spravovat. Všechny příkazy spouštěj z
adresáře `deploy/`.

Kompletní instalační a uživatelský test na Ubuntu VM je v
[`SELF_HOSTED_ACCEPTANCE.md`](./SELF_HOSTED_ACCEPTANCE.md). Je to závazný živý
gate před implementací Agenta; samotné unit testy tenant izolaci na skutečném
Docker hostu neprokazují.

## Start / stop / stav

```bash
./install.sh                 # první instalace i idempotentní oprava/upgrade
docker compose ps            # stav služeb
docker compose logs -f api   # živé logy platformy
docker compose stop          # zastavit vše (data zůstávají)
docker compose up -d         # znovu nastartovat
```

Kontejnery mají `restart: unless-stopped`, takže po restartu hosta naběhnou samy
(pokud se startuje Docker démon při bootu: `sudo systemctl enable docker`).

## Zdraví

- API health: `http://<host>:8080/api/health/ready` (přes proxy `/api/health/ready`).
- Rychlá kontrola: `docker compose ps` — `api` musí být `healthy`.

## Zálohy

Automatická záloha databáze (pg_dump) + datových volumes (Gitea repozitáře,
MinIO artefakty, workspace) do `./backups/<časové-razítko>/`:

```bash
./backup.sh
```

Skript vytvoří společný konzistentní checkpoint: na dobu snapshotu krátce
zastaví platformní zapisovatele a potom obnoví přesně ty služby, které před
zálohou běžely. Počítej proto s krátkým servisním oknem; při chybě se skript
pokusí původní stav služeb obnovit také.

Naplánuj přes cron (např. denně ve 2:00, ponech 7 posledních):

```cron
0 2 * * *  cd /cesta/k/initpad/deploy && INITPAD_BACKUP_KEEP=7 ./backup.sh >> ./backups/backup.log 2>&1
```

Záloha **obsahuje `.env` se secrety a všechna data** — ukládej ji jako důvěrnou,
kopíruj **offsite** a ideálně **šifruj** (např. `age`/`gpg`). Rotace nechává
posledních `INITPAD_BACKUP_KEEP` záloh (výchozí 7).

## Obnova

Obnovení z konkrétní zálohy (DESTRUKTIVNÍ — přepíše aktuální data):

```bash
./restore.sh ./backups/20260101T020000Z
```

Skript ověří kontrolní součty, zastaví zapisovatele, obnoví DB a volumes a stack
znovu nastartuje včetně CI runneru a nakonfigurovaného HTTPS profilu. Součástí
obnovy je zálohovaný `.env`, protože obsahuje šifrovací klíč a identity služeb;
předchozí konfigurace zůstane jako chráněný
`.env.before-restore-<časové-razítko>`. **Pravidelně obnovu testuj na
jednorázovém hostu/VM** — nevyzkoušená záloha není záloha. Po obnově spusť
`./install.sh`, pokud je potřeba dorovnat registraci CI runneru.

## Úklid disku

Bezpečné uvolnění místa (jen dangling images + build cache; datové volumes ani
běžící deploye se nedotýká):

```bash
./cleanup.sh
```

Volitelně přes cron (např. týdně). Ověřené buildy v object storage uklízí sama
platforma (retention, ADR-059).

## HTTPS

- **Veřejná doména:** nastav `INITPAD_DOMAIN` + `INITPAD_GIT_DOMAIN` v `.env`,
  otevři porty 80/443 a spusť `./install.sh` — Caddy vystaví Let's Encrypt
  certifikát automaticky.
- **LAN / škola bez veřejné dostupnosti:** navíc nastav
  `INITPAD_TLS_DIRECTIVE="tls internal"`. Caddy pak vydá certifikát z vlastní
  lokální CA. Na klientech buď nainstaluj Caddy root CA (v kontejneru
  `/data/caddy/pki/authorities/local/root.crt`, zálohovaný ve volume
  `caddy-data`), nebo přijmi varování prohlížeče.

## Aktualizace

```bash
./backup.sh                       # 1) vždy nejdřív záloha
git pull                          # 2) nový kód
./install.sh                      # 3) idempotentní upgrade (přestaví api/web)
```

Migrace databáze jsou aditivní; instalátor je idempotentní. Kdyby upgrade
selhal, obnov poslední zálohu (`./restore.sh …`).

## Bezpečnost

- `deploy/.env` obsahuje všechny secrety — omez práva (`chmod 600 .env`), necommituj.
- Veřejně vystav jen porty **80/443** (zbytek za proxy); zbytek drž ve firewallu.
- Registraci drž na `admin-provisioned`, pokud nemá být veřejná.
- Zálohy šifruj a ukládej offsite.

## Kapacita a škálování

- Pro pohodlný self-hosted provoz včetně sestavování šablon počítej
  alespoň se 2 vCPU, 4 GB RAM a 20 GB volného disku. Samotné zobrazení
  aplikace spotřebuje méně; CI build je záměrně nejnáročnější část.
- Orientačně: každý projekt = 3 prostředí; N týmů × 3 běžící kontejnery + CI
  buildy. Hlídej RAM, CPU a **volné místo** (buildy a image rostou).
- `INITPAD_RUNNER_CAPACITY=1` znamená jeden současný CI job a ostatní
  commity pravdivě zobrazí jako `awaiting CI`. Na hostu s dostatkem RAM a CPU
  nastav `2` a znovu spusť `./install.sh`; instalátor vygeneruje runner config a
  runner bezpečně znovu vytvoří. Nezvyšuj hodnotu jen kvůli kratší frontě —
  každý slot může současně provádět náročný Docker build.
- `INITPAD_RUNNER_MEMORY_LIMIT`, `INITPAD_RUNNER_CPU_LIMIT` a
  `INITPAD_RUNNER_PIDS_LIMIT` omezují **součet** všech vnořených CI kontejnerů
  (výchozí hodnoty `1536m`, `1.0`, `512`). Na silnějším hostu je lze zvýšit,
  ale ponech dostatečnou rezervu pro databázi, Gitea, API a běžící aplikace.
  Změnu uplatní opětovné `./install.sh`; nevyžaduje nový projekt.
- Kvóty na tým nastav přes **Allocations** (max prostředí, ADR-060).
- Když jeden host nestačí, přesuň nasazovací cíle na další stroje přes **Agenta**
  (roadmapa), případně managed DB/S3.

## Troubleshooting

- **Něco není `healthy`:** `docker compose logs <služba>`.
- **Plný disk:** `docker system df` → `./cleanup.sh`; zkontroluj `./backups`.
- **CI se nestaví/nenasazuje:** běží profil runneru? `docker compose ps act_runner runner-docker`.
- **Druhý projekt čeká:** při kapacitě 1 je to backpressure, ne konflikt.
  První commit má `running`, druhý `awaiting CI`; jakmile aktivní job uvolní
  slot, runner si sám převezme další. Pokud oba zůstanou čekat, zkontroluj
  log `act_runner`.
- **Špatné heslo DB po přenosu volume:** `.env` musí odpovídat volume, se kterým
  byla DB inicializovaná (viz hláška install.sh), nebo obnov ze zálohy.
