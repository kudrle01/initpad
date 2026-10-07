# Acceptance veřejného SaaS stagingu

Tento postup je určen pro disposable staging nasazení veřejného SaaS. Ověřuje
samostatný profil `api + web` proti externímu PostgreSQL, privátnímu
S3-compatible úložišti, projektovaným souborům se secrety a skutečnému
veřejnému HTTPS edge. Nemění lokální self-hosted instalaci na SaaS a nesmí se
používat jako první test obnovy na produkčních datech.

## Předpoklady

- Nasaďte `saas.compose.yml` s immutable release images.
- Každou hodnotu ze správce secretů promítněte do cesty nastavené odpovídající
  položkou `*_FILE` v env souboru nasazení.
- Udržujte bucket privátní. Přihlašovací údaje potřebují stejné operace
  Head/Get/Put/Delete jako životní cyklus artefaktů InitPadu.
- Nastavte důvěryhodný veřejný HTTPS origin a spusťte `api` i `web` za
  zamýšleným edge proxy.
- Dodržte jedinou podporovanou proxy cestu `klient -> veřejný edge/WAF -> web
  proxy -> API` s `INITPAD_TRUST_PROXY_HOPS=2`. Edge musí zahodit klientské
  `Forwarded` a `X-Forwarded-*` hlavičky a vytvořit vlastní řetězec z adresy
  spojení. Port webu zůstává svázaný s `127.0.0.1`, aby edge nešlo obejít.
- Udržujte staging control plane v klidu po dobu základního load příkazu. Nesmí
  probíhat žádné provisioning, nasazení, povýšení, rollback ani změna targetu.
  Ingesce artefaktů a operace deploy, start, stop a remove už mají databázový
  execution fencing, ale živý důkaz jejich souběžných mutací zůstává samostatným
  stagingovým gate.
- Připravte nativní postupy zálohy a obnovy poskytovatele pro celou databázi
  PostgreSQL InitPadu a kompletní bucket s artefakty.

Pomocný skript nikdy nenačítá env soubor příkazem `source`. Soubory se secrety se
připojují pouze pro čtení a načítají se jen uvnitř krátkodobého kontejneru sondy
API. Výstup obsahuje omezený stav, počet migrací a typ výsledku, nikdy
přihlašovací údaje, endpointy, presigned URL ani těla objektů.

## Kontrola závislostí a veřejného edge

Spusťte z adresáře `deploy/` na hostu staging control plane:

```bash
./saas-acceptance.sh dependencies /secure/runtime/initpad-saas.env
```

Příkaz vyžaduje zdravé dlouho běžící kontejnery API a webu, ověří skutečný
veřejný endpoint `/api/health/ready` přes důvěryhodné HTTPS, přečte stav migrací
Prisma a provede round-trip S3: zápis, čtení, kontrolu hashe a smazání.

## GitHub App a ruční E2E instalace

Tento gate je ruční. Vyžaduje skutečnou GitHub App, osobní účet a testovací
organizaci, proto jej pomocný skript nespouští. Unit testy pokrývají tombstone
po odinstalaci, odmítnutí tokenu pozastavené instalace a přejmenování účtu i
repozitáře podle neměnného ID; živý průchod nenahrazují.

### Registrace App pro staging

Zaregistrujte samostatnou GitHub App pouze pro staging origin a nesdílejte ji s
jiným prostředím:

| Pole formuláře                                         | Hodnota                                          |
| ------------------------------------------------------ | ------------------------------------------------ |
| Homepage URL                                           | `https://<origin>`                               |
| Callback URL                                           | `https://<origin>/api/auth/github/callback`      |
| Expire user authorization tokens                       | zapnuto                                          |
| Request user authorization (OAuth) during installation | vypnuto, jinak GitHub nepoužije Setup URL        |
| Setup URL                                              | `https://<origin>/api/scm/github/setup/callback` |
| Webhook                                                | aktivní, `https://<origin>/api/scm/github/webhook` |
| Webhook secret                                         | náhodná hodnota uložená ve správci secretů       |
| Where can this GitHub App be installed                 | Any account                                      |

Repository permissions odpovídají tokenům, které si API vyžádá pro jednotlivé
operace:

| Oprávnění       | Úroveň         | Použití                                         |
| --------------- | -------------- | ----------------------------------------------- |
| Actions         | Read and write | běhy, artefakty a opakování neúspěšných jobů    |
| Administration  | Read and write | založení a smazání repozitáře, spolupracovníci  |
| Checks          | Read-only      | stav Check Runs                                 |
| Commit statuses | Read-only      | klasické commit statusy                         |
| Contents        | Read and write | scaffold, archiv revize a značky opakování      |
| Metadata        | Read-only      | povinné pro každou App                          |
| Packages        | Read and write | úklid balíčků odstraněného projektu             |
| Secrets         | Read and write | Actions secrets projektu                        |
| Workflows       | Read and write | zápis `.github/workflows`                       |

Z account permissions nastavte pouze `Email addresses: Read-only`, aby
přihlášení mohlo převzít ověřený e-mail. Organization permissions nejsou
potřeba. Žádnou událost neodebírejte: `installation`, `installation_target` a
`github_app_authorization` doručuje GitHub každé App automaticky.

App ID, Client ID a slug patří do env souboru nasazení. Client secret, privátní
klíč a webhook secret promítněte jako soubory podle položek `*_FILE`.

### Průchod

Proveďte kroky s osobní instalací i s instalací v testovací organizaci:

1. **Login.** `Continue with GitHub` vytvoří nebo otevře účet. SaaS nenabízí
   heslo ani registraci a účet má ověřený e-mail.
2. **Instalace.** Owner nebo admin workspace spustí instalaci z nastavení účtu.
   Osobní instalace se přijme jen pro účet shodný s propojenou identitou,
   organizační projde potvrzením přes GitHub. Instalaci vidí pouze workspace,
   který ji autorizoval, a member ji autorizovat nemůže.
3. **Create.** Nový projekt v osobním účtu i v organizaci založí soukromý
   repozitář s workflow a Actions secrets; první běh je zelený.
4. **Import.** Existující repozitář s Dockerfile a InitPad workflow projde
   preflightem a importem beze změny kódu.
5. **Artefakt.** Běh Actions vytvoří artefakt a historie nasazení uvádí jeho
   digest u odpovídajícího SHA commitu.
6. **Nasazení Agentem.** Prostředí `dev` se nasadí na Agent target a má zdravou
   URL. Povýšení použije stejný digest.
7. **Rename.** Přejmenujte repozitář a poté testovací organizaci, nikoli účet,
   který potřebujete zachovat. Existující projekt dál načítá commity a jde
   znovu nasadit, nový projekt v přejmenované organizaci jde založit a UI
   ukazuje nové názvy.
8. **Suspend.** Pozastavte instalaci v GitHubu. UI ji označí za pozastavenou,
   create, import a operace vyžadující token selžou fail-closed a běžící
   workloady zůstanou. Po obnovení instalace operace znovu projdou.
9. **Uninstall.** Odinstalujte App. Instalace zmizí z nabídky workspace, další
   operace nad repozitářem selžou fail-closed a záznam projektu i audit
   zůstanou zachované.
10. **Audit.** U projektových a deployment operací ověřte v auditním logu
    aktéra a výsledek. Změny instalace přicházejí podepsaným webhookem a
    workspace audit je nezaznamenává; doložte je stavem v UI a seznamem
    doručení webhooku v nastavení App.

Do záznamu uveďte datum, verzi releasu, typ instalace a výsledek každého kroku.
Nepřikládejte tokeny, názvy soukromých repozitářů ani identifikátory účtů.

## Omezená load kontrola veřejného edge

Kontrola měří autentizované čtecí cesty přes skutečné HTTPS edge a prokazuje, že
odpověděly alespoň dva různé procesy API. Základní příkaz záměrně běží bez
souběžného provozu a sám o sobě neprokazuje souběžné mutace.

Nejprve v UI ověřte, že neprobíhá žádná operace projektu. Poté škálujte API a
znovu vytvořte web edge, aby rozlišení jeho upstreamu zahrnovalo obě repliky:

```bash
docker compose --env-file /secure/runtime/initpad-saas.env \
  -f saas.compose.yml up -d --scale api=2 api
docker compose --env-file /secure/runtime/initpad-saas.env \
  -f saas.compose.yml up -d --force-recreate web

./saas-acceptance.sh load /secure/runtime/initpad-saas.env
```

