# InitPad — provozní runbook (self-hosted)

Provozní příručka pro self-hosted nasazení na jednom hostu (ADR-062). Cílem je,
aby InitPad byl bezpečně provozovatelný ve škole nebo malé firmě: data se
neztratí, běží spolehlivě a jde snadno spravovat. Všechny příkazy spouštěj z
adresáře `deploy/`.

Kompletní instalační a uživatelský test na Ubuntu VM je v
[`SELF_HOSTED_ACCEPTANCE.md`](./SELF_HOSTED_ACCEPTANCE.md). Je to závazný živý
gate; samotné unit testy tenant izolaci ani obnovu po rebootu na skutečném
Docker hostu neprokazují. Nedestruktivní checkpointy automatizuje
`./self-hosted-check.sh`. Clean-host Agent enrollment, reboot a zachování
workloadu při odpojení jsou samostatně v
[`../apps/agent/ACCEPTANCE.md`](../apps/agent/ACCEPTANCE.md).

## Start / stop / stav

```bash
./install.sh                 # první instalace i idempotentní oprava/upgrade
./install.sh --update-agent-release
                             # výslovně nabídnout aktuální schválený Agent
docker compose ps            # stav služeb
docker compose logs -f api   # živé logy platformy
docker compose stop          # zastavit vše (data zůstávají)
docker compose up -d         # znovu nastartovat
./self-hosted-check.sh running
                             # nedestruktivní health/restart/CI kontrola
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

Záloha **obsahuje `.env` se secrety a všechna data**. Šifruj ji veřejným
klíčem `age` (ADR-151). Klíčový pár vytvoř mimo server a na server dej jen
veřejnou část:

```bash
age-keygen -o initpad-backup.key            # na tvém počítači; soubor drž v trezoru
age-keygen -y initpad-backup.key > recipients.txt
scp recipients.txt server:/etc/initpad/backup-recipients.txt
```

Na serveru nainstaluj `age` (`apt install age`) a předej soubor záloze:

```cron
0 2 * * *  cd /cesta/k/initpad/deploy && INITPAD_BACKUP_AGE_RECIPIENTS_FILE=/etc/initpad/backup-recipients.txt INITPAD_BACKUP_KEEP=7 ./backup.sh >> ./backups/backup.log 2>&1
```

Záloha pak zůstane jen jako `./backups/<časové-razítko>.tar.age`. Server ji
zapíše, ale bez soukromého klíče ji nepřečte; ani útočník na serveru proto
zálohu nerozšifruje. Kopíruj ji **mimo server** (např. `rclone copy` nebo
`rsync`). Rotace nechává posledních `INITPAD_BACKUP_KEEP` záloh (výchozí 7),
šifrovaných i nešifrovaných. Když `age` chybí nebo soubor s klíči neexistuje,
skript skončí ještě před zastavením služeb.

## Obnova

Šifrovanou zálohu obnov s cestou k soukromému klíči; skript ji rozbalí do
dočasného adresáře, který po skončení smaže:

```bash
INITPAD_BACKUP_AGE_IDENTITY_FILE=/cesta/k/initpad-backup.key ./restore.sh ./backups/20261009T020000Z.tar.age
```

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

Release acceptance navíc ukládá identitu živých dat v okamžiku zálohy a
prokazuje návrat v čase pomocí marker projektu. Fingerprint se čte z dumpu v
krátkodobé izolované databázi, nikoli z pozdějšího živého stavu. Kompletní
sekvence je v
[`SELF_HOSTED_ACCEPTANCE.md`](./SELF_HOSTED_ACCEPTANCE.md); závěrečný
`self-hosted-check.sh after-restore` zahrnuje i výše uvedený invariantní test.

Kontrola je read-only: ověří readiness, privátní bucket, absenci starých
lease/aktivních operací, zneplatnění runtime projekcí a absenci lokálních
InitPad-managed workloadů. Samotný SQL kontrakt lze kdykoli bezpečně ověřit
nad dočasnými tabulkami:

```bash
./test-restore-reconcile.sh
```

## Retence dat

API jednou za hodinu maže použité a prošlé jednorázové tokeny (po 7 dnech),
odeslané e-maily z fronty (po 30 dnech), dokončené Agent joby (po 90 dnech) a
události auditu starší než `INITPAD_AUDIT_RETENTION_DAYS` (výchozí 400 dní,
`0` audit ponechá). Historie nasazení zůstává, dokud existuje projekt
(ADR-150).

## Úklid disku

Bezpečné uvolnění místa (jen dangling images + build cache; datové volumes ani
běžící deploye se nedotýká):

```bash
./cleanup.sh
```

Volitelně přes cron (např. týdně). Ověřené buildy v object storage uklízí sama
platforma (retention, ADR-059). Skript před prune znovu připne image aktivních
source služeb jejich nakonfigurovaným tagem. Pokud lokální image záznam už
chybí, skončí bez dalšího mazání a vyžádá obnovu přesné instalované verze.

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

## E-mailové doručování

Self-hosted instalace funguje i bez SMTP: aktivaci a ověření zobrazí jako
jednorázový odkaz oprávněnému uživateli. Token je za znakem `#`, a proto se
odkaz musí předat celý; bez této části stránka požádá o otevření celého odkazu
znovu (ADR-143). Pro reset zapomenutého hesla a veřejný provoz nastav v `.env`
relay s TLS:

