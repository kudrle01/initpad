# Self-hosted acceptance na Ubuntu VM

Tento scénář ověřuje **self-hosted edici** InitPadu s vestavěnou Giteou,
Gitea Actions runnerem, object storem a simulovanými Docker/SSH/SFTP targety.
Agent běží na odděleném Docker hostu a má vlastní clean-host runbook, na který
tento scénář v závěru odkazuje. Veřejný SaaS se zde neověřuje.

Výsledky testu ukládej (screenshoty, časy a případné chyby). Jsou použitelné
jako důkaz pro testovací kapitolu diplomové práce.

## 1. Připrav Ubuntu ve VirtualBoxu

Doporučená jednorázová VM:

- Ubuntu Server 24.04 LTS, 64 bit;
- 4 vCPU, 8 GB RAM;
- dynamický disk alespoň 80 GB (na Windows hostu ponech alespoň 25 GB volných);
- síť **Bridged Adapter**, aby Windows i VM byly ve stejné LAN;
- při instalaci Ubuntu zapnout OpenSSH Server.

Po přihlášení zjisti adresu VM:

```bash
hostname -I
```

Dále se používá jako `<VM_IP>`. Z Windows ověř `ping <VM_IP>` a připoj se:

```powershell
ssh <ubuntu-user>@<VM_IP>
```

Když bridged síť v dané Wi-Fi nefunguje, použij NAT a ve VirtualBoxu přidej
port forwarding alespoň pro 22, 8080, 3001, 8085 a 8090–8189.

## 2. Nainstaluj závislosti

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2 openssl curl
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Odhlas se a znovu přihlas, potom ověř:

```bash
docker info
docker compose version
df -h /
```

Na Ubuntu 24.04 a novějším připrav cílený AppArmor profil pro rootless
CI daemon. Skript je idempotentní a globální omezení user namespaces
nevypíná:

```bash
cd initpad/deploy
sudo ./prepare-rootless-runner.sh
```

## 3. Nakonfiguruj LAN instalaci

Naklonuj repozitář a připrav konfiguraci:

```bash
git clone https://github.com/kudrle01/initpad.git
cd initpad/deploy
cp .env.example .env
```

V `deploy/.env` změň pouze následující veřejné adresy (nahraď `<VM_IP>`):

```ini
INITPAD_PUBLIC_URL=http://<VM_IP>:8080
INITPAD_GITEA_PUBLIC_URL=http://<VM_IP>:3001
INITPAD_EDITION=self-hosted
INITPAD_REGISTRATION_MODE=open
```

Interní split-horizon hodnoty ponech beze změny:

```ini
INITPAD_GITEA_RUNNER_URL=http://host.docker.internal:3001
INITPAD_REGISTRY_HOST=127.0.0.1:3001
INITPAD_CI_REGISTRY_HOST=host.docker.internal:3001
```

Tyto tři adresy jsou určeny pro runner a Docker démon uvnitř VM, nikoli pro
prohlížeč ve Windows.

Ještě před první instalací spusť kontrolu čistého Linux hostu:

```bash
./self-hosted-check.sh preflight
```

Kontrola odmítne existující InitPad kontejnery nebo volumes, chybějící Docker
Compose a nedostatečnou minimální kapacitu. Doporučených 4 CPU, 8 GB RAM a
40 GB volného místa vyhodnotí jako kapacitní doporučení, nikoli jako skrytou
změnu instalace. Volné místo se měří na filesystému, kde Docker skutečně
ukládá data (`DockerRootDir`), ne podle nominální velikosti virtuálního disku.
Po zvětšení disku ve VMware proto může být ještě nutné uvnitř Linuxu
rozšířit oddíl, LVM volume a filesystém.

Po startu ověř, že izolovaný Docker daemon překládá interní registry alias na
gateway vyhrazené `ci-control` sítě, nikoli na výchozí Docker bridge:

```bash
docker compose --profile runner exec -T runner-docker \
  grep 'host.docker.internal' /etc/hosts
docker compose --profile runner exec -T runner-docker \
  wget -qO- http://host.docker.internal:3001/api/healthz
```

První příkaz musí vypsat `172.31.250.1`; druhý musí vrátit zdravý stav Gitey.
Adresa `172.17.0.1` zde značí chybnou/starou konfiguraci kontejneru — spusť
znovu `./install.sh`, aby se `runner-docker` vytvořil s aktuální sítí.

Pokud je aktivní UFW, povol testovací porty:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp
sudo ufw allow 3001/tcp
sudo ufw allow 8085/tcp
sudo ufw allow 8090:8189/tcp
```

## 4. Nainstaluj a ověř platformu

```bash
./install.sh
docker compose --profile runner ps
curl -fsS http://localhost:8080/api/health/ready
./self-hosted-check.sh running
```

Ve Windows otevři:

- platformu: `http://<VM_IP>:8080`;
- Giteu: `http://<VM_IP>:3001`.

Výsledek je **PASS**, když je API healthy, web se otevře, lze založit první účet
a `act_runner` i `runner-docker` běží. Po založení prvního účtu ulož checkpoint
a potom restartuj celý host:

```bash
./self-hosted-check.sh before-reboot
sudo reboot
```

Po přihlášení nespouštěj `install.sh`; ověř automatickou obnovu:

```bash
cd initpad/deploy
./self-hosted-check.sh after-reboot
```

Kontrola vyžaduje změněný Linux boot ID, zdravé služby, stejné kontejnery,
stejný počet účtů, správnou restart policy a funkční spojení izolovaného runneru
s Giteou. Restart pouhého kontejneru proto nelze vydávat za reboot hosta.

## 5. Ověř účty, workspace a role

1. Založ účty `alice`, `bob` a `carol` (pro druhý a třetí použij privátní okno).
2. Alice vytvoří workspace `Team Alpha` se slugem `team-alpha`.
3. Bob vytvoří workspace `Team Beta` se slugem `team-beta`.
4. Alice přidá existujícího Boba do Team Alpha jako `member` a Carol jako
   `viewer`.
5. Ověř, že Bob vidí oba své workspace, Carol pouze Team Alpha a žádný uživatel
   nevidí projekty ani allocations workspace, jehož není členem.
6. Owner může členům měnit role; member ani viewer správu členů provést nemůže.

## 6. Ověř TargetAllocation a izolaci tenantů

Před ručním scénářem lze na lokálním testovacím stacku spustit automatickou
HTTP matici. Skript vytvoří dva dočasné účty, dva workspaces a minimální
databázové fixtures, zavolá skutečné API a vše v `finally` odstraní. Vyžaduje
explicitní opt-in, aby jej nešlo spustit omylem:

```bash
docker compose exec -T \
  -e INITPAD_ACCEPTANCE_ALLOW_DB_FIXTURES=1 \
  api node scripts/tenant-isolation-acceptance.js
```

Výsledek musí končit `Tenant isolation HTTP acceptance: PASS`. Test ověřuje
cizí ID jako 404, viewer mutace jako 403, owner přístup jako 200 a nakonec
přímo v databázi kontroluje, že zamítnuté požadavky nic nezměnily. Nenahrazuje
ruční kontrolu navigace a skrytých tlačítek popsanou níže.

V každém workspace otevři **Infrastructure → Allocations → Add allocation**:

1. vyber `Company Docker (dev/test)`;
2. ponech všechny capabilities;
3. nastav kvótu `6`;
4. Public URL override nech prázdný.

Alice i Bob potom ve svém workspace vytvoří projekt se stejným názvem
`isolation-demo` ze stejné šablony (například Node API). Počkej, až Gitea
Actions dokončí CI a `dev` poběží.

Na VM ověř fyzickou izolaci:

```bash
docker ps --filter label=com.initpad.managed=true \
  --format 'table {{.Names}}\t{{.Ports}}\t{{.Labels}}'
docker network ls --format '{{.Name}}' | grep -E '^net-(team-alpha|team-beta)-dev$'
```

Musí existovat dva různé kontejnery, allocation labely a sítě
`net-team-alpha-dev` a `net-team-beta-dev`. Obě URL z karet dev se musejí
současně otevřít z Windows.

Otevři detail projektu a ověř, že karta built-in deploymentu ukazuje
aktuální `<VM_IP>` a přidělený port. Když VM po restartu dostane jinou IP,
změň `INITPAD_PUBLIC_URL` v `.env`, spusť `./install.sh` a obnov stránku.
Existující karta musí ukázat novou IP bez nového deploymentu; uživatelské
SFTP/SSH URL se změnit nesmí. Běžící konfiguraci ověř:

```bash
grep '^INITPAD_PUBLIC_URL=' .env
docker compose exec -T api printenv INITPAD_FRONTEND_URL
```

Stejné dev prostředí dvakrát redeployuj. Po každém dokončení smí pro
daný projekt a prostředí existovat právě jeden spravovaný kontejner:

```bash
docker ps -a \
  --filter label=com.initpad.project=alice-isolation-demo \
  --filter label=com.initpad.environment=dev \
  --format '{{.Names}}'
```

Starší lokální image téhož repozitáře, které nepoužívá dev/test/prod
kontejner, se po zdravém redeployi odstraní. Otestované artifacty ve vzdáleném
Gitea registry zůstávají kvůli promotion a auditu. Po **Remove deployment**
nesmí zůstat kontejner daného prostředí ani jeho nepoužívaná lokální image.

Role a policy:

1. Bob jako member Team Alpha smí projekt nasadit, ale nesmí allocation měnit.
2. Carol jako viewer vidí stav, ale tlačítka měnící projekt/target nemá.
3. Alice allocation zakáže. Běžící aplikace musí zůstat dostupná, nový deploy
   musí skončit jasnou chybou o disabled allocation.
4. Allocation znovu povol. Po jednom projektu jsou obsazena tři prostředí.
   Nastav kvótu `3` a zkus založit další projekt na stejném targetu. Požadavek
   musí být odmítnut **před vytvořením Gitea repozitáře**.

## 7. Ověř šablony a konfiguraci aplikace

Vytvoř alespoň jeden projekt pro každou podporovanou PHP variantu:

- Nette;
- Laravel;
- Symfony.

Dále ověř React/Vite a jednu backendovou šablonu. U každé musí projít scaffold,
CI a dev deploy; u PHP ověř také, že veřejný web root neodhaluje soukromé
soubory aplikace.

V detailu jednoho projektu nastav pro dev:

- běžnou proměnnou `INITPAD_ACCEPTANCE=vm`;
- secret `ACCEPTANCE_SECRET=<náhodná-hodnota>`.

Po redeployi ověř injektáž bez vypsání hodnoty secretu:

```bash
container=$(docker ps --filter label=com.initpad.allocation.namespace=team-alpha \
  --format '{{.Names}}' | head -1)
docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -q '^INITPAD_ACCEPTANCE=vm$'
docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -q '^ACCEPTANCE_SECRET='
```

Oba příkazy musí skončit kódem 0; secret neukládej do screenshotu ani logu.

## 8. Ověř frontu a izolaci dvou souběžných projektů

V `deploy/.env` ponech nejprve:

```dotenv
INITPAD_RUNNER_CAPACITY=1
INITPAD_RUNNER_MEMORY_LIMIT=1536m
INITPAD_RUNNER_CPU_LIMIT=1.0
INITPAD_RUNNER_PIDS_LIMIT=512
```

Spusť `./install.sh` a ověř skutečný limit celého vnořeného CI prostoru:

```bash
docker inspect initpad-runner-docker-1 \
  --format 'memory={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}}'
```