Sonda vytvoří a odstraní izolovaný fixture účtu a workspace. Odmítne běžet,
dokud probíhá provisioning nebo nasazení, a vyžaduje alespoň 300 dokončených
požadavků, dvě odpovídající ID procesů API, nejvýše 1 % chyb a latenci p95
nejvýše 1000 ms. Omezené výchozí hodnoty lze pro zkontrolovaný plán kapacity
stagingu upravit pomocí:

- `INITPAD_LOAD_ACCEPTANCE_DURATION_SECONDS`
- `INITPAD_LOAD_ACCEPTANCE_CONCURRENCY`
- `INITPAD_LOAD_ACCEPTANCE_URL`, pouze pokud se testovaný edge liší od
  nakonfigurovaného veřejného originu
- `INITPAD_LOAD_ACCEPTANCE_MIN_REQUESTS`
- `INITPAD_LOAD_ACCEPTANCE_MIN_INSTANCES`
- `INITPAD_LOAD_ACCEPTANCE_MAX_P95_MS`
- `INITPAD_LOAD_ACCEPTANCE_MAX_ERROR_RATE`

Nenechávejte více než jednu veřejnou repliku API obsluhovat produkční provoz s
mutacemi, dokud na této topologii neprojdou živé gate mutací a obnovy.

## Restart repliky API pod zátěží

Po úspěšném základním load příkazu vyvolejte jeden řízený restart API, zatímco
běží stejná omezená sonda:

```bash
INITPAD_SAAS_ACCEPTANCE=1 \
  ./saas-acceptance.sh load-failover /secure/runtime/initpad-saas.env
```

Příkaz spustí sondu, počká na její explicitní startovací značku, restartuje
jeden z alespoň dvou zdravých kontejnerů API, počká, až se tato replika znovu
stane zdravou, a znovu spustí veřejnou readiness kontrolu. Původní prahy objemu
požadavků, p95, chybovosti a počtu instancí platí dál. Výstup ani lokální report
neobsahují ID kontejneru, URL, účet ani secret.

Příkaz záměrně vyžaduje destruktivní opt-in stagingu. Úspěch prokazuje
dostupnost edge během restartu jednoho procesu API. **Neprokazuje**, že
rozpracovaná mutace bezpečně přečkala selhání procesu. Pro deployment použijte
následující cvičení předání Agentovi. Failover ingesce artefaktů z GitHubu
zůstává samostatným živým gate. Dokud nejsou oba zaznamenány, ponechte veřejný
provoz s mutacemi na jedné replice.

## Trvalé předání Agentovi při restartu API

Použijte existující disposable projekt na GitHubu, jehož prostředí `dev` nebo
`test` běží na zaregistrovaném Agentovi workspace a má ověřený build artefakt v
object store. Cvičení záměrně znovu nasadí toto skutečné prostředí. Vytvoří
pouze dočasnou identitu vlastníka a ukládá neprůhledná UUID do lokálního
checkpointu s režimem 0600. Nekopíruje na disk žádný token ani secret.

1. Zastavte disposable target Agenta. Počkejte, až InitPad ohlásí jeho stav
   offline, což trvá alespoň 90 sekund, a ověřte, že target nemá ve frontě žádný
   další job.
2. Zařaďte jedno opětovné nasazení a restartujte přesně tu repliku API, která
   jej přijala:

   ```bash
   export INITPAD_MUTATION_ACCEPTANCE_PROJECT_ID='00000000-0000-4000-8000-000000000000'
   export INITPAD_MUTATION_ACCEPTANCE_ENVIRONMENT=dev

   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh agent-failover-before /secure/runtime/initpad-saas.env
   ```

   Nahraďte UUID skutečným ID disposable projektu. Příkaz odmítne `prod`,
   vyžaduje alespoň dvě zdravé lokální repliky API v Compose, prokáže, že ve
   frontě je právě jeden trvalý deploy job, přiřadí neprůhlednou identitu
   instance z odpovědi k jedné replice a restartuje pouze tuto repliku.
