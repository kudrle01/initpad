# InitPad Agent

InitPad Agent běží na Docker targetu a připojuje se **odchozím spojením** ke
control plane InitPadu. Nevystavuje SSH, Docker API ani administrační HTTP port.
Target proto potřebuje Docker a odchozí HTTPS, nikoli Node.js.

Implementovaný runtime zajišťuje enrollment, credential soubor přístupný pouze
uživateli root, zjištění schopností Dockeru, heartbeat, trvalý přenos jobů s
lease a Docker lifecycle engine omezený na konkrétní allocation. Agent 0.4 také
provádí skutečné projektové joby `deploy`, `start`, `stop` a `remove` z
ověřených build artefaktů. Wire protokol záměrně nemá obecný shell endpoint.

Agent 0.5 doplnil read-only readiness gate pro produkční směrování Caddy,
Agent 0.6 trvalý route reconciler chráněný generací, Agent 0.7 síť workloadu
vlastněnou allocation a Agent 0.8 health gate se dvěma revizemi a veřejným
HTTPS. Control plane řadí workload a route joby v bezpečném pořadí a managed
deployment publikuje až poté, co jeho stabilní URL vrátí 2xx. Neúspěšný cutover
obnoví dříve obsluhující revizi. Agent 0.9 doplnil omezenou diagnostiku
workloadu v rozsahu allocation. Agent 0.10 po 30 dnech automaticky rotuje
credential targetu s dvoufázovým překryvem: před ověřením nové identity uloží
novou generaci i původní fallback, takže restart ani ztracená odpověď target
neodpojí.

Repozitář sestavuje Agenta jako spustitelný Node.js balíček a minimální
kontejnerový image. Zkontrolovaný instalátor pro Linux poskytuje control plane
a zobrazí jej v enrollment dialogu poté, co správce instance nastaví immutable
digest `INITPAD_AGENT_IMAGE` a explicitní `INITPAD_AGENT_RELEASE_VERSION`.
Instalátor provede instalaci a enrollment bez klonování repozitáře, zachová mezi
aktualizacemi identitu přístupnou pouze uživateli root a při chybějícím
heartbeat náhradního kontejneru obnoví předchozí kontejner. Repozitář publikuje
podepsané veřejné image pro `amd64/arm64`. Aktuálním zkontrolovaným distribučním
releasem je Agent 0.14.3. Jeho výsledný image prošel CLI runtime probe,
ověřením podpisu, anonymním auditem veřejného releasu, živou aktualizací,
restartem hostu, migrací URL a rollback acceptance.

Releasy 0.13.0 a 0.14.0 byly odmítnuty, protože jejich runtime image
neobsahovaly produkční závislost `sigstore`. Ani jeden během acceptance
nenahradil existujícího Agenta. Níže popsaný lokální lab zůstává podporovanou
acceptance cestou pro build ze zdrojového kódu.

Agent 0.13 přidal protokol vzdálené aktualizace. Owner nebo admin musí každou
aktualizaci targetu explicitně potvrdit v **Manage Agent**. Control plane vybere
stabilní release ze svého omezeného GitHub katalogu a ověří přesnou identitu
Sigstore workflow v release manifestu. Agent ověří stejný manifest znovu,
stáhne pouze immutable digest image a předá náhradu krátkodobému updateru
spuštěnému z již důvěryhodného image Agenta. Updater provede preflight kandidáta
se stávající identitou, odstaví původní kontejner, vyžádá úspěšný nový heartbeat
a jinak původní kontejner obnoví. Aplikační workloady se nerestartují. Job
neobsahuje obecný příkaz, URL skriptu ani uživatelem dodaný image. Přechod z
0.12.1 na 0.13 zůstává poslední ruční operací instalátoru; vzdálené aktualizace
se uplatní od verze 0.13.

Agent 0.14.1 byl prvním opraveným releasem kompatibilním s protokolem. Do
runtime image doplnil produkční závislosti a před podepsáním také smoke test CLI
v kontejneru. Verze 0.14.2 následně prokázala živou aktualizaci z funkční 0.14.1,
zachování identity a workloadů a automatický rollback po záměrně neúspěšné
náhradě. Záměrně zachovává protokol ve verzi 1, aby acceptance nezávisela na
migraci wire protokolu.

