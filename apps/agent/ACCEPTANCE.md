# Acceptance releasu InitPad Agenta

Tuto acceptance spusťte na samostatném disposable Linux Docker hostu dříve, než
bude release Agenta schválen pro produkci. Nepoužívejte host control plane. Test
musí prokázat, že server bez checkoutu zdrojového kódu a bez přihlášení do
registry dokáže nainstalovat veřejný release.

Zaznamenejte operační systém hostu, architekturu CPU, verzi Dockeru, verzi
releasu, immutable digest image a výsledek každého checkpointu. Do reportu
nikdy nezahrnujte enrollment token ani `/var/lib/initpad-agent/agent.json`.

## Předpoklady

- Linux se spuštěným Docker Engine, `curl` a `sha256sum`;
- odchozí přístup k control plane InitPadu a k `ghcr.io`;
- control plane nakonfigurovaná s `INITPAD_AGENT_IMAGE` a
  `INITPAD_AGENT_RELEASE_VERSION` z podepsaného release manifestu;
- nový target **Docker (InitPad Agent)**, jehož veřejná URL aplikace je
  dosažitelná pro zamýšlené uživatele.

Host nesmí již obsahovat identitu Agenta:

```sh
sudo test ! -e /var/lib/initpad-agent
! sudo docker container inspect initpad-agent >/dev/null 2>&1
```

Pokud některá kontrola selže, použijte nový disposable target. Existující
identitu neodstraňujte jen proto, aby tento předpoklad prošel.

## 1. První instalace

V části **Servers** otevřete target, zvolte **Manage Agent**, vygenerujte
jednorázový enrollment token a dialog ponechte otevřený. Kompletní příkaz **Run
on the Docker server** zkopírujte na Linux host. Příkaz stáhne instalátor z
control plane, ověří jeho SHA-256 z podepsaného releasu a předá immutable digest
image. Enrollment token vložte pouze do skrytého promptu.

HTTP je přijato pouze tehdy, když control plane sama vygenerovala explicitní
příznak `--allow-insecure-http` pro test v důvěryhodné LAN. Acceptance dostupná z
internetu vyžaduje HTTPS.

Na hostu ověřte nainstalovaný stav bez výpisu credentialu:

```sh
sudo docker inspect initpad-agent \
  --format 'image={{.Config.Image}} restart={{.HostConfig.RestartPolicy.Name}} readonly={{.HostConfig.ReadonlyRootfs}}'
sudo docker exec initpad-agent node /app/dist/cli.js version
sudo docker exec initpad-agent node /app/dist/cli.js once
sudo stat -c 'identity-mode=%a owner=%u:%g' /var/lib/initpad-agent/agent.json
```

Očekávané výsledky jsou digest releasu, `unless-stopped`, `true`, deklarovaná
verze Agenta, přijatý heartbeat a režim identity `600`. Target se musí v InitPadu
stát **online**. Spusťte **Test protocol** a **Test Docker**. Oba joby musí
uspět.

## 2. Obnova po restartu

Nasaďte na tento target Agenta alespoň jeden disposable projekt a ověřte, že
jeho workload běží. Gate restartu záměrně odmítne prázdný target, protože jinak
by neprokázal, že aplikační workloady restart hostu přežijí.

Pomocí ověřeného assetu `initpad-agent-host-acceptance.sh` ze stejného releasu
zkontrolujte před restartem Linux hostu službu Dockeru při startu, restart
policy Agenta, identitu, kontejner i všechny existující workloady:

```sh
sudo ./initpad-agent-host-acceptance.sh before-reboot
sudo reboot
```

Po opětovném připojení nespouštějte instalátor ani nevytvářejte další
enrollment. Stejný Agent se musí obnovit automaticky:

```sh
sudo ./initpad-agent-host-acceptance.sh after-reboot
```

InitPad musí zobrazit tutéž identitu targetu jako online. Restart nesmí vydat
nový enrollment ani zvýšit generaci credentialu Agenta. Na běžném hostu se
systemd `before-reboot` selže brzy, pokud není povolena služba `docker.service`.
Instalátor hlásí stejný stav, ale boot policy hostu záměrně nemění bez
rozhodnutí operátora.

Pokud je existující instalace po restartu již offline, diagnostikujte ji a
obnovte bez re-enrollmentu:

```sh
sudo systemctl is-enabled docker
sudo systemctl is-active docker
sudo docker inspect initpad-agent \
  --format 'running={{.State.Running}} restart={{.HostConfig.RestartPolicy.Name}} exit={{.State.ExitCode}}'
sudo docker logs --tail=100 initpad-agent
sudo systemctl enable --now docker  # pouze pokud byla služba zakázaná nebo neaktivní
sudo docker start initpad-agent     # pouze pokud Docker běží a kontejner je zastavený
```

Hodnota `unless-stopped` je záměrná: běžící Agent se po restartu obnoví, zatímco
Agent, kterého administrátor výslovně zastavil, zůstane zastavený. Spuštění
existujícího kontejneru zachová identitu targetu. Generování nového tokenu není
krokem obnovy.

