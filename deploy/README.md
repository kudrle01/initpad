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

Otevřete <http://localhost:8080>, vytvořte první účet a následně projekt.
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

Přibalené S3-compatible object storage používá připnutou starší binární verzi
MinIO a je určeno pro lokální vyhodnocení a důvěryhodné single-node instalace.
Nejde o doporučenou hranici úložiště pro veřejnou produkci. Před veřejným
zpřístupněním InitPadu nastavte proměnné `INITPAD_ARTIFACT_S3_*` pro samostatně
udržovanou S3-compatible službu. Zdůvodnění popisuje
[provozní dokumentace](./OPERATIONS.md#object-storage-produkční-hranice).

Instalátor automatizuje generování secretů, přípravu Gitey bez webového
průvodce (servisní účet a administrátorský token přes CLI), registraci SSO
(platforma je OIDC přihlášením pro Giteu), registraci izolovaného CI runneru,
verzované databázové migrace a sestavení kontejnerů.

## Instalace na server

1. Nasměrujte na server dva DNS záznamy, například `platform.example.org` a
   `git.example.org`.
2. V souboru `deploy/.env` nastavte:

   ```ini
   INITPAD_PUBLIC_URL=https://platform.example.org
   INITPAD_GITEA_PUBLIC_URL=https://git.example.org
   INITPAD_REGISTRY_HOST=git.example.org
   INITPAD_DOMAIN=platform.example.org
   INITPAD_GIT_DOMAIN=git.example.org
   ```

   Vestavěné odkazy na aplikace automaticky používají hostname z
   `INITPAD_PUBLIC_URL`. Proměnnou `INITPAD_DEPLOY_PUBLIC_HOST` nastavujte pouze
   u dělené topologie, ve které aplikace záměrně používají jiný hostname.

   Nasazení s přímými porty se ve výchozím stavu vážou na `127.0.0.1`. Pro
   stabilní HTTPS adresy aplikací upřednostněte managed gateway. Pokud musí
   důvěryhodní klienti v LAN přistupovat k náhodným přímým portům, nastavte
   explicitně `INITPAD_DEPLOY_BIND_ADDRESS=0.0.0.0` a ve firewallu omezte jejich
   rozsah pouze na tuto LAN. Samotná změna bind adresy není access-control
   pravidlem.

3. Spusťte `./install.sh`. Nastavení `INITPAD_DOMAIN` aktivuje profil `server`;
   Caddy ukončuje HTTPS pro obě domény pomocí automatických certifikátů.
4. Ve firewallu otevřete porty 80 a 443 pro platformu, Git a managed gateway.
   Nakonfigurovaný rozsah přímých portů otevírejte pouze při použití výše
   uvedeného LAN režimu a jen pro důvěryhodné zdrojové sítě.

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
Gitea, MinIO, lokální runner, simulované targety, Supervisor ani Docker socket
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
  MinIO artefakty, data API a Supervisoru, aktivní podepsaný release descriptor,
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
