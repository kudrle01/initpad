# Nasazení InitPadu

Celou platformu lze nainstalovat jedním příkazem. Zahrnuje web, API, PostgreSQL,
Giteu, CI runner a simulované cíle nasazení. Jediným požadavkem je Docker
s pluginem Compose.

## Lokální instalace

```bash
git clone https://github.com/kudrle01/initpad.git
cd initpad/deploy
./install.sh
```

Otevřete <http://localhost:8080>, vytvořte první účet s instalačním tokenem,
který skript vypíše na konci instalace, a následně projekt. První účet se stane
administrátorem; další účty ve výchozím režimu `admin-provisioned` zakládá on.
Skript je idempotentní: lze jej kdykoliv spustit znovu a doplní pouze chybějící
části.

Ubuntu 24.04 a novější ve výchozím nastavení omezuje neprivilegované user
namespaces. Před první instalací na takovém hostu spusťte
`sudo ./prepare-rootless-runner.sh`. Skript načte AppArmor výjimku omezenou na
konkrétní cestu pro rootless CI daemon, aniž by vypnul omezení na celém hostu.
Pokud tato podmínka chybí, instalátor se zastaví a zobrazí stejný pokyn.

Instalátor rovněž vybere zkontrolovaný release Agenta ze souboru
`agent-release.env`. Pro připojení Docker serveru vytvořte jeho target v části
**Infrastructure**, vygenerujte enrollment a na daném serveru spusťte zobrazený
instalační příkaz ověřující checksum. Na hostu záměrně není vyžadován příkaz
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
jiném počítači. Výjimkou je jen volba *Jen tento počítač*. Před první
instalací spusťte `./self-hosted-check.sh preflight`: ověří čistý host,
Docker Compose a kapacitu, pod minimem selže a pod doporučením varuje.
Samotný `install.sh` kapacitu nekontroluje. Nároky rostou hlavně s CI buildy
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
   | 2) Interní síť s DNS | škola nebo firma, jména na řadiči domény | vlastní certifikační autorita InitPadu |
   | 3) Veřejná doména | server dostupný z internetu na portech 80 a 443 | Let's Encrypt |

   U voleb 2 a 3 zadáte jméno platformy a jméno Gitu (nabídne se
   `git.<nadřazená doména>`). Instalátor podle odpovědi vyplní všechny
   adresy v `deploy/.env` (`INITPAD_PUBLIC_URL`, `INITPAD_GITEA_PUBLIC_URL`,
   `INITPAD_DOMAIN`, `INITPAD_GIT_DOMAIN`, `INITPAD_TLS_DIRECTIVE`, registry
   a interní adresy pro CI) a na konci zkontroluje, že se jména překládají
   na tento server. Bez dotazů lze totéž nastavit parametry:

   ```bash
   ./install.sh --domain initpad.lab.example --tls internal   # interní síť
   ./install.sh --domain platform.example.org --tls public    # internet
   ./install.sh --local                                       # jen tento počítač
   ```

   `--git-domain` jméno Gitu přepíše. Bez `--tls` se použije `internal` pro
   domény `.local`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.intranet`
   a `.corp`, jinak `public`. Další spuštění `./install.sh` konfiguraci sítě
   nemění. Pro změnu domény nebo režimu spusťte `./install.sh --reconfigure`.

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
   Porty 8080, 3001 a 8085 Docker publikuje mimo `ufw`; na veřejném rozhraní
   je zablokujte podle [provozního runbooku](./OPERATIONS.md#bezpečnost).

Caddy ukončuje HTTPS pro obě jména, posílá hlavičku HSTS a požadavky na
`/api/*` předává přímo API, `INITPAD_TRUST_PROXY_HOPS` proto zůstává `1`.
Vestavěné odkazy na aplikace používají hostname z `INITPAD_PUBLIC_URL`.
Proměnnou `INITPAD_DEPLOY_PUBLIC_HOST` nastavujte pouze u dělené topologie,
ve které aplikace záměrně používají jiný hostname.

Nasazení s přímými porty se ve výchozím stavu vážou na `127.0.0.1`. Pro
stabilní HTTPS adresy aplikací upřednostněte managed gateway. Pokud musí
důvěryhodní klienti v LAN přistupovat k náhodným přímým portům, nastavte
explicitně `INITPAD_DEPLOY_BIND_ADDRESS=0.0.0.0` a ve firewallu omezte jejich
rozsah pouze na tuto LAN. Samotná změna bind adresy není access-control
pravidlem.

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

- **Záloha:** spusťte `./backup.sh /secure/path/initpad-backup`. Skript krátce
  zastaví procesy provádějící zápis, vytvoří dump PostgreSQL, archivuje Giteu,
  artefakty v object storage, data API a Supervisoru, aktivní podepsaný release descriptor,
  publikované statické soubory, volitelná data Caddy a registraci runneru a
  zkopíruje `.env`. Dříve běžící služby znovu spustí i při selhání zálohy.
  Záloha obsahuje přihlašovací údaje; zašifrujte ji a uchovávejte kopii mimo
  host.
- **Cvičná obnova:** na disposable instalaci spusťte
  `./restore.sh <backup-directory>`. Skript ověří checksumy, zastaví všechny
  profily, obnoví zálohované `.env`, databázi a neaktivní volumes a následně
  spustí základní stack, runner a nakonfigurovaný HTTPS profil. Funkčnost zálohy
  vždy nejprve ověřte na disposable hostu.
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
  souboru `agent-release.env`. Úplnou explicitní dvojici zachová, takže lokální
  pin ani rollback nikdy skrytě nenahradí. Příkaz
  `./install.sh --update-agent-release` explicitně převezme aktuální
  zkontrolovaný release a restartuje platformu s přesnou verzí a immutable
  digestem. Neúplná nebo mutable dvojice způsobí bezpečné selhání před startem
  platformy, pokud ji explicitní aktualizace neopraví. Dvojice bootstrapuje nové
  hosty; zaregistrovaní Agenti vyhledají pozdější podepsané stabilní releasy bez
  úpravy `.env`. Výchozí `INITPAD_AGENT_UPDATE_CHANNEL` je `stable`. Kanál
  `candidate` nastavujte pouze na disposable acceptance instalaci a po testu jej
  vraťte na `stable`.
- **Logy:** použijte `docker compose logs -f api`, případně název jiné služby.
- Tento stack a vývojový stack v `infra/` nespouštějte současně; záměrně
  používají stejný Compose project name.

## Řešení problémů

- **`database volume was initialized with a different password`:** existuje
  starší volume `pgdata`, ale `.env` byl vygenerován znovu. Pro nový začátek
  spusťte `docker compose down -v && rm .env && ./install.sh`; příkaz odstraní
  všechna data platformy. Alternativně vraťte `INITPAD_DB_PASSWORD` na původní
  hodnotu.
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
