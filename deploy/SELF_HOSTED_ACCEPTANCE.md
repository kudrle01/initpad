# Self-hosted acceptance na Ubuntu VM

Tento scénář ověřuje **self-hosted edici** InitPadu s vestavěnou Giteou,
Gitea Actions runnerem, MinIO a simulovanými Docker/SSH/SFTP targety. Neověřuje
veřejný SaaS ani InitPad Agenta; ty jsou samostatné pozdější milníky.

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

## 3. Nakonfiguruj LAN instalaci

Naklonuj repozitář a připrav konfiguraci:

```bash
git clone <URL_REPOZITARE>
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
```

Ve Windows otevři:

- platformu: `http://<VM_IP>:8080`;
- Giteu: `http://<VM_IP>:3001`.

Výsledek je **PASS**, když je API healthy, web se otevře, lze založit první účet
a `act_runner` i `runner-docker` běží. Potom VM restartuj:

```bash
sudo reboot
```

Po restartu musí platforma i data naběhnout bez nového `install.sh`.

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

## 8. Ověř zálohu a obnovu

Tento krok dělej pouze na této jednorázové VM:

```bash
cd initpad/deploy
./backup.sh ./backups/acceptance
```

Po záloze vytvoř v UI projekt `after-backup` a ověř, že existuje. Potom spusť:

```bash
./restore.sh ./backups/acceptance
```

Na výzvu napiš `restore`. Po obnově ověř:

- účty, workspace, původní projekty a Gitea repozitáře existují;
- `after-backup` neexistuje;
- existující Gitea OCI image umožní redeploy stejného buildu;
- `docker compose run --rm minio-init` potvrdí dostupný privátní artifact bucket;
- CI runner je online;
- `docker compose --profile runner ps` nehlásí unhealthy službu.

## 9. Ověř smazání a opětovné použití názvu

Smaž testovací projekt včetně jeho deploymentů a repozitáře. Ověř, že:

```bash
docker ps -a --format '{{.Names}}' | grep isolation-demo
```

nevrátí jeho kontejner a Gitea repozitář zmizel. Potom založ projekt se stejným
názvem. Scaffold, CI i deploy musí projít bez konfliktu se starým workloadem.

## 10. Výsledek milníku

Fáze TargetAllocation je živě **PASS**, jen pokud současně platí:

- dva workspace běží na jednom fyzickém Docker targetu bez kolize;
- role a cross-workspace viditelnost odpovídají RBAC;
- disabled stav a kvóta jsou skutečně vynucené;
- alespoň Nette, Laravel, Symfony a React projdou přes reálný self-hosted runner;
- restart, backup/restore a delete/recreate neztratí ani nezamění data.
- built-in karty používají aktuální LAN host a redeploy/remove nehromadí
  kontejnery ani nepoužívané lokální image.

Po testu můžeš bezpečně uvolnit build cache:

```bash
./cleanup.sh
```

Named volumes ani běžící deploymenty tento skript nemaže. Celou jednorázovou VM
odstraň až po uložení výsledků a screenshotů.
