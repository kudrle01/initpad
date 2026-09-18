# InitPad — provozní runbook (self-hosted)

Provozní příručka pro self-hosted nasazení na jednom hostu (ADR-062). Cílem je,
aby InitPad byl bezpečně provozovatelný ve škole nebo malé firmě: data se
neztratí, běží spolehlivě a jde snadno spravovat. Všechny příkazy spouštěj z
adresáře `deploy/`.

Kompletní instalační a uživatelský test na Ubuntu VM je v
[`SELF_HOSTED_ACCEPTANCE.md`](./SELF_HOSTED_ACCEPTANCE.md). Je to závazný živý
gate, který proběhl před implementací Agenta; samotné unit testy tenant izolaci
na skutečném Docker hostu neprokazují. Izolovaný Agent enrollment/heartbeat
test je samostatně v [`../apps/agent/README.md`](../apps/agent/README.md).

## Start / stop / stav

```bash
./install.sh                 # první instalace i idempotentní oprava/upgrade
./install.sh --update-agent-release
                             # výslovně nabídnout aktuální schválený Agent
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
MinIO artefakty, workspace a Supervisor state) včetně aktivního release
descriptoru do `./backups/<časové-razítko>/`:

```bash
./backup.sh
```

Skript vytvoří společný konzistentní checkpoint: na dobu snapshotu krátce
zastaví platformní zapisovatele a potom obnoví přesně ty služby, které před
zálohou běžely. Počítej proto s krátkým servisním oknem; při chybě se skript
pokusí původní stav služeb obnovit také. Záloha se publikuje až po úspěšném
dokončení a nikdy nepřepisuje existující adresář; pro nový pokus proto zvol
nový název.

Pokud právě běží CI build, skript jej nepřeruší a skončí s jasnou chybou;
zálohu zopakuj po dokončení workflow.

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
znovu nastartuje včetně CI runneru a nakonfigurovaného HTTPS profilu. Po načtení
dumpu nejprve aplikuje verzované migrace aktuální instalace, takže podporuje i
kontrolovanou obnovu staršího checkpointu. Za
dokončený restore jej označí až po ověření zdraví Gitey, API, vnitřního
Docker daemonu a běhu runneru. Součástí obnovy je zálohovaný `.env`, protože
obsahuje šifrovací klíč a identity služeb;
předchozí konfigurace zůstane jako chráněný
`.env.before-restore-<časové-razítko>`. **Pravidelně obnovu testuj na
jednorázovém hostu/VM** — nevyzkoušená záloha není záloha. Po obnově spusť
`./install.sh`, pokud je potřeba dorovnat registraci CI runneru.

Datový backup není snapshot fyzických targetů. Restore proto odstraní pouze
lokální kontejnery označené `com.initpad.managed=true` a obnovená nasazení
označí `deploy required`; cizí host kontejnery ani vzdálené workloady nemaže.
Po obnově zkontroluj target a z UI znovu nasaď zachovaný testovaný artifact.
Rozpracované Agent joby se zruší a přijdou o lease, aby příkaz ze staré
časové osy po reconnectu nezměnil target. Stejně se zneplatní observed stav
gateway a poslední diagnostika; stabilní rezervace hostname zůstane zachována.

## Recovery drill

Drill spouštěj jen na jednorázové acceptance VM a bez aktivního buildu nebo
deploymentu. Výpadkové režimy aktivní práci nejprve samy zkontrolují:

```bash
./recovery-drill.sh artifact-store-outage
./recovery-drill.sh registry-outage
```

První test musí během odstávky MinIO vidět API jako `503 not-ready` s
`artifactStore: unavailable` a po navrácení opět `200`. Druhý bezpečně zastaví
a obnoví vestavěnou Giteu/OCI registry a čeká na její health check.

Po kontrolovaném `backup.sh` + `restore.sh` spusť okamžitě, ještě před novým
deploymentem:

```bash
./recovery-drill.sh verify-restore
```

Kontrola je read-only: ověří readiness, privátní bucket, absenci starých
lease/aktivních operací, zneplatnění runtime projekcí a absenci lokálních
InitPad-managed workloadů. Samotný SQL kontrakt lze kdykoli bezpečně ověřit
nad dočasnými tabulkami:

```bash
./test-restore-reconcile.sh
```

## Úklid disku

Bezpečné uvolnění místa (jen dangling images + build cache; datové volumes ani
běžící deploye se nedotýká):

```bash
./cleanup.sh
```

Volitelně přes cron (např. týdně). Ověřené buildy v object storage uklízí sama
platforma (retention, ADR-059).

## Object storage: produkční hranice

Compose profil obsahuje připnutý MinIO image, aby šlo lokální a školní
single-node scénář spustit bez další služby. Upstream ale ukončil distribuci
aktuálních komunitních binárních image a poslední dostupný image předchází
pozdější bezpečnostní opravě ve zdrojovém kódu. Vestavěné MinIO proto používej
jen v důvěryhodné síti, nevystavuj jeho porty veřejně a nepovažuj jej za
produkční bezpečnostní hranici.

Pro veřejný nebo firemní produkční provoz nastav `INITPAD_ARTIFACT_S3_ENDPOINT`,
region, bucket a samostatné omezené credentials na aktivně udržované externí
S3-compatible úložiště. Bucket musí zůstat privátní; InitPad vydává pouze
krátkodobé podepsané přístupy. Přechod nejdřív nacvič nad kopií dat a před
každou změnou image nebo storage backendu spusť `./backup.sh`. Volba dlouhodobé
vestavěné náhrady nebo vlastního auditem ověřeného source buildu zůstává
samostatným release rozhodnutím.

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

### Běžná podepsaná aktualizace

Platform administrator otevře **Instance administration → Platform updates**,
zkontroluje odkaz na release a potvrdí **Install update**. API pouze vybere
nejnovější ověřený stabilní release a zaznamená aktéra. Oddělený Supervisor:

1. znovu ověří Sigstore identitu přesného tagového workflow a odmítne
   downgrade, cizí repozitář i neznámá pole;
2. vytvoří PostgreSQL dump, ověří jeho čitelnost a stáhne tři immutable
   digest-pinned images;
3. postupně přepne API, web a nakonec samotný Supervisor; každý krok čeká
   na health check;
4. teprve potom uloží novou verzi. Chyba vrátí původní images a UI ji
   zachová v historii.

Běžící projektové workloady se nerestartují. V jednu chvíli smí běžet
jen jedna platformní aktualizace. Aktivní release descriptor leží v
`.runtime/platform-update/platform-release.override.yml`, je součástí backupu
a Compose jej načítá i po rebootu. Tento soubor neupravuj ručně.

### Source checkout a recovery

Bez aktivního release override zůstává vývojový/self-contained postup:

```bash
git pull
./install.sh
```

Je-li podepsaný release aktivní, `./install.sh` jej zachová a source images
nepřestavuje. Když UI nebo API neběží, stáhni všechny soubory jednoho
`initpad-v*` GitHub Release do prázdného adresáře a odtud spusť:

```bash
./initpad-install-release.sh --project-root /absolutni/cesta/k/initpad
```

Fallback vyžaduje Docker, Compose a Cosign, ověří podpis `SHA256SUMS` i
všechny assets, vytvoří kompletní `backup.sh` checkpoint a použije stejný
health-gated rollback. Automaticky se nevrací destruktivně změněná databáze;
release kanál proto přijímá pouze expand/contract, image-compatible migrace.
Pro plný návrat použij explicitní `./restore.sh <záloha>`.

## Bezpečnost

- `deploy/.env` obsahuje všechny secrety — omez práva (`chmod 600 .env`), necommituj.
- Veřejně vystav jen porty **80/443** (zbytek za proxy); zbytek drž ve firewallu.
- Registraci drž na `admin-provisioned`, pokud nemá být veřejná.
- Zálohy šifruj a ukládej offsite.
- `INITPAD_TRUST_PROXY_HOPS=1` odpovídá vestavěnému web proxy. Přímý
  přístup klientů k API vyžaduje `0`; další edge proxy zvyšuje hodnotu pouze
  tehdy, když je síťová cesta pevná a API nelze obejít napřímo. Klientská IP je
  součástí rate-limit rozhodnutí.
- InitPad Agent má přes Docker socket oprávnění srovnatelné se správcem
  cílového serveru. Enrollment proto smí spouštět jen správce workspace a
  produkční control plane musí používat HTTPS. `--allow-insecure-http` je
  pouze pro izolovaný lokální test, nikoli pro běžnou LAN nebo internet.
- Release Supervisor má ze stejného důvodu root-equivalent oprávnění na
  self-hosted hostu. Nemá veřejný port, přijímá jen HMAC requesty z interní
  management sítě a request nikdy neurčuje shell, image ani Compose obsah.
  Jeho sdílený secret ani Docker socket nezpřístupňuj mimo host.

Citlivé auth, GitHub setup a Agent enrollment operace používají krátkodobé
PostgreSQL buckety společné pro všechny API repliky. Tabulka neobsahuje IP,
e-mail, login ani token; identita je součástí HMAC klíče. Rate limiter chrání
jednotlivé účty a běžné automatizované pokusy, nenahrazuje firewall, connection
limit ani DDoS ochranu na veřejném edge.

Publikovaný Agent se zapíná vždy dvojicí z ověřeného
`initpad-agent-release.json`: `INITPAD_AGENT_IMAGE` dostane
`image.immutableReference` a `INITPAD_AGENT_RELEASE_VERSION` kořenové pole
`version`. Samotný digest neobsahuje zobrazitelnou verzi; neúplnou dvojici API
odmítne při startu, aby UI nemohlo vydávat starší image za novější Agent.
Release schválený pro běžné self-hosted instalace je jediným zdrojem pravdy v
`agent-release.env`. `install.sh` jej doplní jen tehdy, když jsou obě hodnoty
v `.env` prázdné; kompletní explicitní pin zachová. Správce přijme novější
schválenou dvojici příkazem `./install.sh --update-agent-release`; přepis obou
hodnot proběhne atomicky a běžný instalátor vlastní pin nikdy tiše neposune.
Tím jde nová instalace Agenta spustit přímo příkazem z UI, zatímco rollback
nebo postupný rollout zůstává pod kontrolou správce.

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
  po dokončení jeho job/delivery protokolu (roadmapa), případně managed DB/S3.

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