Veřejný podepsaný release 0.14.3 považuje URL control plane za měnitelná
transportní metadata, nikoli součást identity Agenta. Pokud provozovatel znovu
spustí zkontrolovaný instalátor se změněnou URL, Agent na tento endpoint odešle
stávající credential, vyžádá přijatý heartbeat a teprve poté atomicky uloží
novou URL. Neúspěšné ověření ponechá původní URL, credential i vazbu targetu beze
změny. Tento postup slouží ke změně hostname, LAN adresy nebo TLS entry pointu
stejné instance InitPadu. Přesun hostu do jiné instance nadále vyžaduje
explicitní re-enrollment.

Release assets, podpisy a OCI index `amd64/arm64` prošly anonymním ověřením
distribuce. Dne 1. října 2026 samostatný Linux host zachoval stejný kontejner
Agenta, identitu i managed workloady přes skutečný restart, přijal dostupnou
změnu URL, odmítl nedostupný endpoint a bez re-enrollmentu se vrátil na původní
URL.

Nové verzovací tagy se publikují jako GitHub prerelease. Zákaznické control
plane používají ve výchozím stavu update kanál `stable`; disposable acceptance
instance může zvolit `candidate`. Povýšení mění pouze metadata GitHub releasu
poté, co podepsaný image projde runbookem. Image se znovu nesestavuje a jeho tag
se nepřesouvá.

Správci releasu používají [RELEASING.md](./RELEASING.md) a clean-host
[release acceptance](./ACCEPTANCE.md). Instalátor zobrazený control plane zůstává
vypnutý, dokud nasazení nenastaví přesný digest vytvořený úspěšným releasem.

`host-acceptance.sh` je důkazní pomocný skript spouštěný provozovatelem při
testech odpojení, restartu hostu a migrace URL control plane. Napříč těmito
lifecycle událostmi ověřuje identitu Agenta a ID kontejnerů workloadů spravovaných
InitPadem a prokazuje, že odmítnutá URL existujícího Agenta nezmění. Checkpoint
restartu navíc ověří službu Docker při startu, restart policy a Linux boot ID a
následně prokáže obnovení stejného kontejneru. Skript nikdy nezastavuje,
nespouští ani nenahrazuje kontejner a svůj report přístupný pouze uživateli root
ukládá mimo checkout zdrojového kódu.

Produkční instalátor je `apps/agent/install.sh`. Provozovatelé mají běžně
používat úplný příkaz s ověřením checksumu vytvořený v **Manage Agent**, nikoli
kopírovat tento zdrojový soubor nebo spouštět host-level binární soubor
`initpad-agent`. Příkaz vyžaduje pouze Docker Engine na Linuxu, host networking
používá jen pro proces Agenta, připojuje lokální Docker socket a identitu ukládá
do `/var/lib/initpad-agent`. Stažený skript podporuje `--help` a volitelné
parametry pro hostname přímých portů, privátní Caddy socket, privátní CA a
explicitní recovery `--re-enroll`. Běžná aktualizace před zastavením původního
Agenta ověří uloženou identitu. Odmítnutý credential nikdy skrytě nenahradí;
`--re-enroll` vyžaduje nový krátkodobý token a je vyhrazen pro odpojený, znovu
vytvořený nebo obnovený target. Tyto lokální údaje se záměrně nepřebírají z
control-plane jobu.

Vygenerovaný příkaz obsahuje také necitlivé ID zamýšleného targetu. Než
instalátor zachová existující identitu hostu, ověří, že patří přesně tomuto
targetu. Host se tak nemůže úspěšně připojit ke staršímu targetu, zatímco nově
vytvořená karta serveru zůstane ve stavu `not enrolled`.