```dotenv
INITPAD_SMTP_HOST=smtp.example.org
INITPAD_SMTP_PORT=587
INITPAD_SMTP_SECURE=false
INITPAD_SMTP_REQUIRE_TLS=true
INITPAD_SMTP_USERNAME=initpad
INITPAD_SMTP_PASSWORD=replace-with-secret
INITPAD_SMTP_FROM=InitPad <no-reply@example.org>
```

Port 587 používá STARTTLS (`SECURE=false`, `REQUIRE_TLS=true`). Pro implicitní
TLS na portu 465 nastav `SECURE=true`. Po změně spusť `./install.sh`; nové
zprávy se zařadí do databázového outboxu. Do logu se zapisuje pouze ID,
druh a výsledek zprávy, ne adresa ani autentizační odkaz. Sleduj události
`mail.outbox.retry_scheduled` a `mail.outbox.failed`.

SaaS profil vyžaduje stejné veřejné parametry a heslo přes
`INITPAD_SMTP_PASSWORD_FILE`. DNS politika odesílací domény (SPF, DKIM a
DMARC) se nastavuje u zvoleného providera, nikoli v InitPadu.

Na SaaS stagingu ověř přihlášení i skutečné předání zprávy relay serveru:

```bash
INITPAD_SMTP_ACCEPTANCE_RECIPIENT=staging-inbox@example.org \
  ./saas-acceptance.sh email .env.saas
```

Příkaz nevypisuje adresu ani credentials. Úspěšné předání ještě potvrď
v cílové schránce; tím se zachytí také reputace domény a spam filtering.
Výpadek relay serveru a následné bezpečné doručení retry se ověřuje dvoufázově
přes `smtp-outage-before` a `smtp-outage-after`. Přesný postup včetně
firewallového precondition je v [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md).

Stejný staging helper obsahuje omezený read-heavy load test veřejného HTTPS
edge. Vyžaduje nejméně dvě zdravé API repliky; baseline běží bez aktivních
projektových operací. Příkaz `load-failover` navíc při stejné zátěži restartuje
jednu API repliku a znovu ověří readiness. Dvoufázový
`agent-failover-before/after` nad disposable GitHub projektem navíc prokáže,
že právě jeden durable Agent deploy přežije restart repliky, která ho přijala,
a po reconnectu skončí bez zámku nebo lease. Přesné preconditions a cleanup
jsou v [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md). Background lifecycle i známé
process-bound projektové operace už mají databázový fencing, ale živý GitHub
artifact-ingestion failover a ostatní mutation/recovery acceptance musí na
cílové topologii projít před schválením active-active mutačního provozu.

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