## 3. Zachování workloadů při odpojení

Ponechte disposable projekt z testu restartu nasazený a zaznamenejte ID
kontejneru jeho workloadu. Stáhněte `initpad-agent-host-acceptance.sh` s jeho
checksumem a Sigstore bundle ze stejného označeného releasu Agenta a ověřte je
podle `RELEASING.md`. Pomocný skript zaznamenává pouze necitlivé identifikátory
targetu a kontejnerů do lokálního reportu přístupného jen uživateli root a sám
nikdy nic nezastavuje ani nespouští:

```sh
sudo ./initpad-agent-host-acceptance.sh before-disconnect
sudo docker stop initpad-agent
sudo ./initpad-agent-host-acceptance.sh disconnected
```

Workload musí zůstat běžet. Zadejte **Test protocol**, zatímco je Agent offline.
Job musí zůstat ve frontě a nesmí se provést lokálně. Obnovte Agenta:

```sh
sudo docker start initpad-agent
sudo ./initpad-agent-host-acceptance.sh after-reconnect
sudo cat /var/lib/initpad-agent/acceptance/results.tsv
```

Test protokolu ve frontě musí skončit právě jednou a původní target se musí
vrátit do stavu online. Report musí obsahovat řádky PASS pro `before-disconnect`,
`disconnected` a `after-reconnect`. Pomocný skript také prokáže, že se zachovala
identita targetu, generace credentialu, kontejner Agenta i každý existující
kontejner workloadu.

## 4. Idempotentní přeinstalace a rollback neúspěšné aktualizace

Znovu spusťte stejný instalační příkaz z kroku 1 se stejným digestem releasu.
Musí zachovat `/var/lib/initpad-agent/agent.json`, nahradit kontejner Agenta a
znovu se připojit bez dalšího tokenu. ID targetu a ID kontejneru workloadu musí
zůstat beze změny.

Poté vyzkoušejte automatický rollback pomocí tohoto záměrně nekompatibilního
image připnutého digestem. Použijte ověřený instalátor stažený již v kroku 1 a
stejnou URL control plane. Parametr `--allow-insecure-http` přidejte pouze pro
důvěryhodné nastavení LAN, které jej původně používalo.

```sh
sudo sh ./initpad-agent-install.sh \
  --url 'https://CONTROL_PLANE' \
  --image 'nginx@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa'
```

Příkaz musí selhat, protože náhradní kontejner nemůže odeslat heartbeat Agenta.
Instalátor musí tento kontejner odstranit, obnovit předchozího Agenta a ponechat
workload běžet:

```sh
sudo docker exec initpad-agent node /app/dist/cli.js version
sudo docker exec initpad-agent node /app/dist/cli.js once
sudo docker inspect "$workload_id" --format 'running={{.State.Running}}'
! sudo docker container inspect initpad-agent-previous >/dev/null 2>&1
```

Verze musí být stále přijatým releasem, heartbeat musí projít, workload musí
běžet a nesmí zůstat odstavený kontejner `initpad-agent-previous`.

Pro Agenta 0.14.3 nebo novějšího zpřístupněte stejnou disposable control plane
také přes druhou důvěryhodnou URL. Před opětovným spuštěním ověřeného instalátoru
s touto URL uložte checkpoint s důkazy:

```sh
sudo ./initpad-agent-host-acceptance.sh before-url-migration 0.14.3
# Znovu spusťte ověřený instalátor s parametrem --url nastaveným na druhou URL.
sudo ./initpad-agent-host-acceptance.sh \
  after-url-migration 0.14.3 'https://SECOND_CONTROL_PLANE_URL'
```

Instalátor musí vypsat ověřenou migraci URL a znovu se připojit bez enrollment
tokenu. Druhý příkaz prokáže, že se zachovalo ID targetu, generace credentialu,
image připnutý digestem i workloady, zatímco byl kontejner Agenta bezpečně
nahrazen.

Poté vytvořte nový checkpoint a znovu spusťte již ověřený instalátor s třetí,
záměrně nedostupnou URL. Z této URL nic nestahujte a nepoužívejte URL patřící
jiné databázi InitPadu:

```sh
sudo ./initpad-agent-host-acceptance.sh before-url-migration 0.14.3
if sudo sh ./initpad-agent-install.sh \
  --url 'https://UNREACHABLE_CONTROL_PLANE_URL' \
  --image 'AGENT_IMAGE_FROM_THE_VERIFIED_COMMAND'; then
  echo 'ERROR: unreachable URL was accepted' >&2
  exit 1
fi
sudo ./initpad-agent-host-acceptance.sh after-url-rollback 0.14.3
```

Ponechte všechny ostatní volby z ověřeného příkazu, včetně `--published-host`,
nastavení gateway a CA a `--allow-insecure-http`, pokud to test v důvěryhodné LAN
vyžaduje. Závěrečná kontrola prokáže, že neúspěšná migrace nezměnila uloženou
URL, kontejner, identitu ani workloady a že nezůstala žádná dočasná konfigurace
migrace. Změna instance InitPadu vyžaduje explicitní re-enrollment a není
migrací URL.