Control plane používá `publicUrl` targetu k sestavení odkazů pro prohlížeč;
nejde o adresu health checku Agenta. Produkční Agent s lokálním Docker socketem
a host networkingem kontroluje publikované porty přes loopback. Parametr
`--published-host` zůstává explicitní volbou pouze pro lab, ve kterém Agent
ovládá vzdálený Docker daemon, například izolovaný Docker-in-Docker acceptance
stack.

Ruční instalátor zůstává i po verzi 0.13 cestou pro recovery a air-gap.
Vzdálené aktualizace probíhají záměrně po jednotlivých targetech: nejprve
aktualizujte jeden nekritický target, sledujte jeho heartbeat a výsledky testů
protokolu a Dockeru a teprve poté schvalte zbývající targety. InitPad nikdy
skrytě nenasazuje release Agenta na všechny servery současně.

Kontejner Agenta používá `unless-stopped`. Po návratu Dockeru po restartu hostu
se dříve běžící Agent spustí, ale explicitní ruční zastavení správcem zůstane
zachováno. Na běžném hostu se systemd instalátor upozorní, pokud není povolena
služba `docker.service`; boot policy hostu skrytě nemění. Recovery po
neočekávaném restartu používá v případě potřeby
`systemctl enable --now docker` a `docker start initpad-agent`, nikdy nový
enrollment token.

## Lokální acceptance bez VM

Lab používá vyhrazený Docker-in-Docker daemon. Agent nikdy nedostane socket
hostu používaný InitPadem, takže představuje samostatný zákaznický target, i
když vše běží na jednom vývojovém počítači.

1. Spusťte standardní platformu pomocí `deploy/install.sh`.
2. V části **Infrastructure** přidejte target `Docker (InitPad Agent)` se základní
   URL aplikací, například `http://127.0.0.1`.
3. Vygenerujte enrollment token, ale dialog zatím nezavírejte.
4. Z adresáře `deploy/` spusťte následující příkazy. Pokud prompt shellu už
   zobrazuje `deploy`, příkaz `cd deploy` znovu nespouštějte:

   ```sh
   ./agent-lab.sh build
   ./agent-lab.sh enroll
   ./agent-lab.sh start
   ./agent-lab.sh logs
   ```

5. Token vložte pouze do skrytého promptu. Nejpozději do 30 sekund se stav v UI
   změní na `online` a zobrazí verze Agenta a Dockeru i čas posledního kontaktu.
6. Lab zastavíte příkazem `./agent-lab.sh stop`. Po 90 sekundách se stav v UI
   změní na `offline`. Po opětovném spuštění se vrátí na `online` bez nového
   enrollmentu.
7. Klikněte na **Manage Agent → Test protocol**. Job projde stavy `queued`,
   `leased` a `succeeded`, jeho průběh postupuje 35 sekund a při běžném průběhu
   zůstává `attempt` roven 1. Probe nevytváří kontejner.
8. Klikněte na **Test Docker**. Image Nginx připnutý digestem projde vytvořením,
   health checkem, omezeným čtením logů, výměnou, rollbackem, zastavením,
   spuštěním a odstraněním. Nejnovější záznam `lifecycle-test` musí skončit jako
   `succeeded` se zprávou `Docker lifecycle test completed and cleaned up`.
9. Ověřte, že izolovaný target neobsahuje žádné zbytky po diagnostice:

   ```sh
   ./agent-lab.sh docker ps -a --filter label=com.initpad.managed=true
   ./agent-lab.sh docker image inspect \
     nginx@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
   ./agent-lab.sh docker network inspect net-<workspace-slug>-diagnostic
   ```

   První příkaz nevypíše žádný workload. Oba příkazy `inspect` vrátí not found,
   pokud test image stáhl a síť vytvořil sám. Image, který byl v cache už před
   testem, se záměrně zachovává.
10. **Disable Agent** zneplatní credential. Běžící proces dostane odpověď `401`,
    zaznamená `agent.credential_rejected` a skončí. Poté je nutný nový
    enrollment.