Výchozí hodnoty jsou `memory=1610612736`, `nano_cpus=1000000000` a
`pids=512`. Potom rychle po sobě, bez čekání na první CI, založ ve dvou
workspacech projekty `queue-one` a `queue-two`. Očekávaný výsledek:

- oba projekty i oba oddělené repozitáře vzniknou bez konfliktu;
- runner zpracovává první workflow a jeho commit ukazuje `running`;
- druhý commit ukazuje `awaiting CI` a karta dev vysvětluje, že čeká na
  dostupný runner — nesmí se nepravdivě tvářit jako rozběhnutý build;
- po uvolnění runner slotu druhé automaticky přejde na `running` (Gitea může
  joby obou workflow spravedlivě prokládat) a oba dev deploymenty nakonec
  skončí samostatně jako `running`;
- logy, odkazy, SHA, URL, kontejnery a deployment history se mezi projekty
  nikdy nezamění;
- během buildu lze plynule otevřít Projects, detail projektu a Settings;
  skrytá karta se po návratu sama aktualizuje, aniž by na pozadí nepřetržitě
  pollovala celou historii commitů.

Volitelně na stroji s dostatkem prostředků nastav kapacitu `2`, spusť znovu
`./install.sh` a test zopakuj s novými názvy. Oba první joby mohou běžet
současně. Na malé VM je správná a bezpečná hodnota `1`.

## 9. Ověř zálohu a obnovu

Tento krok dělej pouze na této jednorázové VM:

```bash
cd initpad/deploy
./backup.sh ./backups/acceptance
ls -1 ./backups/acceptance | sort
./self-hosted-check.sh backup ./backups/acceptance
```

Výpis musí obsahovat `SHA256SUMS`, `postgres.dump`, `initpad.env` a archivy
Gitey, MinIO, API, SFTP a runneru; nesmí zůstat adresář
`acceptance.partial-*`. Stejný příkaz se stejným cílem se musí bezpečně
odmítnout, nikoli zálohu přepsat. Kontrola obnoví dump pouze do krátkodobé
izolované databáze, uloží fingerprint zálohovaných identit a databázi zase
odstraní. Pokud tento kontrolní příkaz operátor přehlédne, `before-restore` jej
bezpečně provede automaticky přímo nad dumpem; fingerprint nikdy neodvozuje z
pozdějšího živého stavu.

Po záloze vytvoř v UI projekt `after-backup` a ověř, že existuje. Potom spusť:

```bash
./self-hosted-check.sh before-restore ./backups/acceptance after-backup
./restore.sh ./backups/acceptance
```

Na výzvu napiš `restore`. Po obnově ověř:

- účty, workspace, původní projekty a Gitea repozitáře existují;
- `after-backup` neexistuje;
- lokální runtime `after-backup` nezůstal jako osiřelý kontejner:
  `docker ps -a --filter label=com.initpad.managed=true --format '{{.Names}}' | grep after-backup`
  nevrátí nic;
- obnovená aktivní prostředí pravdivě ukazují, že po restore vyžadují deploy;
  existující Gitea OCI image umožní nasadit stejný zachovaný build znovu;
- `docker compose run --rm minio-init` potvrdí dostupný privátní artifact bucket;
- CI runner je online;
- `restore.sh` vypíše `Restore complete` až po health ověření;
- `docker compose --profile runner ps` nehlásí unhealthy službu.

Před destruktivním testem lze bez změny živých dat ověřit restore SQL a
bez aktivních operací provést vratné dependency outage testy:

```bash
./test-restore-reconcile.sh
./recovery-drill.sh artifact-store-outage
./recovery-drill.sh registry-outage
```

Ihned po `restore.sh`, ještě před novým deployem, spusť:

```bash
./self-hosted-check.sh after-restore ./backups/acceptance
```