## 5. Skutečná aktualizace releasu

Skutečná aktualizace vyžaduje druhý podepsaný release s jiným immutable
digestem. Pro splnění tohoto checkpointu nepřesouvejte tag, neoznačujte znovu
starý image a nenahrazujte jej lokálně sestaveným image.

Po publikaci další verze Agenta nastavte její dvojici manifestu na control plane
a zkopírujte nově vygenerovaný instalační příkaz. Jeho spuštění na stejném hostu
musí zachovat identitu a workloady, ohlásit novou verzi a odstranit předchozí
kontejner Agenta až po prvním úspěšném novém heartbeatu.

Před zastavením starého kontejneru musí instalátor ověřit uloženou identitu
pomocí image kandidáta. Zrušený credential otestujte samostatně. Výchozí
aktualizace musí skončit bez změny kontejnerů i konfigurace a musí operátora
instruovat, aby vydal nový enrollment a použil `--re-enroll`. Tato explicitní
cesta musí uplatnit nový token, nahradit identitu a vrátit target do stavu
online. Je to důkaz obnovy, nikoli úspěšného upgradu se zachováním identity.

Agent 0.13 zavedl v kódu protokol vzdálené aktualizace, ale publikovaný image
0.13.0 i kandidát 0.14.0 vynechaly produkční závislost `sigstore`. Jsou na
úrovni runtime zrušeny a nesmějí sloužit jako funkční strana tohoto testu.
Selhání jejich preflightu kandidáta je platným důkazem odmítnutí, protože se
instalátor zastavil před nahrazením existujícího Agenta.

Opravený release 0.14.1 je veřejný, podepsaný a prošel runtime probe finálního
image i anonymním auditem distribuce. Release 0.14.2 je také veřejný, podepsaný,
ověřený runtime probe a anonymně auditovaný. Přijatý přechod zopakujete tak, že
na disposable targetu ponecháte nainstalovanou verzi 0.14.1, otevřete **Manage
Agent**, zkontrolujete verzi 0.14.2 a zvolíte **Install update**. Nepoužívejte
`--re-enroll`, protože zachování stejné identity targetu je součástí tohoto
testu. Potvrďte všechny následující body:

- jeden job `agent-update` projde ověřením podpisu, immutable pull, preflightem
  kandidáta a ověřením heartbeatu;
- target se krátce znovu připojí s novou verzí, zatímco aplikační workloady a ID
  jejich kontejnerů zůstanou beze změny;
- auditní log obsahuje události přijetí a ukončení aktualizace Agenta bez
  manifestu, credentialu nebo runtime logu;
- kandidát, který nemůže odeslat heartbeat, vyvolá `agent_update_rolled_back`,
  stará verze se vrátí do stavu online a nezůstane kontejner
  `initpad-agent-previous`;
- druhý target se aktualizuje až poté, co první target projde **Test protocol**
  a **Test Docker**. Nedojde k automatickému nasazení na celou flotilu.

Pro získání reprodukovatelného důkazu použijte podepsaný pomocný skript hostu.
Nejprve spusťte `before-update 0.14.1`. Pro průchod s rollbackem spusťte
`inject-failure` ve druhém terminálu před volbou **Install update** a poté
ověřte neúspěšnou operaci příkazem `after-rollback 0.14.1`. Injektor chyby čeká
na jiný běžící kontejner `initpad-agent` a pozastaví pouze tento náhradní
kontejner. Nemění release, identitu, control plane ani aplikační workload.
Zopakujte `before-update 0.14.1`, nainstalujte aktualizaci bez injekce chyby a
dokončete příkazem `after-update 0.14.2`.

## Výsledek acceptance

Sekce 1 až 4 a skutečný přechod `0.14.1 → 0.14.2` v sekci 5 prošly na
samostatných Linux hostech do 21. září 2026. Náhradní kontejner s vloženou chybou
selhal bezpečně a obnovil verzi 0.14.1. Následná čistá aktualizace zachovala
identitu targetu i aplikační workloady a připojila se jako 0.14.2. Releasy 0.13.0
a 0.14.0 zůstávají zdokumentovanými odmítnutími na úrovni runtime, nikoli
přijatými základy. Jakákoli budoucí ruční oprava, nový enrollment, ztracený
workload nebo mutable reference na image je selhání a musí být zdokumentována,
ne obejita.

Agent 0.14.3 následně prošel rozšířeným gate životního cyklu na samostatném
Linux hostu dne 1. října 2026. Skutečný restart hostu zachoval stejné ID
kontejneru Agenta, identitu targetu i ID managed workloadů. Zkontrolovaný
instalátor poté přesunul existující identitu na dostupnou druhou URL control
plane, nedostupná URL byla odmítnuta a předchozí URL i workloady zůstaly beze
změny. Agent se bez re-enrollmentu vrátil na původní URL.