Obnovení lease ověříte takto: spusťte další probe, po přechodu do stavu `leased`
zastavte `agent-lab`, počkejte alespoň 30 sekund a znovu jej spusťte. Stejný job
se převezme jako `attempt 2` a úspěšně skončí. Zastaralý první pokus po
přeřazení nemůže obnovit lease ani publikovat průběh.

Proměnná `INITPAD_AGENT_LAB_URL` přepíše URL control plane, pokud se liší port
webu nebo hostname. HTTP je přijato pouze proto, že lab předává explicitní
příznak `--allow-insecure-http`. Skutečné instalace dostupné z internetu
vyžadují HTTPS.

## Acceptance skutečného doručení projektu

Po úspěšných diagnostických testech výše ověřte skutečnou cestu projektu:

1. Znovu sestavte aktuální control plane a Agenta bez resetu volumes:

   ```sh
   cd deploy
   docker compose build api web
   docker compose up -d api web
   ./agent-lab.sh build
   ./agent-lab.sh start
   ```

2. V části **Infrastructure** ověřte, že target je `online` a hlásí Agenta ve
   verzi `0.4.0` nebo novější. Target musí být nyní možné vybrat v **New
   project**.
3. Vytvořte jednorázový projekt, například React, a pro prostředí `dev` vyberte
   target s Agentem. Prostředí test a prod ponechte na jejich stávajících
   targetech. Počkejte na CI a poté na změnu prostředí dev z `Waiting for Agent`
   přes ověření artefaktu a health check do stavu `running`.
4. Ověřte, že izolovaný daemon vlastní přesně očekávaný workload omezený na
   allocation:

   ```sh
   ./agent-lab.sh docker ps \
     --filter label=com.initpad.managed=true \
     --format '{{.Names}}  {{.Image}}  {{.Ports}}'
   ```

   Tag image a revize musí odpovídat buildu zobrazenému v projektu. Agent už
   uvnitř targetu dokončil HTTP health check. Lab omezuje náhodné porty na
   rozsah od `42000` do `42031` a zpřístupňuje je přes neprivilegovaný TCP
   bridge navázaný pouze na loopback hostu. Při URL aplikace targetu
   `http://127.0.0.1` se proto odkaz zobrazený InitPadem musí otevřít ze stejného
   vývojového počítače. Bridge nepublikuje port Docker API 2375 a nenahrazuje
   produkční ingress na skutečném targetu.
5. V nástrojích prostředí spusťte **Stop**, **Start** a poté **Remove
   deployment**. Každá operace musí projít jobem Agenta a prostředí musí postupně
   skončit ve stavech `stopped`, `running` a `empty`. Příkaz `docker ps -a` výše
   po odstranění nesmí vrátit žádný kontejner.
6. Spusťte další deploy, zastavte Agenta dříve, než job převezme, a počkejte, až
   UI označí target jako offline. Operace musí zůstat ve stavu `Waiting for
   Agent`, nesmí selhat ani proběhnout lokálně. Agenta znovu spusťte, stejná
   operace pak skončí právě jednou.
7. Ověřte, že druhý workspace nevidí ani nemůže alokovat target Agenta prvního
   workspace. Dva workloady Agentů na jednom fyzickém daemonu otestujete tak, že
   zaregistrujete druhý target vlastněný workspace a proti lab daemonu spustíte
   druhou identitu Agenta:

   ```sh
   ./agent-lab.sh enroll-secondary
   ./agent-lab.sh start-secondary
   ./agent-lab.sh status
   ```

   Sekundární identita má vlastní volume s credentialem s oprávněním `0600`, ale
   záměrně používá stejný daemon DinD. Nasaďte po jednom projektu z každého
   workspace. Labely, názvy a sítě musí používat odlišné namespace. Zastavení
   nebo odstranění druhého workloadu musí první ponechat běžící a dostupný.
   Žádný workspace nesmí vidět target ani workload toho druhého a nesmí s nimi
   manipulovat. Centrálně sdílený target Agenta pro více workspace vyžaduje
   budoucí model sdílení na úrovni správce platformy.

   Pokud jsou potřeba dvě spravované identity a existující lab target s přímými
   porty má zůstat online, nabízí lab také volitelný třetí slot credentialu se
   stejným izolačním kontraktem:

   ```sh
   ./agent-lab.sh enroll-tertiary
   ./agent-lab.sh start-tertiary
   ./agent-lab.sh logs-tertiary
   ```

   Nejde o produkční topologii ani sdílený credential. Každý proces nadále
   představuje jeden samostatně zaregistrovaný target a ukládá pouze jeho
   credential.

