# InitPad — provozní runbook (self-hosted)

Provozní příručka pro self-hosted nasazení na jednom hostu (ADR-062). Cílem je,
aby InitPad byl bezpečně provozovatelný ve škole nebo malé firmě: data se
neztratí, běží spolehlivě a jde snadno spravovat. Všechny příkazy spouštěj z
adresáře `deploy/`.

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

- Orientačně: každý projekt = 3 prostředí; N týmů × 3 běžící kontejnery + CI
  buildy. Hlídej RAM, CPU a **volné místo** (buildy a image rostou).
- Kvóty na tým nastav přes **Allocations** (max prostředí, ADR-060).
- Když jeden host nestačí, přesuň nasazovací cíle na další stroje přes **Agenta**
  (roadmapa), případně managed DB/S3.

## Troubleshooting

- **Něco není `healthy`:** `docker compose logs <služba>`.
- **Plný disk:** `docker system df` → `./cleanup.sh`; zkontroluj `./backups`.
- **CI se nestaví/nenasazuje:** běží profil runneru? `docker compose ps act_runner runner-docker`.
- **Špatné heslo DB po přenosu volume:** `.env` musí odpovídat volume, se kterým
  byla DB inicializovaná (viz hláška install.sh), nebo obnov ze zálohy.
