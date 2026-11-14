# Nasazení InitPadu

Celou platformu lze nainstalovat jedním příkazem. Zahrnuje web, API, PostgreSQL,
Giteu, CI runner a simulované cíle nasazení. Potřebujete Linux s Dockerem a
pluginem Compose, `git`, `curl` a `openssl`, přístup k internetu (GitHub,
Docker Hub, ghcr.io) a host podle [požadavků](#požadavky-na-server).

## Lokální instalace

```bash
git clone https://github.com/kudrle01/initpad.git
cd initpad/deploy
./install.sh
```

Otevřete <http://localhost:8080>, vytvořte první účet s instalačním tokenem,
který skript vypíše na konci instalace, a následně projekt. První účet se stane
administrátorem; další účty ve výchozím režimu `admin-provisioned` zakládá on.
Dev prostředí projektu běží na vestavěném Docker serveru tohoto počítače a jeho
URL funguje hned po prvním buildu (porty aplikací zůstávají na `127.0.0.1`,
API je ověřuje přes Docker host-gateway, ADR-174).

Skript je idempotentní: lze jej kdykoliv spustit znovu a změní jen to, co chybí
nebo neodpovídá konfiguraci. Bez změn trvá opakovaný běh několik sekund,
image znovu nesestavuje a Giteu nerestartuje, takže nepřeruší běžící CI.
Výstup buildu a přípravy CI image ukládá do `deploy/.runtime/logs/` a při
chybě vypíše jeho konec. Před spuštěním čehokoli zkontroluje volné porty a
kapacitu hostu. Obsazený port ohlásí i s volnou náhradou; porty mění proměnné
`INITPAD_WEB_PORT`, `INITPAD_GITEA_HTTP_PORT` a `INITPAD_STATIC_WEB_PORT`
v `deploy/.env` a další `./install.sh` podle nich přepočítá všechny adresy.

Ubuntu 24.04 a novější ve výchozím nastavení omezuje neprivilegované user
namespaces. Před první instalací na takovém hostu spusťte
`sudo ./prepare-rootless-runner.sh`. Skript načte AppArmor výjimku omezenou na
konkrétní cestu pro rootless CI daemon, aniž by vypnul omezení na celém hostu.
Pokud tato podmínka chybí, instalátor se zastaví a zobrazí stejný pokyn.

Instalátor rovněž vybere zkontrolovaný release Agenta ze souboru
`agent-release.env`. Pro připojení Docker serveru zvolte **Servers → Add
server → Agent**, vygenerujte enrollment a na daném serveru spusťte zobrazený
instalační příkaz ověřující checksum. Agent na jiném serveru se musí k
InitPadu dostat, proto instalace *Jen tento počítač* (`http://localhost`)
Agenta nepřipojí; použijte `--ip` nebo doménu. Na hostu záměrně není vyžadován příkaz
`initpad-agent`, Makefile ani checkout repozitáře. Instalátor potřebuje pouze
Docker a identitu Agenta ukládá mimo jeho nahraditelný kontejner.

Přibalené S3-compatible object storage používá připnutý SeaweedFS (ADR-163)
a je určeno pro lokální vyhodnocení a důvěryhodné single-node instalace.
Nejde o doporučenou hranici úložiště pro veřejnou produkci. Před veřejným
zpřístupněním InitPadu nastavte proměnné `INITPAD_ARTIFACT_S3_*` pro samostatně
udržovanou S3-compatible službu. Zdůvodnění popisuje
[provozní dokumentace](./OPERATIONS.md#object-storage-produkční-hranice).

Instalátor automatizuje generování secretů, přípravu Gitey bez webového
průvodce (servisní účet a administrátorský token přes CLI), registraci SSO
(platforma je OIDC přihlášením pro Giteu), registraci izolovaného CI runneru,
verzované databázové migrace a sestavení kontejnerů.

## Požadavky na server

| | Minimum | Doporučeno |
|---|---|---|
| Systém | Linux s Docker Engine a pluginem Compose; `amd64` je živě ověřené, image vychází i pro `arm64` | Ubuntu Server 24.04 LTS `amd64` bez grafického prostředí, správa přes SSH |
| CPU | 2 jádra | 4 vCPU |
| RAM | 6 GiB | 8 GiB |
| Volné místo pro Docker | 20 GiB | 40 GiB (disk VM 80 GB) |

Grafické prostředí server nepotřebuje, InitPad se otevírá z prohlížeče na
jiném počítači. Výjimkou je jen volba *Jen tento počítač*. `install.sh`
kapacitu zkontroluje sám: pod minimem varuje a čerstvou instalaci odmítne jen
při zjevném nedostatku (méně než 3 GiB RAM nebo 8 GiB volného místa; obejde to
`INITPAD_SKIP_PREFLIGHT=1`). Přísnější `./self-hosted-check.sh preflight` pro
acceptance navíc vyžaduje čistý host a pod minimem selže. Na Ubuntu 24.04 a
novějším je před první instalací potřeba `sudo ./prepare-rootless-runner.sh`
(viz výše). Nároky rostou hlavně s CI buildy
a s aplikacemi nasazenými přímo na tento host (viz
[Kapacita a škálování](./OPERATIONS.md#kapacita-a-škálování)).

## Instalace na server

1. Vytvořte dva DNS záznamy typu A, které ukazují na IP serveru: jeden pro
   platformu (např. `initpad.lab.example`) a jeden pro Git a registry image
   (např. `git.lab.example`). V interní síti je vytvořte na svém DNS serveru,
   typicky na řadiči domény. Na tento DNS server musí být nasměrovaný i
   samotný server InitPadu, protože jeho Docker démon jména také překládá.
2. Spusťte `./install.sh`. Při prvním spuštění se zeptá, jak budou uživatelé
   InitPad otevírat:

   | Volba | Kdy | HTTPS |
   |---|---|---|
   | 1) Jen tento počítač | lokální vyzkoušení | ne, `http://localhost:8080` |
   | 2) Lokální síť přes IP | učebna, laboratoř nebo VM bez DNS, důvěryhodná síť | ne, `http://<IP>:8080` |
   | 3) Interní síť s DNS | škola nebo firma, jména na řadiči domény | vlastní certifikační autorita InitPadu |
   | 4) Veřejná doména | server dostupný z internetu na portech 80 a 443 | Let's Encrypt |

   Volba 2 nepotřebuje DNS záznamy (krok 1 přeskočte): instalátor nabídne IP
   adresu serveru a vyplní z ní všechny adresy. Aplikace nasazené na vestavěný
   Docker dostanou přímé porty dostupné z LAN (`INITPAD_DEPLOY_BIND_ADDRESS=0.0.0.0`);
   provoz běží přes HTTP, proto jen v důvěryhodné síti a s firewallem.

   U voleb 3 a 4 zadáte jméno platformy a jméno Gitu (nabídne se
   `git.<nadřazená doména>`). Instalátor podle odpovědi vyplní všechny
   adresy v `deploy/.env` (`INITPAD_PUBLIC_URL`, `INITPAD_GITEA_PUBLIC_URL`,
   `INITPAD_DOMAIN`, `INITPAD_GIT_DOMAIN`, `INITPAD_TLS_DIRECTIVE`, registry
   a interní adresy pro CI) a na konci zkontroluje, že se jména překládají
   na tento server. Bez dotazů lze totéž nastavit parametry:

   ```bash
   ./install.sh --domain initpad.lab.example --tls internal   # interní síť
   ./install.sh --domain platform.example.org --tls public    # internet
   ./install.sh --ip 192.168.1.20                             # LAN bez DNS
   ./install.sh --local                                       # jen tento počítač
   ```

   `--git-domain` jméno Gitu přepíše. Bez `--tls` se použije `internal` pro
   domény `.local`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.intranet`
   a `.corp`, jinak `public`. Další spuštění `./install.sh` režim sítě
   (`INITPAD_NETWORK_MODE`) zachová a jen podle něj a aktuálních portů znovu
   vyplní adresy. Pro změnu domény, IP adresy nebo režimu spusťte
   `./install.sh --reconfigure` nebo instalátor s novým parametrem.

   Doména `.local` koliduje s mDNS (Bonjour, Avahi). Klienti s Windows v doméně
   ji přeloží přes DNS, Linux a macOS mohou potřebovat úpravu konfigurace.
   Pokud doménu teprve volíte, použijte subdoménu skutečné domény nebo
   `.internal`.

3. **Jen u interní sítě:** nainstalujte kořenový certifikát InitPadu jako
   důvěryhodný na počítače, které InitPad otevírají. Instalátor vypíše jeho
   umístění a otisk SHA-256:
   - stažení: `http://<jméno platformy>/initpad-ca.crt` (přes HTTP, aby šel
     stáhnout ještě bez varování prohlížeče; otisk ověřte podle výpisu
     instalátoru),
   - soubor na serveru: `deploy/.runtime/tls/initpad-root-ca.crt`,
   - v GUI: **Account settings → Platform certificate** nabídne soubor
     ke stažení, otisk SHA-256 ve tvaru, jaký ukazuje prohlížeč, a návod pro
     Windows, macOS a Firefox. Stejný certifikát pokryje InitPad i Giteu,
   - v doméně Windows jej rozdejte skupinovou politikou: *Computer
     Configuration → Policies → Windows Settings → Security Settings → Public
     Key Policies → Trusted Root Certification Authorities*.

   Instalátor sám zajistí důvěru tam, kde ji InitPad potřebuje na serveru:
   Docker démon hostu dostane certifikát do
   `/etc/docker/certs.d/<jméno Gitu>/ca.crt` (zápis může vyžádat heslo pro
   `sudo`) a izolovaný CI démon do své konfigurace. Certifikát platí jen pro
   registry na jménu Gitu, systémové úložiště certifikátů instalátor nemění.
   Klonování repozitáře v CI jobech jde přes interní port Gitey, takže
   certifikát nepotřebuje.

   **Agent servery** dostanou certifikát automaticky. Příkaz z **Manage
   Agent** jej v tomto režimu nejdřív stáhne přes HTTP, ověří jeho otisk
   SHA-256 (prohlížeč administrátora jej dostal přes ověřené HTTPS), uloží
   jej do `/etc/docker/certs.d/<jméno Gitu>/ca.crt` a
   `/etc/initpad-agent/ca.crt`, použije jej pro stažení instalátoru a předá
   jej Agentovi parametrem `--ca-file`. Systémové úložiště certifikátů na
   cílovém serveru se nemění.