## Preflight managed gateway a směrování řízené health checkem (Agent 0.8)

Produkční preflight je infrastrukturní acceptance test. Správce targetu
připraví:

- samotný origin gateway, například `apps.example.test`, který se překládá na
  gateway a na portu 443 poskytuje certifikát důvěryhodný pro host Agenta,
- wildcard DNS, aby se `initpad-preflight.apps.example.test` překládalo na
  stejnou cestu gateway, kterou používají hostnamy aplikací,
- přednostně lokální proměnnou Agenta `INITPAD_AGENT_GATEWAY_ADMIN_SOCKET`,
  která ukazuje na socket s omezeným oprávněním pod `/run`. Proměnná
  `INITPAD_AGENT_GATEWAY_ADMIN_URL` zůstává k dispozici pro explicitně
  izolovanou loopback nebo privátní správní síť.

Control plane tuto admin URL nikdy neposílá v jobu ani ji neukládá. Přibalený
lab připojuje mezi Agenta a Caddy vyhrazený Unix socket. Caddy běží uvnitř
stejného izolovaného daemonu jako workloady, nemá Docker socket a neotevírá
žádný admin TCP listener.

### Lokální acceptance DNS a TLS na macOS

Lab poskytuje věrný lokální ekvivalent bez nutnosti registrované domény.
Rezervuje `apps.initpad.test`, provozuje split-horizon wildcard DNS pro Agenta a
host a ukončuje HTTPS na loopback portu 443 pomocí vyhrazené CA Caddy. Pohled
hostu na portu 5533 vrací `127.0.0.1`, pohled Agenta vrací adresu edge v jeho
privátní Docker síti. Lab macOS automaticky neupravuje a nepředstírá konfiguraci
produkčního DNS.

1. Z adresáře `deploy/` spusťte edge a vygenerujte jeho CA:

   ```sh
   ./agent-lab.sh gateway-setup
   ```

2. Spusťte dva bloky nastavení pro macOS, které tento příkaz vypíše. První
   vytvoří `/etc/resolver/apps.initpad.test`, druhý důvěřuje pouze vygenerované
   CA labu. Kopie CA se ukládá pod ignorovaný adresář `deploy/.runtime/` a nikdy
   se necommituje.
3. Vytvořte target s volbou **Managed gateway (production)** a URL aplikace
   `https://apps.initpad.test`. Proveďte enrollment a po připravenosti edge
   spusťte odpovídající identitu Agenta.
4. Zvolte **Manage Agent → Test gateway**. Wildcard DNS, důvěryhodné TLS i
   privátní admin socket Caddy musí projít. Otevření `https://apps.initpad.test`
   nesmí zobrazit varování o certifikátu.

Soubor resolveru ovlivňuje pouze rezervovanou subzónu `.test`. Část s DNS
vrátíte zpět odstraněním `/etc/resolver/apps.initpad.test` a vyprázdněním DNS
cache macOS. Až lab nebudete potřebovat, odstraňte přesný importovaný certifikát
Caddy přes Správu klíčenky. Certifikáty nemažte podle obecné shody common name.
Skutečný server místo toho používá veřejné nebo privátní DNS spravované
administrátorem a CA, které jeho klienti důvěřují.

Po opětovném sestavení API, webu a Agenta 0.8 vytvořte jednorázový Docker target
s volbou **Managed gateway (production)** a HTTPS originem gateway, proveďte
enrollment, spusťte jej a zvolte **Manage Agent → Test gateway**. Job musí projít
wildcard DNS, důvěryhodným TLS a připraveností privátního Caddy a skončit jako
`passed`. Zastavení Agenta ponechá zařazený test čekající. Neplatná DNS zóna
nebo certifikát skončí jako `failed` s odpovídající omezenou chybou. Změna
originu targetu vrátí předchozí výsledek na `not-run`.