Příkaz porovná identitu a počty uživatelů, workspaces a projektů s checkpointem
uloženým při kontrole zálohy, prokáže zmizení `after-backup` a automaticky
spustí také `recovery-drill.sh verify-restore`. Musí tedy potvrdit zdravou DB i
artifact store, nulový počet aktivních operací a Agent lease, zneplatněné
gateway/diagnostické projekce a nulový počet lokálních InitPad-managed
workloadů. Starý Agent job se po reconnectu nesmí vykonat. Úspěch přidá
`before-restore` a `after-restore` do lokálního `results.tsv`.

## 10. Ověř podepsanou aktualizaci platformy

První dva čisté updaty `0.2.0 → 0.2.1` a `0.2.1 → 0.2.2` prošly na
disposable VM 21. září 2026 se zachováním identit a prázdné lokální
workload množiny. Krátká odpověď 502 během výměny API/web je u tohoto
single-node profilu očekávaná; Supervisor po celou dobu sleduje readiness a
projektové workloady nerestartuje. Před novým
checkpointem ponech na připojeném Agent serveru alespoň jeden zdravý projektový
workload a poznamenej jeho container ID; po rollbacku, reboot recovery i čistém
update musí zůstat stejný. Zbývající fault-injection drill proto
navazuje na skutečně běžící podepsanou platformu `0.2.2` a cílí na
`initpad-v0.2.4`. Verze 0.2.3 nebyla publikována, protože její emulovaný
ARM64 build selhal před vytvořením release manifestu. Cílový release musí
být veřejný a jeho workflow zelené.
Nový checkout lze stáhnout kvůli acceptance skriptu, ale mezi checkpointem
a testem **nespouštěj `install.sh`**: aktualizaci musí provést běžící
Supervisor z podepsaného release, ne source build nové verze.

Nejprve anonymně ověř distribuční obálku a ulož baseline:

```bash
cd ~/Projects/initpad
git pull --ff-only
npm run audit:public-release -- --tag initpad-v0.2.4
cd deploy
./platform-update-acceptance.sh prepare 0.2.2 0.2.4
```

Checkpoint ukládá pouze verze, fingerprint trvalých identit a identity
managed workloadů; neobsahuje credentials. Do dokončení celého drillu
nevytvářej ani nemaž uživatele, workspaces, projekty nebo deploymenty.
Uloží také UID, GID a režim necitlivého release descriptoru. Updater od
0.2.2 zachovává jeho operátorské vlastnictví a `0600`; acceptance hodnoty
navíc kontroluje a umí je bezpečně obnovit po starším nebo přerušeném
updateru. Candidate API identifikuje podle deklarované platformní verze,
nikoli čtení souboru měněného uprostřed operace. Kontejner během
cutoveru hledá přímo přes neměnné Compose project/service labely; nespouští
`docker compose`, který by dočasný descriptor musel nejdřív přečíst.
Kontrola také odmítne pokračovat, pokud Docker už nemá image záznam
běžícího Supervisoru. U source instalace jej obnov z přesného tagu instalované
verze podle kapitoly **Source checkout a recovery** v `OPERATIONS.md`; samotný
`git pull` běžící kontejner ani jeho image nezmění.

### Vadný candidate a rollback

V terminálu spusť:

```bash
./platform-update-acceptance.sh fault-rollback
```

Teprve když skript čeká, otevři **Instance administration → Platform
updates** a potvrď **Install update**. Skript po startu podepsaného candidate
API pozastaví pouze izolovaný updater, zastaví candidate a updater znovu
uvolní. Tím deterministicky ověří health-gated rollback bez poškození DB
nebo projektových workloadů. Potom spusť:

```bash
./platform-update-acceptance.sh after-rollback
```

### Restart hosta uprostřed cutoveru

Spusť následující příkaz a po jeho výzvě znovu potvrď update v UI:

```bash
./platform-update-acceptance.sh interrupt-reboot
```

Skript ověří `sudo` předem, po startu candidate API pozastaví updater,
zapíše checkpoint a sám restartuje host. Po přihlášení nespouštěj
`install.sh`; ověř automatickou recovery:

```bash
cd ~/Projects/initpad/deploy
./platform-update-acceptance.sh after-reboot
```

### Čistá aktualizace

Naposledy potvrď **Install update** bez fault-injection skriptu. Po stavu
`succeeded` spusť:

```bash
./platform-update-acceptance.sh after-success
```

Finální kontrola vyžaduje platformu `0.2.4`, tři immutable image reference,
stejné identity v DB a přesně stejné managed workload kontejnery jako před
prvním pokusem. `results.tsv` musí obsahovat PASS pro `platform-update-prepare`,
`platform-update-rollback`, `platform-update-reboot-recovery` a
`platform-update-success`.

## 11. Ověř smazání a opětovné použití názvu

V Team Alpha vytvoř samostatný projekt `delete-recreate`, počkej na dokončení
CI a dev deploymentu. Potom jej v dialogu smaž včetně zdrojového repozitáře.
Při výchozím uživateli `alice` ověř přesné project/allocation labely:

```bash
docker ps -a \
  --filter label=com.initpad.project=alice-delete-recreate \
  --filter label=com.initpad.allocation.namespace=team-alpha \
  --format '{{.Names}}'
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  | grep '/alice/delete-recreate:'
```

Oba příkazy nemají nic vypsat (druhý proto může skončit kódem 1). Gitea
repozitář `alice/delete-recreate` musí zmizet. Sdílená síť
`net-team-alpha-dev` naopak zůstává: patří allocation, ne jednomu projektu.
Projekt i kontejner Team Beta se nesmí změnit.

Potom v Team Alpha založ nový projekt se stejným názvem `delete-recreate`.
Musí vzniknout nový repozitář a scaffold, CI i dev deployment musí projít
bez konfliktu se starým workloadem. Výsledný Docker výpis smí pro kombinaci
`alice-delete-recreate` / `team-alpha` / `dev` obsahovat právě jeden kontejner.

## 12. Ověř samostatný Agent host

Na druhém čistém Linux Docker hostu projdi části 1–3 v
[`../apps/agent/ACCEPTANCE.md`](../apps/agent/ACCEPTANCE.md): první instalaci,
reboot a zachování workloadu při zastaveném Agentu. Nesmí jít o control-plane
VM ani o lokální nested-Docker lab.

Po zastavení Agenta musí již nasazená aplikace zůstat dostupná. Nový deploy
zůstane ve frontě a po opětovném připojení se vykoná právě jednou. Identita
targetu, credential generation a workload container ID se rebootem ani
odpojením nesmějí změnit. Výsledek zaznamenej bez enrollment tokenu a bez
obsahu `/var/lib/initpad-agent/agent.json`.

## 13. Výsledek milníku

Fáze TargetAllocation je živě **PASS**, jen pokud současně platí:

- dva workspace běží na jednom fyzickém Docker targetu bez kolize;
- role a cross-workspace viditelnost odpovídají RBAC;
- disabled stav a kvóta jsou skutečně vynucené;
- alespoň Nette, Laravel, Symfony a React projdou přes reálný self-hosted runner;
- restart, backup/restore a delete/recreate neztratí ani nezamění data;
- dva rychle založené projekty se nezamění; při obsazeném runneru UI
  rozliší frontu od běhu a čekající workflow se samo rozběhne;
- built-in karty používají aktuální LAN host a redeploy/remove nehromadí
  kontejnery ani nepoužívané lokální image.
- samostatný Agent host obnoví po rebootu tutéž identitu a odpojení Agenta
  nezastaví existující workload ani nevykoná queued deploy vícekrát;
- `self-hosted-check.sh` má PASS záznamy pro `preflight`, `running`,
  `before-reboot`, `after-reboot` a `backup`.

Po testu můžeš bezpečně uvolnit build cache:

```bash
./cleanup.sh
```

Named volumes ani běžící deploymenty tento skript nemaže. Celou jednorázovou VM
odstraň až po uložení výsledků a screenshotů.