3. Spusťte stejného Agenta a počkejte na jeho heartbeat. Poté ověřte obnovu:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh agent-failover-after /secure/runtime/initpad-saas.env
   ```

Druhý příkaz přijme pouze uložený projekt, prostředí a operaci. Vyžaduje jednu
úspěšnou koncovou operaci a jednu auditní událost, žádnou duplicitní operaci,
žádný živý zámek prostředí ani lease Agenta a přesně požadovaný artefakt a
verzi. Nasazení přes managed gateway musí dokončit kroky deploy a route vždy
jednou.

Pokud je cvičení přerušeno, ponechte operaci projektu pro diagnostiku a
odstraňte pouze dočasnou identitu a checkpoint příkazem:

```bash
INITPAD_SAAS_ACCEPTANCE=1 \
  ./saas-acceptance.sh agent-failover-cleanup /secure/runtime/initpad-saas.env
```

Tím se prokazuje trvalé předání Agentovi napříč selháním procesu control plane,
který požadavek přijal. Neověřuje stahování a nahrávání artefaktů z GitHubu
vázané na proces. To vyžaduje vlastní živou acceptance se dvěma replikami, než
se schválí active-active mutace.

## Cvičení výpadku SMTP a opakovaného odeslání

Použijte nepoužívanou stagingovou schránku nebo alias. Cvičení ukládá do
lokálního checkpointu pouze neprůhledné UUID. Příjemce ani přihlašovací údaje se
do reportu nezapisují.

1. Zablokujte odchozí SMTP pro každou repliku API na firewallu poskytovatele
   nebo v egress politice stagingu. Nestačí zastavit jedinou repliku.
2. Prokažte, že API zůstává ready a řádek zašifrovaného outboxu se stane
   opakovaným pokusem místo ztráty:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
   INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT=unused-staging-alias@example.org \
     ./saas-acceptance.sh smtp-outage-before /secure/runtime/initpad-saas.env
   ```

3. Obnovte SMTP egress pro každou repliku a prokažte, že opakovaný pokus byl
   doručen a jeho zašifrovaný payload vymazán:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
   INITPAD_SMTP_OUTAGE_ACCEPTANCE_RECIPIENT=unused-staging-alias@example.org \
     ./saas-acceptance.sh smtp-outage-after /secure/runtime/initpad-saas.env
   ```

Pokud je cvičení přerušeno, nejprve obnovte SMTP a poté odstraňte jeho izolovaný
fixture příkazem `smtp-outage-cleanup`. Úspěšný příkaz připojí omezený důkaz do
`.runtime/saas-acceptance/results.tsv`.

## Cvičení externí zálohy a obnovy

Cvičení přidá izolované markery do schématu PostgreSQL `initpad_acceptance` a pod
prefix bucketu `acceptance/recovery/`. Úspěšné ověření odstraní oba markery i
dočasné schéma. Neúspěšné ověření je ponechá pro diagnostiku.

1. Vytvořte základní markery:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh before-backup /secure/runtime/initpad-saas.env
   ```

2. Zálohujte obě externí služby zkontrolovaným postupem poskytovatele.
   Checkpointy databáze a bucketu se musí pořídit po kroku 1 a před krokem 3.

3. Vytvořte markery po záloze:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh after-backup /secure/runtime/initpad-saas.env
   ```

4. Obnovte PostgreSQL a bucket s artefakty ze záloh vytvořených v kroku 2.
   Restartujte control plane a počkejte, až API i web budou zdravé.

5. Prokažte, že se obě služby vrátily ke stejnému časovému bodu:

   ```bash
   INITPAD_SAAS_ACCEPTANCE=1 \
     ./saas-acceptance.sh after-restore /secure/runtime/initpad-saas.env
   ```

Poslední příkaz uspěje pouze tehdy, když v PostgreSQL i S3 existují oba základní
markery a oba markery po záloze chybějí. Důkaz se připojuje do
`.runtime/saas-acceptance/results.tsv`. Jde o lokální runtime data a nesmí se
commitovat.

Úspěch tohoto pomocného skriptu prokazuje pouze příkazy, které byly skutečně
spuštěny proti nakonfigurovanému stagingovému nasazení. GitHub OAuth/App,
nasazení Agenta, izolace tenantů, WAF/egress, observability a obnova
rozpracovaných mutací zůstávají samostatnými gate.