4. Ve firewallu otevřete porty 80 a 443 pro platformu, Git a managed gateway.
   Porty webu, Gitey a statického webu (výchozí 8080, 3001 a 8085) Docker
   publikuje mimo `ufw`; na veřejném rozhraní je zablokujte podle
   [provozního runbooku](./OPERATIONS.md#bezpečnost). S aktivním `ufw`
   instalátor v režimu domény povolí síti CI runneru porty 80 a 443.

Caddy ukončuje HTTPS pro obě jména, posílá hlavičku HSTS a požadavky na
`/api/*` předává přímo API, `INITPAD_TRUST_PROXY_HOPS` proto zůstává `1`.
Vestavěné odkazy na aplikace používají hostname z `INITPAD_PUBLIC_URL`.
Proměnnou `INITPAD_DEPLOY_PUBLIC_HOST` nastavujte pouze u dělené topologie,
ve které aplikace záměrně používají jiný hostname.

Nasazení s přímými porty se ve výchozím stavu vážou na `127.0.0.1` (a pro
health sondu API na Docker host-gateway, ADR-174). Pro stabilní HTTPS adresy
aplikací upřednostněte managed gateway. Pokud musí důvěryhodní klienti v LAN
přistupovat k náhodným přímým portům, nastavte explicitně
`INITPAD_DEPLOY_BIND_ADDRESS=0.0.0.0` (instalace `--ip` to dělá sama) a ve
firewallu omezte jejich rozsah pouze na tuto LAN. Samotná změna bind adresy
není access-control pravidlem.

Pro reprodukovatelné self-hosted ověření na Windows a VirtualBoxu postupujte
podle [SELF_HOSTED_ACCEPTANCE.md](./SELF_HOSTED_ACCEPTANCE.md). Dokument pokrývá
Ubuntu VM s bridged sítí, izolaci dvou workspace tenantů, všechny PHP varianty,
zálohu a obnovu i odstranění a opětovné vytvoření projektu. Nedestruktivní
`self-hosted-check.sh` zaznamenává preflight hostu, běžící stack, skutečný
restart a checkpointy zálohy bez zveřejnění secretů. Enrollment Agenta a
zachování workloadů ověřuje samostatný clean-host postup v
[apps/agent/ACCEPTANCE.md](../apps/agent/ACCEPTANCE.md). Ani jeden z těchto
postupů zatím nepředstavuje úplný test veřejného SaaS nasazení.

## Kontrakt veřejného SaaS stagingu

Soubor `saas.compose.yml` představuje samostatnou hranici control plane, nikoli
režim self-hosted stacku. Obsahuje pouze image API a webu. PostgreSQL, privátní
S3-compatible úložiště, secrety a veřejný edge zajišťuje prostředí nasazení.
Gitea, object storage, lokální runner, simulované targety, Supervisor ani Docker socket
hostu v tomto profilu nejsou.

Vyjděte ze souboru `.env.saas.example` a každou položku `*_FILE` nasměrujte na
soubor pouze pro čtení poskytnutý staging správcem secretů. Env soubor obsahuje
cesty, nikoli hodnoty secretů. API při startu odmítne secret dodaný současně
přímo i přes soubor, nečitelný nebo prázdný soubor a relativní cestu. Soubory se
načtou před databázovou migrací a odkazy na ně se odstraní z prostředí procesu
aplikace. Používejte immutable reference API, webu a Agenta ze zkontrolovaných
releasů. Před nasazením ověřte konfiguraci bez výpisu výsledného modelu:

```bash
./saas-check.sh /secure/runtime/initpad-saas.env
docker compose --env-file /secure/runtime/initpad-saas.env \
  -f saas.compose.yml up -d
```

Kontrola selže ještě před startem kontejnerů, pokud zůstal placeholder, veřejná
URL nepoužívá HTTPS, S3 endpoint nepoužívá HTTPS, secret byl vložen přímo místo
souboru nebo některá cesta k secretu není absolutní, čitelná, neprázdná a mimo
checkout zdrojového kódu. Hodnoty secretů ani výsledný Compose model nevypisuje.

Po spuštění profilu pokračujte podle
[SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md). Pomocný skript ověří veřejný HTTPS
edge, provedené migrace a skutečný S3 round-trip. Na disposable stagingu také
koordinuje nativní zálohu a obnovu PostgreSQL a bucketu prostřednictvím
spárovaných markerů, aniž by na hostu četl hodnoty secretů.

Konkrétní nízkonákladovou sestavu stagingu podle ADR-132 včetně projekce
secretů, edge tunelu a collectoru popisuje [SAAS_STAGING.md](./SAAS_STAGING.md).

Výchozí web binding je `127.0.0.1:8080`; musí jej proxyovat externí HTTPS
edge/WAF. Tento manifest je pouze staging kontrakt. Zbývající podmínky
veřejného SaaS uvádí [release readiness](../docs/RELEASE_READINESS.md).

SaaS profil rovněž vyžaduje privátní endpoint OTLP/HTTP Collectoru. Repliky API
do něj exportují traces a metriky; strukturované redigované JSON logy zůstávají
na standardním výstupu pro log collector daného runtime prostředí. InitPad
neobsahuje vlastní observability databázi. Začněte konfigurací v
[`observability/`](./observability/README.md) a zaveďte retenci, řízení přístupu,
alerty a incident acceptance popsané v
[pravidlech observability](../docs/OBSERVABILITY.md).

## Provoz

- **Záloha a obnova:** `./backup.sh <adresář>` a `./restore.sh <adresář>`.
  Co záloha obsahuje, jak ji šifrovat a jak obnovu nejdřív vyzkoušet popisuje
  jediné místo, [provozní runbook](./OPERATIONS.md#zálohy).
- **Aktualizace platformy:** správce použije **Instance administration →
  Platform updates**. InitPad přijme pouze nejnovější manifest podepsaný přesně
  určeným workflow označeného releasu, zazálohuje a ověří PostgreSQL, postupně
  přepne digest-pinned image API, webu a Supervisoru a při selhání readiness
  obnoví předchozí release. Vybraný release se ukládá do
  `.runtime/platform-update`, takže jej `docker compose up` ani `./install.sh`
  skrytě nenahradí source buildem. Zákaznické instalace používají
  `INITPAD_PLATFORM_UPDATE_CHANNEL=stable`. Kanál `candidate` je vyhrazen pro
  disposable acceptance instalaci a administrátorské UI jej viditelně označí.
- **Instalace ze zdrojového kódu:** pokud není aktivní podepsaný release,
  `git pull && ./install.sh` znovu sestaví checkout API, webu a Supervisoru. Po
  instalaci podepsaného releasu source pull aktualizuje provozní soubory, ale
  zachová instalované image. Pro další verzi platformy použijte release UI.
- **Recovery / air-gap:** stáhněte jeden adresář releasu platformy, ověřte jej
  na serveru a spusťte jeho `initpad-install-release.sh --project-root
/absolute/path/to/initpad`. Tato explicitní záložní cesta navíc vyžaduje
  Cosign a vytvoří úplnou zálohu před aktualizací.
- **Release Agenta:** `./install.sh` doplní prázdnou dvojici údajů o releasu ze
  souboru `agent-release.env` a označí ji `INITPAD_AGENT_RELEASE_SOURCE=auto`.
  Takto doplněnou dvojici každý další běh (po `git pull` nebo po aktualizaci
  platformy) posune na nový zkontrolovaný release. Ručně nastavenou dvojici
  s `INITPAD_AGENT_RELEASE_SOURCE=pinned` i dvojici ze starších instalací bez
  značky zachová, takže lokální pin ani rollback nikdy skrytě nenahradí. Příkaz
  `./install.sh --update-agent-release` explicitně převezme aktuální
  zkontrolovaný release a restartuje platformu s přesnou verzí a immutable
  digestem. Neúplná nebo mutable dvojice způsobí bezpečné selhání před startem
  platformy, pokud ji explicitní aktualizace neopraví. Dvojice bootstrapuje nové
  hosty; zaregistrovaní Agenti vyhledají pozdější podepsané stabilní releasy bez
  úpravy `.env`. Výchozí `INITPAD_AGENT_UPDATE_CHANNEL` je `stable`. Kanál
  `candidate` nastavujte pouze na disposable acceptance instalaci a po testu jej
  vraťte na `stable`.
- **Logy:** použijte `docker compose logs -f api`, případně název jiné služby.
  Výstup buildu a přípravy CI image z posledního `./install.sh` je v
  `deploy/.runtime/logs/`.
- **Úplné odstranění:** `./reset.sh` smaže stack, data, `.env`, `.runtime` a
  také aplikace nasazené na vestavěný Docker server (kontejnery
  `com.initpad.managed=true`, jejich sítě a image). Agent servery nemění.
- Vývojový stack v `infra/` je samostatný Compose projekt `initpad-dev`
  s vlastními volumy a porty, takže může běžet současně s tímto stackem.

## Řešení problémů

- **CI build padá na „prepare image“ s `lookup … i/o timeout` nebo
  `no such host`, případně `docker push` s `x509`:** server musí přeložit
  jméno platformy i Gitey (`INITPAD_DOMAIN`, `INITPAD_GIT_DOMAIN`). U jmen
  končících na `.local` (mDNS) posílá `systemd-resolved` na DNS server jen ty
  domény, které mají na rozhraní routovací doménu, takže se přeloží jen jedno
  jméno. Nastavte ji pro celou zónu:
  `printf '[Resolve]\nDNS=<ip DNS>\nDomains=~lab.local\n' | sudo tee /etc/systemd/resolved.conf.d/lab-local.conf`
  a `sudo systemctl restart systemd-resolved`. Pro produkci používejte `.lan`,
  `home.arpa` nebo subdoménu své domény místo `.local`. S aktivním `ufw` instalátor
  povolí síti CI runneru porty 80 a 443 na serveru (`sudo ufw status`).
- **`database volume was initialized with a different password`:** existuje
  starší volume `pgdata`, ale `.env` byl vygenerován znovu. Pro nový začátek
  spusťte `./reset.sh && ./install.sh`; příkaz odstraní všechna data platformy
  včetně volume runneru. Samotné `docker compose down -v` vynechá služby
  z profilů `runner` a `server` a jejich volume nechá. Alternativně vraťte
  `INITPAD_DB_PASSWORD` na původní hodnotu.
- **`The installed signed release … is older than this checkout`:** platforma
  byla dříve aktualizována přes Supervisor a checkout je mezitím novější.
  Instalátor starý release descriptor odloží vedle souboru jako
  `.superseded-<verze>` a platformu postaví z checkoutu. Je-li naopak checkout
  starší než release, instalátor skončí a vypíše tag, na který checkout přepnout.
- **Runner hlásí `unregistered runner`:** volume runneru přežilo novou Giteu.
  `./install.sh` registraci, kterou Gitea nezná, odstraní a runner se
  zaregistruje znovu.
- **`CI jobs keep fetching their actions from github.com`:** instalátor nemohl
  vytvořit nebo ověřit zrcadla akcí ze `runner/actions-mirror` (ADR-171). CI
  funguje dál, jen každý job stahuje akce z GitHubu. Spusťte `./install.sh`
  znovu, až bude github.com dostupný.
- **Workflow importovaného repozitáře padá na `uses: owner/name@…`:** CI joby
  berou krátce zapsané akce jen ze zrcadel v Gitee a act_runner nemá pro
  nezrcadlenou akci záložní cestu na github.com. Přidejte ji do
  `runner/actions-mirror` a spusťte `./install.sh`, nebo ji ve workflow zapište
  plnou adresou (`uses: https://github.com/owner/name@<ref>`), případně
  zrcadla vypněte `INITPAD_CI_ACTIONS_MIRRORS=off` v `.env` (všechny akce pak
  jdou z github.com). Seznam už obsahuje běžné `actions/*` a `docker/*` akce.
- **`Some ports InitPad needs are taken`:** port používá jiný program nebo
  kontejner. Uvolněte ho, nebo v `.env` nastavte navrhovaný port a spusťte
  `./install.sh` znovu; adresy se přepočítají.
- **Registrace SSO selže s `no such host: api`:** kontejner API neběží. Spusťte
  znovu `./install.sh`; SSO se registruje až po dosažení healthy stavu API.
- **Varování platformy fake-sftp na Apple Silicon:** image existuje pouze pro
  amd64 a běží přes emulaci. Compose soubor tuto skutečnost explicitně uvádí
  pomocí `platform: linux/amd64`.
- **`initpad-agent: command not found`:** neinstalujte ani nespouštějte host CLI.
  Na control-plane hostu InitPadu spusťte znovu `./install.sh`, otevřete **Manage
  Agent** a celý příkaz `curl ... && sudo sh ...` zkopírujte na cílový Docker
  server.
- **`rootlesskit ... operation not permitted` na Ubuntu:** spusťte
  `sudo ./prepare-rootless-runner.sh` a poté zopakujte `./install.sh`.
  Nevypínejte globálně `kernel.apparmor_restrict_unprivileged_userns`.