Před přijetím nového release kanálu se na disposable hostu provádí živý
success, rollback i restart uprostřed cutoveru. Reprodukovatelný postup a
bezpečný fault-injection helper jsou v
[`SELF_HOSTED_ACCEPTANCE.md`](SELF_HOSTED_ACCEPTANCE.md#10-ověř-podepsanou-aktualizaci-platformy).
Helper nikdy nestahuje neověřený release ani nemění databázi; pouze na
disposable hostu zastaví již ověřený candidate kontejner nebo pozastaví
izolovaný updater těsně před restartem hosta.

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

Když source instalace hlásí, že image ID běžícího Supervisoru už
neexistuje, nevytvářej image pomocí `docker commit`: kontejner obsahuje citlivé
runtime prostředí. Na disposable hostu obnov přesný source image z tagu
odpovídajícího instalované verzi a vytvoř znovu jen Supervisor:

```bash
cd ~/Projects/initpad
git status --short                 # musí být prázdný
git fetch --tags
git switch --detach initpad-v0.2.0 # dosaď skutečně instalovanou verzi
docker build -f apps/supervisor/Dockerfile -t initpad-supervisor:source .
cd deploy
docker compose --profile runner --profile server up -d \
  --no-deps --no-build --force-recreate supervisor
cd ..
git switch main
```

Tento zásah nemění databázi, API, web ani projektové workloady. Před dalším
drillem ověř `docker image inspect "$(docker inspect initpad-supervisor
--format '{{.Image}}')"`.

Release Supervisor do verze `0.2.1` mohl release descriptor vytvořit jako
`root:root`, ačkoli neobsahuje credentials. Poznáš to podle `Permission denied`
z Docker Compose nebo acceptance skriptu. Vlastnictví jednorázově vrať
operátorovi instalace a zachovej režim `0600`:

```bash
cd ~/Projects/initpad/deploy
sudo chown "$(id -u):$(id -g)" \
  .runtime/platform-update/platform-release.override.yml
chmod 600 .runtime/platform-update/platform-release.override.yml
```

Novější Supervisor při atomickém zápisu automaticky přebírá vlastníka
hostitelského runtime adresáře. Compose, acceptance, health check i backup pak
descriptor čtou přímo pod stejným hostitelským operátorem; nepoužívají `sudo`
a nemění jeho obsah.

## Bezpečnost

- **Převzatý účet** (ADR-148). Gitea neumí ukončit webovou session jednoho
  uživatele, proto postupuj takto:
  1. v **Administraci** účet deaktivuj. InitPad i Gitea ho okamžitě zablokují a
     všechny Gitea tokeny účtu přestanou platit;
  2. restartuj Gitea (`docker compose restart gitea`). Ukončí všechny Gitea
     sessions, ostatní uživatelé se přihlásí znovu přes InitPad. Git operace a
     CI klonování se na chvíli přeruší;
  3. vytvoř účtu aktivační odkaz nebo reset hesla a účet znovu aktivuj.

  Uživatel sám ukončí cizí přihlášení v **Nastavení účtu → Přihlášené
  prohlížeče** (ADR-147). Reset hesla odvolá všechny jeho Gitea tokeny,
  otevřenou Gitea session ale ukončí až restart Gitey.
- `deploy/.env` obsahuje všechny secrety — omez práva (`chmod 600 .env`), necommituj.
- `INITPAD_ENCRYPTION_KEY` šifruje credentials uložené v databázi (ADR-141).
  Bez něj nebo se stejnou hodnotou jako `INITPAD_JWT_SECRET` API v produkci
  nenastartuje. Výměna klíče:
  1. v `deploy/.env` přesuň současnou hodnotu do
     `INITPAD_ENCRYPTION_KEY_PREVIOUS` a do `INITPAD_ENCRYPTION_KEY` dej nový
     klíč (`openssl rand -hex 24`), pak spusť `./install.sh`;
  2. API po startu přešifruje všechny uložené hodnoty a zapíše do logu
     `Every stored secret uses the current INITPAD_ENCRYPTION_KEY`;
  3. potom `INITPAD_ENCRYPTION_KEY_PREVIOUS` smaž a znovu spusť `./install.sh`.

  Hodnotu, kterou žádný klíč neotevře, API zaloguje jako `secret.unreadable`.
  Takový credential (heslo serveru, secret proměnná aplikace) je potřeba zadat
  znovu; Git token a propojení GitHubu se obnoví samy. V SaaS připoj
  předchozí klíč po dobu výměny jako další Compose secret a předej ho API
  přes `INITPAD_ENCRYPTION_KEY_PREVIOUS_FILE`.
- Veřejně vystav jen porty **80/443**. Porty 8080 (web), 3001 (Gitea) a 8085
  (vestavěný statický hosting) zůstávají publikované, protože je používá síť
  CI a lokální kontroly. Docker publikované porty obchází a pravidla `ufw` na
  ně nepůsobí. Na veřejném rozhraní je proto zablokuj v řetězci `DOCKER-USER`,
  například pro rozhraní `eth0`:

  ```bash
  for port in 8080 3001 8085; do
    sudo iptables -I DOCKER-USER -i eth0 -p tcp -m conntrack \
      --ctorigdstport "$port" --ctdir ORIGINAL -j DROP
  done
  ```

  Provoz z hostu i ze sítě CI tím zůstane zachovaný. Pravidla si ulož
  nástrojem své distribuce (například `iptables-persistent`). Port 8085
  neblokuj, pokud mají uživatelé otevírat aplikace na vestavěném statickém
  hostingu.
- Při provozu přes HTTP posílá prohlížeč session InitPadu i vestavěným Docker
  aplikacím na stejném hostu. Pokud budou nasazovat další lidé, provozuj
  InitPad přes HTTPS (serverový profil, případně `tls internal`) nebo nastav
  `INITPAD_DEPLOY_PUBLIC_HOST` na jiný název hostu. Administrace na tento stav
  upozorní. Pod HTTPS se session cookie jmenuje `__Host-initpad_token` a po
  aktualizaci na tuto verzi se uživatelé jednou znovu přihlásí.
- Administrace → Bezpečnostní záznam ukazuje přihlášení, neúspěšné pokusy,
  změny a obnovy hesel, akce administrátorů a smazání workspace (ADR-142).
  Řada neúspěšných pokusů o jeden účet znamená hádání hesla; účet pak
  deaktivuj nebo mu obnov heslo.
- Výchozí registrace je `admin-provisioned`. Režim `open` dovolí každému, kdo
  instanci vidí, založit účet a nasazovat kontejnery na vestavěný Docker host;
  zapínej ho jen v důvěryhodné síti. První účet (administrátor) vyžaduje
  `INITPAD_BOOTSTRAP_TOKEN`, který instalátor vygeneruje a vypíše, dokud
  instance nemá žádný účet.
- Zálohy šifruj a ukládej offsite.
- `INITPAD_TRUST_PROXY_HOPS=1` platí pro lokální instalaci i pro serverovou
  instalaci s vestavěným Caddy. Caddy posílá `/api/*` přímo na API a hlavičku
  `X-Forwarded-For` od klienta nahrazuje, takže API vidí po každé cestě právě
  jeden proxy hop. Přímý přístup klientů k API vyžaduje `0`. Další edge proxy
  zvyšuje hodnotu pouze tehdy, když je síťová cesta pevná a API nelze obejít
  napřímo. Klientská IP je součástí rate-limit rozhodnutí.
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

Škola nebo firma za NAT posílá požadavky všech uživatelů z jedné veřejné
adresy. Uveď ji v `.env`, jinak třída rychle vyčerpá limit přihlášení a
registrace na IP (ADR-149):

```dotenv
INITPAD_RATE_LIMIT_SHARED_NETWORKS=198.51.100.0/24
INITPAD_RATE_LIMIT_SHARED_NETWORK_FACTOR=20
```

Pro tyto adresy se limit na IP násobí, limit na účet zůstává. Uváděj jen sítě,
za kterými skutečně stojí tvoji uživatelé.

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

Tato dvojice je bootstrap pro nové servery, ne ruční konfigurace každé další
aktualizace. Běžící Agent zjišťuje novější podepsaný release z katalogu a
instalaci stále potvrzuje owner/admin pro konkrétní target. Výchozí
`INITPAD_AGENT_UPDATE_CHANNEL=stable` ignoruje GitHub prerelease. Hodnota
`candidate` patří jen na disposable acceptance control plane; UI ji viditelně
označí a po skončení testu se musí vrátit na `stable`.

Stejný gate platí pro platformu. Tag `initpad-vX.Y.Z` vytvoří GitHub
prerelease a acceptance VM jej uvidí pouze s
`INITPAD_PLATFORM_UPDATE_CHANNEL=candidate`. Nejprve se ověří distribuce:

Novou verzi připravte na čistém a publikovaném `main` jediným příkazem:

```bash
git pull --ff-only
npm run release:platform:prepare -- X.Y.Z
```

Příkaz nejprve ověří všechna očekávaná pole, potom změní pouze platformní
verze, ponechá verze ostatních komponent beze změny a spustí celý
`check:release`. Po kontrole diffu
commitněte a pushněte `main`. Jakmile je jeho workflow zelené, vytvořte
ověřený lokální tag a explicitně jej publikujte:

```bash
npm run release:platform:tag -- X.Y.Z
git push origin initpad-vX.Y.Z
```

Tagovací příkaz odmítne nečistý strom, jinou větev i commit, který není
na `origin/main`. Push, živá acceptance a povýšení na stable zůstávají
záměrně oddělené schvalovací brány.

Potom anonymně ověřte candidate distribuci:

```bash
npm run audit:public-release -- --tag initpad-vX.Y.Z --allow-prerelease
```

Přechod `0.2.9 → 0.2.10` je jednorázová výjimka: starší API ještě candidate
katalog neumí, proto se candidate nainstaluje jeho podepsaným recovery
instalátorem a výsledek se uzavře příkazem
`platform-update-acceptance.sh after-bootstrap`. Přesný postup je v
`SELF_HOSTED_ACCEPTANCE.md`. Od `0.2.10` se candidate instaluje běžně z
administrace a kontroluje pomocí `after-success`.

Po úspěšné acceptance se povýší ten samý podepsaný release; tag ani image
digest se nemění:

```bash
gh release edit initpad-vX.Y.Z --prerelease=false --latest
npm run audit:public-release -- --tag initpad-vX.Y.Z
```

Produkční instalace s výchozím `stable` kanálem jej uvidí až po tomto kroku.

## Kapacita a škálování

- Pro pohodlný self-hosted provoz včetně sestavování šablon počítej
  alespoň se 2 vCPU, 4 GB RAM a 20 GB volného disku. Samotné zobrazení
  aplikace spotřebuje méně; CI build je záměrně nejnáročnější část.
- Orientačně: každý projekt = 3 prostředí; N týmů × 3 běžící kontejnery + CI
  buildy. Hlídej RAM, CPU a **volné místo** (buildy a image rostou).
- Runner provádí jeden CI job najednou a ostatní commity pravdivě zobrazí jako
  `awaiting CI`. Každý job běží na čerstvě vymazaném Docker daemonu
  (ADR-138): `runner-docker` se po jobu restartuje a při startu smaže
  kontejnery, volumes, image i build cache. `INITPAD_RUNNER_CAPACITY` proto
  musí být `1`; instalace s vyšší hodnotou ji musí v `deploy/.env` vrátit na
  `1` a znovu spustit `./install.sh`.
- Každý job si znovu načte job image. Image z Docker Hubu dodává lokální cache
  `runner-image-cache` (volume `initpad_runner-image-cache`, obsah vyprší po 7
  dnech), takže se opakovaně nestahují z internetu. Do cache nikdo nemůže
  zapisovat. Počítej s ní v místě na disku (job image má asi 0,5 GB).
- Šablonové CI testuje, staví a publikuje image v jediném jobu a vrstvy buildu
  bere z cache v registry projektu (tagy `buildcache` a `buildcache-test`
  vedle image, ADR-139). Projekty založené před ADR-139 mají čtyři joby, které
  dál fungují, ale každý načítá job image a staví znovu. Zrychlí je nové
  workflow: na obrazovce importu stáhni starter workflow pro šablonu projektu a
  nahraď jím `.gitea/workflows/ci.yml` v repozitáři.
- `INITPAD_RUNNER_MEMORY_LIMIT`, `INITPAD_RUNNER_CPU_LIMIT` a
  `INITPAD_RUNNER_PIDS_LIMIT` omezují CI daemon i všechny kontejnery jobu
  (výchozí hodnoty `1536m`, `1.0`, `512`). Vyšší CPU limit zkrátí i načtení job
  image na začátku každého jobu. Na silnějším hostu je lze zvýšit, ale ponech
  dostatečnou rezervu pro databázi, Gitea, API a běžící aplikace. Změnu uplatní
  opětovné `./install.sh`; nevyžaduje nový projekt.
- Kvóty na tým nastav přes **Allocations** (max prostředí, ADR-060).
- Když jeden host nestačí, přesuň nasazovací cíle na další stroje přes **Agenta**
  po dokončení jeho job/delivery protokolu (roadmapa), případně managed DB/S3.

## Troubleshooting

- **Něco není `healthy`:** `docker compose logs <služba>`.
- **Plný disk:** `docker system df` → `./cleanup.sh`; zkontroluj `./backups`.
- **CI se nestaví/nenasazuje:** běží profil runneru? `docker compose ps act_runner runner-docker runner-image-cache`.
  Log `runner-docker` po každém jobu ukáže `reset requested; restarting with an
  erased daemon`. Hláška `previous CI daemon state could not be erased` znamená,
  že daemon odmítl start s daty předchozího jobu; zkontroluj místo na disku a
  `docker compose logs runner-docker`.
- **Druhý projekt čeká:** při kapacitě 1 je to backpressure, ne konflikt.
  První commit má `running`, druhý `awaiting CI`; jakmile aktivní job uvolní
  slot, runner si sám převezme další. Pokud oba zůstanou čekat, zkontroluj
  log `act_runner`.
- **Špatné heslo DB po přenosu volume:** `.env` musí odpovídat volume, se kterým
  byla DB inicializovaná (viz hláška install.sh), nebo obnov ze zálohy.