Stejný privátní adaptér nyní dokáže sladit pouze routy vlastněné control plane
ve vyhrazeném serveru Caddy `initpad`. Používá ETagy, aby nepřepsal souběžnou
změnu, a nikdy nepřijímá Caddy JSON, admin URL ani upstream z projektu. Před
instalací aktivní routy Agent připojí lokálně nakonfigurovaný
`INITPAD_AGENT_GATEWAY_CONTAINER` k přesně označené síti projektu a prostředí.
Zastavené nebo chybějící routy se odstraní dříve, než se gateway odpojí. Gateway
musí být běžící kontejner s labelem `com.initpad.gateway=true`. Payload projektu
ji nemůže vybrat.

Managed workloady používají síť pro každý projekt a svůj health port určený
pouze Agentovi ve výchozím stavu váží na loopback hostu. Kontejnerizovaný lab se
vzdáleným daemonem smí nastavit `INITPAD_AGENT_MANAGED_HEALTH_BIND=0.0.0.0`
pouze tehdy, pokud je daemon dosažitelný výhradně přes privátní správní síť
labu. Health port se nikdy nepoužívá jako managed URL v prohlížeči.

Záměrně neexistuje ruční tlačítko v UI pro syntetickou routu. Trvalé route joby
jsou interní a spouští je dvoustupňový životní cyklus projektu. Úspěšný
preflight zpřístupní kompatibilní target pro výběr. Každý managed deploy vytvoří
workload specifický pro revizi, ověří jeho interní health, atomicky přepne Caddy
a poté vyžádá přesnou veřejnou HTTPS cestu health checku. Pouze odpověď 2xx
potvrdí novou revizi a vyřadí starý kontejner i nepoužívaný image. DNS, TLS,
přesměrování a odpovědi jiné než 2xx gate neprojdou, obnoví předchozí upstream
a zahodí pouze neúspěšného kandidáta. Úplné odebrání projektu vypíše a odstraní
každou revizi workloadu s přesnými vlastnickými labely targetu, allocation,
projektu a prostředí.

## Uložení credentialu

Credential se atomicky zapisuje do `/var/lib/initpad-agent/agent.json`. Adresář
má režim `0700`, soubor `0600` a symlinky i nepravidelné konfigurační soubory se
odmítají. Databáze a logy Agenta nikdy neobsahují credential v čitelné podobě ani
lease token jobu. Databáze ukládá pouze hashe SHA-256 obou typů credentialu.
Držení dlouhodobého credentialu opravňuje pouze k fyzickému targetu, ke kterému
jej enrollment navázal. Každý převzatý job navíc vyžaduje svůj krátkodobý
fencing token.

## Hranice Docker lifecycle

Agent 0.4.0 přijímá přísný verzovaný payload, který obsahuje pouze ID allocation,
namespace, identitu projektu a prostředí, revizi, immutable digest image, port
kontejneru, health cestu a klíčovaný otisk konfigurace. Neznámá pole se
odmítají. Engine nikdy nepřijme příkaz, entrypoint, bind mount, privilegovaný
režim ani host network. Hodnoty konfigurace se vyhodnocují pouze pro vítězný
lease a zůstávají v paměti. Neukládají se do trvalého jobu, průběhu ani
výsledku dokončení.

Labely kontejnerů a sítí musí před každou mutací odpovídat targetu a allocation.
Objekt cizího vlastníka se stejným názvem se považuje za kolizi a ponechá se beze
změny. Kandidátní workloady dostávají limity CPU, paměti, PID a logů,
`no-new-privileges` a malý povolený seznam capabilities. Kandidát startuje bez
restart policy, `unless-stopped` získá až po úspěšném health checku a nahradí
aktuální revizi dostatečně atomicky pro jednohostový prototyp. Aplikační logy
jsou omezeny na posledních 32 KiB.
