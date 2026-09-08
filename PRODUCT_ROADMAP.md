# InitPad — produktová a implementační roadmapa

## Cílový produkt

InitPad bude mít jeden kód a dva podporované provozní režimy:

| Režim | Control plane | Workloady | Použití |
|---|---|---|---|
| Self-contained | u uživatele, včetně Gitey a CI | lokální simulovaná infrastruktura | diplomkové demo, offline laboratoř, malý tým |
| Public SaaS | veřejný InitPad + GitHub | školní nebo uživatelské servery | školy, týmy a BYOS malé firmy |

Veřejný režim není hosting aplikací. InitPad hostuje řízení, identity, metadata a
deployment workflow; aplikace běží na targetech školy nebo uživatele. Studenti
nemusejí kupovat VPS — učitel jim může přidělit kapacitu ze školního target
poolu. Self-contained profil používá vestavěnou Giteu; veřejný SaaS používá
GitHub jako SCM/CI. Veřejná Gitea není podporovaná SaaS varianta.
Detailní rozhodnutí jsou v ADR-027 a ADR-030.

## Hlavní hodnota

InitPad není obecný serverový panel. Je to opinionated developer platform:

- nový projekt ze zkontrolované golden-path šablony nebo import existujícího repa;
- týmové vlastnictví, workspaces, přidávání existujících účtů a role;
- automatický build/test a dohledatelný artefakt;
- řízený tok dev → test → prod nad heterogenní infrastrukturou;
- přidělení prostředí bez předání serverových credentials studentům;
- stejný produkt pro školní infrastrukturu i server přinesený uživatelem.

## Povinné MVP pro diplomovou práci

MVP je hotové, když lze na jedné veřejně dostupné instalaci prokázat tento tok:

1. správce nebo owner založí týmový workspace a publikuje target pool;
2. uživatelé se přihlásí přes GitHub v SaaS nebo dostanou self-hosted účet;
   owner je následně přidá do týmového workspace;
3. tým vytvoří projekt ze šablony nebo importuje repo na SCM provideru dané edice;
4. CI postaví a otestuje jediný verzovaný artefakt;
5. dev se automaticky nasadí na školní Docker target přes agenta;
6. stejný artefakt se povýší do testu;
7. prod vyžádá schválení maintainera a nasadí se na oddělenou ESO cestu;
8. platforma zobrazí stav, log, vlastníka, audit událostí a identitu artefaktu.

### Vědomě mimo MVP

- billing a komerční subscription management;
- Kubernetes provider a multi-region orchestrace;
- plně spravovaný build cloud a autoscaling runnerů;
- marketplace šablon a automatické upgrady vytvořených projektů;
- SAML/SCIM, enterprise HA a garantované SLA;
- vlastní globální tunnel/proxy síť pro veřejné URL lokálních notebooků.

Tyto body patří do návrhu a diskuze, ne do implementačního slibu diplomky.

## Topologie prostředí ve škole

| Prostředí | Výchozí target | Alternativa | Omezení |
|---|---|---|---|
| Lokální práce | notebook + vygenerovaný dev setup | lokální InitPad Agent | není stabilní sdílená služba |
| Sdílené dev | školní Docker pool přes agenta | vlastní Docker server | všechny kontejnerové šablony |
| Test | ESO pro PHP/statiku; školní Docker/VM pro ostatní | vlastní server | musí odpovídat runtime capabilities |
| Prod | oddělená ESO allocation nebo školní server | vlastní server | ruční approval, oddělené secrets a cesta |

Jeden fyzický ESO server může nést více logických allocations. Každá kombinace
tým/projekt/prostředí má vlastní cestu, URL, kvótu a audit. Node a Python aplikace
se na čistý SFTP hosting nenabízejí; target matching to odmítne před deployem.

## Implementační fáze

### Fáze 0 — bezpečný baseline — dokončeno

- Audit autentizace, CI, webhooků, deploymentů, šablon a infrastruktury.
- Izolovaný rootless DinD runner, versionované migrace a backup postup.
- Dvanáct testovaných šablon včetně Laravel/Nette/Symfony.
- Produkční build, API testy, dependency audit a browser E2E.
- Výchozí stav uložen v tematických commitech před změnou tenancy modelu.

### Fáze 1 — tenancy: workspaces a role — dokončeno

**Datový model**

- `Workspace` typu personal/team.
- `WorkspaceMember` s rolemi owner/admin/maintainer/member/viewer.
- Projekt a uživatelský target vlastní workspace, ne přímo uživatel.
- Bezpečná migrace: každý současný uživatel dostane osobní workspace a jeho
  projekty/targety se do něj převedou bez změny repozitářů a deploymentů.

**API a bezpečnost**

- Centrální authorization policy pro read/write/admin místo `assertOwner`.
- Každý list/detail/activity dotaz musí být workspace-scoped.
- Negativní testy, že člen jednoho workspace nevidí data jiného.

**UI**

- Přepínač aktivního workspace.
- Správa členů a rolí.
- Viditelné označení osobního a týmového projektu.

### Fáze 2 — identity a workspace onboarding — dokončeno

- Jediný organizační model tvoří workspaces a role; žádný zvláštní `Course` login.
- Public SaaS vytváří účet při prvním přihlášení přes GitHub; vlastní heslo ani
  vestavěnou Giteu nenabízí.
- Workspace owner/admin přidává existující účet podle username/e-mailu a přidělí roli.
- Self-hosted správce volí `open` nebo `admin-provisioned`, spravuje uživatele a
  vydává aktivační odkaz nebo jednorázové dočasné přihlašovací údaje s vynucenou
  změnou hesla.
- Ochrana proti automatizovanému zneužití, ověření e-mailu a bezpečný reset hesla.

Implementováno (ADR-040, zjednodušeno v ADR-042): self-hosted registrační politika
se dvěma režimy (`open` / `admin-provisioned`) s bezpečným
first-user bootstrapem; stavové session s generací tokenu (deaktivace i reset
zneplatní staré session); platform-admin API a UI pro seznam/vytvoření/
deaktivaci/reset uživatelů s jednorázovým dočasným heslem NEBO aktivačním
odkazem (uživatel si nastaví vlastní heslo a je přihlášen); přidávání do týmu
jen pro existující účty podle username/e-mailu; ověření e-mailu a neenumerující
reset hesla. GitHub login/link a bezpečná vazba GitHub App jsou implementované
ve Fázi 3; produkční SaaS profil stále čeká na Agenta a živý E2E test.

Produkční odesílání e-mailů zatím není implementované: aktivační/verifikační
odkazy se v self-hosted prototypu zobrazují nebo logují. To je vhodné pro demo a
administrátorem řízenou instalaci, ne důkaz vlastnictví e-mailu ve veřejném SaaS;
SaaS proto přijímá pouze e-mail ověřený GitHubem a neověřený profilový e-mail
neukládá. SMTP/e-mail provider je samostatný krok před veřejným provozem.

### Fáze 3 — existující repozitáře a cloudové SCM — rozpracováno

**Hotovo a lokálně ověřeno**

- `ScmProvider` odděluje projektovou doménu od konkrétního SCM; všechny
  repository operace přijímají kanonický `ScmRepositoryRef`. Gitea zůstává
  aktivním adapterem self-contained edice.
- Import osobního Gitea repozitáře umí seznam, preflight, vytvoření projektu bez
  přepsání zdrojového kódu, per-repo CI secret a prázdná prostředí. Výběr
  i serverové dohledání používají immutable provider repository ID.
- `Project` má explicitní provider/repository ID/owner/name/full name/default
  branch/installation binding. Migrovaným Gitea projektům startup doplní reálné
  ID a podle něj synchronizuje mutable souřadnice; URL už není zdroj identity.
- `ProvisioningOperation` eviduje výsledek create/import. Import má dílčí kroky;
  create zatím eviduje pouze začátek a konečný stav, takže nejde o úplnou
  transakční orchestraci ani spolehlivý rollback všech externích efektů.
- GitHub OAuth login/link používá neměnné provider user ID, chráněný state+nonce
  a pouze ověřený GitHub e-mail označí jako ověřený. SaaS nemá password login ani
  registraci, první GitHub uživatel nedostane automaticky platform-admin roli a
  účet nemůže odpojit svůj poslední použitelný způsob přihlášení.
- Podepsané installation webhooky ukládají stav instalace a při chybě persistence
  vracejí 5xx, aby mohl GitHub událost zopakovat. Installation tokeny jsou
  krátkodobé a každá operace žádá jen potřebnou podmnožinu oprávnění.
- GitHub instalace ukládá immutable account ID a odděluje osobní/
  organizační účet. Jednorázový setup callback ověřuje instalaci přes App API
  a vytváří explicitní user/workspace grant; webhook sám oprávnění neuděluje.
  Rename mění jen display login a uninstall záznam historizuje. Osobní
  instalaci lze po chybějícím Setup callbacku obnovit jen s platným pending
  stavem a přesnou shodou immutable GitHub user ID; organizace tento fallback
  z bezpečnostních důvodů nepoužívá. Organizační callback místo toho provede
  user-bound OAuth kontrolu `/user/installations`; krátkodobý token se neukládá.
- `GitHubScmProvider` má čtecí i repository provision operace a projektová
  doména je vybírá přes `ScmRegistry` podle edice/uloženého provideru. Adapter
  umí stránkování, přesný archiv,
  personal/org create, bezpečný scaffold push a legacy user/org GHCR cleanup a
  sealed-box Actions secrets přes `libsodium-wrappers`. Sdílený workflow se pro
  GitHub převede na `.github/workflows`; nový tok odevzdá otestovanou image jako
  immutable Actions artifact místo ukládání uživatelského PAT pro GHCR.
  New project v SaaS nabízí pouze aktivní instalace autorizované pro workspace;
  self-hosted tok žádný provider switch nemá a zůstává na Gitea.
  Osobní destinaci může použít jen vlastník stejného immutable GitHub účtu;
  organizační grant je sdílený členům workspace podle RBAC.
- GitHub App user-token vault bezpečně ukládá odděleně šifrovaný access a
  refresh token, rotuje jednorázový refresh pair pod databázovým lease a maže jej
  při unlink/revocation. OAuth login/link credential obnoví; organization setup
  jej záměrně nepersistuje.

**Následující podkroky v závazném pořadí**

1. ✅ Rozšířit projekt o explicitní identitu SCM: provider, neměnné repository ID,
   owner/full name, default branch a vazbu na instalaci. Stejné souřadnice použít
   v importu, CI callbacku, reconcile, mazání, archive i registry názvech.
2. ✅ U GitHub instalace uložit neměnné account ID, bezpečně obsloužit rename a
   rozlišit osobní účet/organizaci. Doplnit setup callback a vazbu instalace na
   přihlášeného uživatele/workspace; samotný globální webhook tuto autorizaci
   nenahrazuje. Organizace je navíc ověřena krátkodobým user access tokenem proti
   `/user/installations`.
3. ✅ Dokončit GitHub `provision` a push scaffoldu. Osobní create používá
   rotovatelný user token, organizace operation-scoped installation token;
   secrets vzniknou před pushem a chyba provede kompenzační delete.
4. ◐ Create/import, CI callback, reconcile, commity/statusy, retry tag, archiv,
   členství a delete/detach jsou napojené přes `ScmRegistry`. Server znovu
   ověřuje workspace grant instalace a import vyžaduje Dockerfile (mimo static)
   i provider-specific InitPad workflow. Write-ahead effect journal nyní eviduje
   repository/project/secrets/collaborator zásahy; import při chybě v opačném
   pořadí odstraní InitPad secrets, obnoví původní přímé role a projekt smaže
   jen po úplné kompenzaci. Lease recovery, workspace přehled, CAS cleanup a
   omezený idempotentní retry jsou dokončeny. Ověřený GitHub Actions artifact
  handoff, durable S3-compatible object storage, rehydratace a retention jsou
  také hotové; zbývá agent transport a reálný deploy profil pro veřejný SaaS.
5. Potom dokončit migrace v cílových prostředích, živý GitHub App E2E a browser
   acceptance: login, instalace pro vybrané repo, create/import, CI, odebrání
   instalace, rename ownera a dvě repa se stejným názvem.

GitLab je vědomě až další adapter. Template manifest jako verzovaný blueprint
contract a firemní blueprint repozitáře zůstávají následným rozšířením.

### Fáze 4 — target pool a allocations — ✅ dokončeno (ADR-060)

- Fyzický `Target` spravuje škola, firma nebo uživatel.
- `TargetAllocation` přiděluje omezený výsek targetu workspace/týmu a prostředí.
- Allocation nese capabilities, root path/namespace, public URL, kvótu a policy.
- Učitel může pool publikovat, přidělovat a odebírat bez odhalení credentials.
- ESO test/prod používají oddělené cesty a konfigurace na stejném fyzickém hostu.

**Stav (ADR-060):** model + aditivní migrace, idempotentní legacy backfill,
providerové routování root/URL, workspace-scoped Docker síť i jméno kontejneru,
CRUD API, role/cross-tenant 404 a policy při
create/import, změně targetu i deploy — implementováno a automaticky testováno.
Nové built-in allocations dostávají workspace prefix; legacy URL a ESO cesty
zůstanou beze změny. Živý test na VM prokázal dva workspaces s oddělenými
namespace, souběžné workloady i bezpečné delete/recreate bez kolize. Durable
object storage je hotové (ADR-059). Fronta jedním runnerem má explicitní `awaiting CI`
stav, první job hlásí skutečné převzetí callbackem a počet souběžných slotů
je provozně konfigurovatelný (ADR-064). SCM údržba u listu/detailu je mimo
synchronní read path, polling stahuje průběžně jen hlavičku historie a celý
vnořený CI prostor má souhrnný CPU/RAM/PID limit (ADR-065); živý dvouprojektový
gate prošel bez blokování navigace.

Infrastructure UI podle ADR-080 skládá technický model do jednoho hierarchického
seznamu: každý deployment server se zobrazí právě jednou a uvnitř nese
`Workspace access` s namespace, kvótou, runtime policy a použitými prostředími.
Při přidání workspace-owned serveru vznikne jeho výchozí access atomicky;
samostatné enable slouží hlavně pro sdílený built-in server nebo po dřívějším
odebrání přístupu. Připravenost Agenta/gateway je deployment podmínka, nikoli
podmínka pro předběžnou konfiguraci access policy.

**Uživatelské ověření Fáze 4 (TargetAllocation):** dva workspace nasadí na stejný
built-in target — každý má vlastní namespace, běží současně bez kolize a na cizí
allocation nevidí (404). Owner vytvoří/zakáže allocation, member v ní nasadí,
viewer jen čte; zakázaná allocation odmítne nový deploy, ale běžící nezruší;
překročení kvóty je odmítnuto s jasnou zprávou. Migrace zachová URL a ESO cesty
existujících projektů. Neověřovat jen existencí DB řádku — prokázat reálný deploy
a izolaci mezi workspace. Reprodukovatelný postup je v
[`deploy/SELF_HOSTED_ACCEPTANCE.md`](deploy/SELF_HOSTED_ACCEPTANCE.md).

### Fáze 4.5 — quality checkpoint před Agentem — ✅ dokončeno

Agent přidá novou bezpečnostní hranici, durable job protokol a další obrazovky.
Před jeho implementací proto proběhne omezený stabilizační milník; nejde o
přepis fungujícího produktu.

1. ✅ **Dokumentace a repository hygiene.** README je uživatelský vstupní bod;
   roadmapa popisuje budoucí práci, ADR rozhodnutí, runbook provoz a acceptance
   ověření. Osobní vysvětlení a handoffy zůstávají lokální. Dokončené
   migrační deníky, mrtvé soubory a zastaralé duplicity se odstraní.
2. ✅ **Charakterizační testy a modulární backend.** Nejdřív se uzamkne chování
   kritických toků. Potom se `ProjectsService` rozdělí podle odpovědností na
   provisioning, CI/artifact orchestration, environment lifecycle a read model.
   GitHub/Gitea adaptery oddělí HTTP klienta od doménových operací. Veřejné API
   a databázové chování se v tomto kroku nemění.
3. ✅ **Frontendová struktura.** Velké stránky (`Settings`, `ProjectDetail`,
   `Infrastructure`) se rozdělí na pojmenované sekce a hooks; formulářové,
   loading/error a permission stavy dostanou jednotné komponenty. Odstraní se
   duplicity bez zavádění abstrakcí použitých jen jednou.
4. ✅ **UX/UI pass A.** Nad stabilní strukturou se otestují hlavní úkoly na
   telefonu, tabletu a desktopu: navigace, založení/import projektu, detail,
   target a workspace správa. Opraví se informační hierarchie, touch targets,
   formuláře, focus/keyboard chování, loading/empty/error stavy a kontrast.
   Vizuální identita zůstane střídmá a produktová, ne dekorativní redesign.
5. ✅ **Živý gate.** Produkční build, API a template testy, dependency audit,
   self-hosted smoke test, kontrola mrtvého kódu a browser acceptance musí být
   zelené. Otestována byla izolace dvou workspaceů, role a kvóty, podporované
   šablony, CI fronta, restart, backup/restore a delete/recreate bez kolize.

Po Agent MVP proběhne bezpečnostní audit jeho enrollmentu, identity, lease a
idempotence a **UX/UI pass B** pro nové agent/target obrazovky. Poslední audit
před odevzdáním diplomové práce pokryje celou regresi, accessibility,
závislosti, dokumentaci, failure injection a reprodukovatelnost evaluace.

**Uživatelské ověření:** stejný uživatel dokončí založení projektu, kontrolu
CI, změnu dev targetu a přidání člena workspace na šířkách 390, 768 a
1440 px. Nesmí vzniknout horizontální scroll, skrytá primární akce ani krok
vyžadující hover; klávesnicí musí zůstat viditelný focus a po reloadu se
nezobrazí falešný empty/error stav.

### Fáze 5 — InitPad Agent

1. ✅ **Trust bootstrap v control plane.** Agent má identitu 1:1 s fyzickým
   Docker targetem. Owner/admin vydá patnáctiminutový jednorázový enrollment;
   token i následný credential jsou v databázi pouze hashované. Redeem je
   compare-and-set a deaktivace credential zneplatní bez smazání targetu.
2. ✅ **Agent target a instalační UX.** Uživatel založí workspace-owned Docker
   target bez SSH hesla, dostane kopírovatelný instalační příkaz a v UI vidí
   stav `not enrolled / offline / online / disabled`, verzi a poslední kontakt.
3. ✅ **Spustitelný Agent a heartbeat.** Samostatný malý proces bezpečně uloží
   credential na targetu, provede enrollment a pouze odchozím HTTPS hlásí
   verzi, protocol version, Docker capabilities a omezenou telemetrii.
4. ✅ **Durable job a lease protokol.** Control plane vytváří target-scoped joby;
   agent je atomicky pronajímá, obnovuje lease a reportuje strukturovaný progress.
   Expirace nebo duplicitní doručení nesmí vytvořit druhý workload.
5. ✅ **Docker lifecycle operace.** Agent implementuje verzované deploy, stop,
   start, remove, status, health, omezené logy a rollback bez obecného shellu.
   Image přebírá podle ověřené identity/digestu a vynucuje allocation.
6. ✅ **Napojení delivery toku.** Agent-backed target použije stejné projektové
   akce jako dnešní Docker provider; SaaS nepotřebuje Docker socket control plane.
   Přímá self-hosted cesta zůstane kompatibilní pro diplomkový profil.
   Deploy/start/stop/remove nyní tvoří `AgentJob`, stahují ověřený artifact
   job-scoped streamem, promítají progress i výsledek zpět do projektu a picker
   zpřístupní jen enrolled Agent 0.4+ s durable artifact store.
7. ✅ **Živý a bezpečnostní gate.** Otestuje se instalace, revoke/re-enroll,
   offline/reconnect, ztracená odpověď, lease expiry, duplicitní job a izolace
   dvou workspaces; následuje audit enrollmentu a idempotence.
8. ✅ **Produkční gateway routing.** Po uzavření bezpečnostního gate se vedle
   `direct-port` local/lab režimu přidá `managed-gateway`: stabilní uložený
   hostname, explicitní HTTPS `publicUrl`, DNS/TLS preflight, Caddy adapter bez
   Docker socketu, deklarativní reconcile a health-gated atomické přepnutí
   routy. Podrobný kontrakt a bezpečnostní hranice jsou v ADR-073.

   ✅ **8a — explicitní režim targetu.** Databáze, API a UI rozlišují
   `direct-port` a `managed-gateway`. Existující instalace se migrují beze změny
   chování; produkční režim vyžaduje čistý HTTPS DNS origin a do dokončení
   preflight/reconcile zůstává bezpečně nealokovatelný jako `setup pending`.

   ✅ **8b — stabilní route rezervace.** `GatewayRoute` jednou rezervuje
   collision-safe hostname a HTTPS URL pro immutable environment. Databáze
   vynucuje unikátní environment, hostname i URL; souběžný zápis převezme pouze
   přesného vítěze. Rename, redeploy a stop/start rezervaci nepřepočítají.
   Desired a observed stav jsou oddělené pro následující Agent reconcile.

   ✅ **8c — DNS/TLS/Caddy preflight.** Agent 0.5 spustí idempotentní,
   read-only job: prověří wildcard DNS přes reprezentativní aplikační
   hostname, trusted TLS explicitního gateway originu na 443 a privátní Caddy
   admin API. Endpoint adapteru je pouze lokální konfigurace Agenta, musí se
   přeložit na privátní adresu a Caddy nedostane Docker socket ani host port.
   Stav `not-run/queued/running/passed/failed` je vidět v Infrastructure a
   starší souběžný job nemůže přepsat novější výsledek.

   ✅ **8d — deklarativní route reconcile.** Agent 0.6 přijímá pouze bounded
   identitu routy a workloadu, sám odvodí Caddy route i upstream a atomicky
   nahrazuje dedikované route pole přes ETag/`If-Match`. Control plane ukládá
   desired/observed generation a aktuální job fence; restart, duplicitní
   odpověď ani starší dokončení proto nepřepíší novější stav. Projekt nemůže
   dodat Caddy JSON, admin URL ani vlastní upstream.

   ✅ **8e-a — bezpečná síťová vazba gateway.** Agent 0.7 vytváří pro
   `managed-gateway` workload samostatnou project/environment síť, diagnostický
   host port váže výchozím způsobem jen na loopback a route job připojí pouze
   lokálně nakonfigurovaný, označený gateway kontejner k přesně vlastněné síti.
   Aktivace má pořadí connect → route; stop/remove route → disconnect. Gateway
   nemá Docker socket a projekt nemůže zvolit kontejner ani síť. Lab provozuje
   Caddy uvnitř stejného izolovaného DinD daemonu, takže kontrakt není jen mock.

   ✅ **8e-b — napojení project lifecycle.** Jedna `DeploymentOperation` nyní
   nese očíslované durable Agent kroky. Deploy/start provede workload → route,
   stop/remove route → workload; druhý krok je do splnění prvního neclaimovatelný
   a restart API terminální stav bezpečně přehraje. Project picker přijme jen
   preflighted Caddy target s durable artifact store a kompatibilní verzí Agenta. Úspěch se
   publikuje až po obou krocích a browser URL je uložený stabilní HTTPS hostname,
   nikoli diagnostický náhodný port.

   ✅ **8f-a — lokální DNS/TLS acceptance profil.** Podporovaný Agent lab bez
   koupené domény provozuje wildcard CoreDNS pro rezervovanou zónu
   `apps.initpad.test`, split-horizon pohled pro host/Agent, loopback-only Caddy
   TLS edge a samostatnou lokální CA. Agent dostane DNS a CA explicitně,
   browser a macOS resolver se mění jen ručně vypsanými příkazy. DNS,
   trusted TLS i HTTPS proxy cesta prošly živě;
   profil neotevírá Docker API ani Caddy admin port a nenahrazuje produkční DNS.

   ✅ **8f-b — health-gated atomické přepnutí.** Agent 0.8 vytváří
   immutable revision slot, ponechá předchozí workload i route v provozu,
   interně ověří candidate, přepne Caddy a potom ověří přesný veřejný
   `https://hostname<healthPath>`. Teprve úspěch odstraní starou revizi a její
   nepoužívaný image. Při chybě obnoví předchozí upstream a candidate
   odstraní; control plane ponechá poslední potvrzenou revision `running`.
   Úplný remove je ownership-bounded a uklidí i případné starší revize.

   ✅ **8f-c — živý odolnostní gate.** Na skutečném Agent labu musí
   projít první deploy, zdravý redeploy, záměrně rozbitý veřejný health
   s rollbackem, restart Agenta/API, výpadek gateway a souběžné nasazení dvou
   workspaces. Po každém scénáři se ověří route, kontejnery, image a sítě.

   ✅ **8f-c1 — restart gateway.** První reálný HTTPS deploy prošel a Caddy
   autosave je na označeném perzistentním volume. Bezpečný lab bootstrap při
   aktualizaci přenese pouze omezenou HTTP-only konfiguraci a znovu připojí jen
   sítě s ownership a `managed-gateway` labely. Runtime upgrade i následný
   restart zachovaly stejnou route, workload i URL; po krátkém startovním `502`
   se veřejný `/health` bez zásahu vrátil na `200`.

   ✅ **8f-c2 — zdravý redeploy a výpadek veřejné cesty.** Opakovaný deploy
   stejného ověřeného artifactu skončil idempotentně na jediném workloadu,
   ponechal stejné dev/test hostname a obě HTTPS `/health` odpovědi `200`.
   Následné vypnutí pouze vnější TLS edge vyvolalo timeout veřejného health
   gate; Agent obnovil předchozí Caddy upstream, projekt ponechal poslední
   revizi `running` a po návratu edge byly dev i test znovu dostupné bez
   zásahu do routy. Selhaná platformní publikace se nyní zobrazuje jako
   `deploy failed`, nikoli nepravdivé `awaiting CI`.

   ✅ **8f-c3 — restart API a Agenta během operace.** Deployment zůstal po
   restartu API durable ve frontě. Po připojení Agenta dokončil workload krok;
   Agent byl následně ukončen až nad leased route jobem ve fázi veřejného
   ověřování. Po expiraci fencing lease převzal tentýž job jako `attempt 2` a
   idempotentně jej dokončil. Zůstala jediná dev instance, stejný hostname,
   desired/observed generace `6/6 active` a dev/test HTTPS health `200`.

   ✅ **8f-c4 — souběh dvou workspaceů.** Workspace `team-alpha` a `it000`
   uložily své deploymenty s offline Agenty současně jako dva queued joby;
   obě identity 0.8.1 se pak spustily společně nad stejným DinD daemonem a
   Caddy gateway. Obě dvoukrokové operace dokončily `attempt 1`. Každá route
   má jiný collision-safe hostname, vlastní namespace/project síť obsahuje jen
   příslušný workload a označenou gateway a všechny tři dev/test HTTPS health
   URL vracejí `200`. Pro zachování již existujícího direct-port targetu přidal
   lab volitelnou třetí oddělenou credential identitu; nejde o sdílený target
   ani produkční topologii. Živý gateway gate 8f-c je tím uzavřen.

Podkrok 1 je bezpečnostní backendový základ a samostatně nemá smysluplný
browser test. Podkrok 2 prošel živě: owner vytvořil Docker target bez inbound
údajů, vygeneroval jednorázový enrollment, po zavření dialogu už plaintext
nebyl dostupný a Agent target nešel před dokončením delivery cesty alokovat.
Podkrok 3 prošel v izolovaném labu podle `apps/agent/README.md`: skutečný Agent
se enrollmentem připojil k oddělenému Docker daemonu, UI ukázalo omezené
capabilities a proběhl přechod `online → offline → online` bez nového
credentialu. Produkčně publikovaný release image/installer se ověří v podkroku
7. Podkrok 4 přidal samostatnou durable frontu, atomické claimy, třicetisekundový
lease s hashovaným fencing tokenem, obnovu, sekvenční progress a idempotentní
dokončení. Živý 35sekundový probe po přerušení Agenta bezpečně vypršel, byl
převzat jako druhý pokus a dokončil se bez spuštění workloadu. Podkrok 5 přidal
striktní Docker allow-list bez shellu, mountů a privileged režimu, immutable
image digest, allocation/target label fencing, resource limity, bounded logy,
health-gated replacement, rollback a idempotentní cleanup. UI založí skutečnou
workspace allocation pouze pro diagnostiku a ukazuje průběh celého lifecycle
testu. Živý DinD test dokončil deploy → health/logs → replace → rollback →
stop/start → remove jako `succeeded`; po dokončení nezůstal kontejner, testem
stažený image ani prázdná diagnostická síť. Podkrok 6 doplnil Agent 0.4:
Gitea registry i GitHub artifact se před vzdáleným deployem uloží jako ověřený
object-store archiv, Agent ověří SHA-256 a očekávaný image tag, config dostane
jen v paměti pod aktivním lease a strukturovaný Docker výsledek dokončí původní
`DeploymentOperation`. Project picker je odemčený pouze pro kompatibilní enrolled
Agent a nikdy nepřepadne na Docker socket control plane. Automatizované testy a
lokální UI/readiness kontrola jsou zelené. Skutečný React projekt byl živě
nasazen z 63,4 MB ověřeného archivu do odděleného Agent DinD targetu; výsledný
workload prošel health checkem a jeho loopback URL byla dosažitelná přes
lab-only bridge bez publikování Docker API. Následný projektový
`Stop → Start → Remove` prošel jako tři samostatné Agent joby; prostředí skončilo
`empty` a izolovaný daemon neobsahoval managed kontejner, image projektu ani
Agent síť. Offline fronta následně také prošla: po heartbeat grace
period target přešel na `offline`, `Deploy` znovu použil tentýž historický
artifact bez nového SCM runu a zůstal `Waiting for Agent`; po reconnectu jediný
job `deploy · attempt 1` dokončil právě jeden workload stejné revize.
Revoke/re-enroll gate také prošel: credential generace 1 byl ihned odmítnut,
běžící workload zůstal dostupný, nový jednorázový enrollment vytvořil generaci
2 a obnovil heartbeat. Spotřebovaný či expirovaný plaintext se z dialogu
automaticky odstraní. Dvou-workspace gate následně použil dvě target identity
se dvěma credential volumes nad jedním fyzickým DinD daemonem. Současné
workloady měly namespaces `team-alpha` a `it000`; Stop a Remove druhého ponechal
první kontejner, síť i URL beze změny a dostupné s HTTP `200`. Produkční gateway
je navazující podkrok 8; 8a–8f-c2 nyní pokrývají explicitní režim, trvalou
rezervaci hostname, bezpečný preflight, generačně chráněný Caddy adapter,
síťovou vazbu, dvoukrokový lifecycle i health-gated veřejné přepnutí se
zachováním poslední potvrzené revize, restart gateway, idempotentní redeploy a
rollback při výpadku veřejné TLS cesty i převzetí leased jobu po restartu
Agenta/API. Souběžný managed deployment workspaceů `team-alpha` a `it000`
navíc potvrdil oddělené hostname, sítě a workload identity nad společnou
gateway. Fáze 5 je tím uživatelsky i provozně uzavřená; současný náhodný port
zůstává záměrně pouze `direct-port` local/lab cestou.

### Fáze 6 — jednotný delivery tok — ✅ dokončeno

- CI produkuje OCI image nebo archiv a jeho digest/SHA.
- Automatický deploy do dev, ruční promotion do testu a approval do prod.
- Docker agent spouští OCI image; ESO provider nahraje tentýž extrahovaný PHP či
  statický artefakt do přidělené cesty.
- SFTP nikdy nespouští projektový build v control plane. Statický bundle i PHP
  aplikace se extrahují z CI-tested image; chybějící image deployment zastaví.
- PHP shared-hosting layout publikuje jen `www`/`public`, soukromou aplikaci a
  perzistentní runtime data chrání před HTTP a po uploadu provede negativní
  security probe. Uživatelská URL neobsahuje `/www/` ani `/public/`.
- Destruktivní akce a prod promotion ukazují target, verzi a dopad.
- Smazání projektu je cleanup plán: všechna řízená nasazení se musí odstranit,
  aktivní prod vyžaduje samostatné potvrzení a zdrojový repozitář je opt-in.
  Při chybě targetu zůstane projekt evidovaný a akci lze bezpečně zopakovat;
  fyzický target se s projektem nikdy nemaže.
- Částečný externí teardown rozliší odstraněný veřejný workload od
  chráněného cleanup dluhu. UI ukáže přesné cesty, dovolí retry a projektový
  záznam lze s dluhy zapomenout jen po samostatném explicitním potvrzení.
- Rollback vybírá předchozí úspěšný artefakt, nic znovu nestaví.
- Deployment stavový automat je explicitní: queued → assigned → running →
  verifying → succeeded; chybové větve failed/unhealthy mohou přejít do ručně
  vyžádaného rollbacku.
- Agent vrací omezený tail aplikačních logů, exit code a výsledek health checku;
  platformní timeline zůstává oddělená od aplikačních logů.

**Stav implementace.** Build-once artifact, automatické dev nasazení, ruční
promotion stejného artifactu, bezpečný SFTP/PHP layout a retryovatelný cleanup
plán byly dodány v předchozích milnících a zůstávají součástí Fáze 6.

- ✅ **6a — trvalý stavový automat deploymentu.** `DeploymentOperation` má
  vedle hrubého transakčního `status` samostatnou provider-neutral `phase`:
  `queued → assigned → running → verifying → succeeded`. Agent ji
  posouvá jen přes fenced claim/progress/terminal výsledek, přímé providery přes
  stejné doménové rozhraní. Selhání health checku je `unhealthy`, ostatní
  chyby `failed`; cancellation je `cancelled`. Fáze je monotónní a po restartu
  zůstává v databázi. API i deployment history ukazují skutečnou fázi.
- ✅ **6b — ruční rollback ověřeného artifactu.** Maintainer/owner/admin může
  pro konkrétní prostředí vyžádat nejnovější předchozí úspěšnou immutable
  publikaci. Potvrzovací dialog ukazuje target, současnou i návratovou verzi,
  digest a provozní dopad. API váže potvrzení na přesný operation ID a otisk
  stavu prostředí; změna targetu, verze, konfigurace nebo souběžná operace
  vyžaduje nové potvrzení. Aktuální environment variables a secrets se nevrací
  do historického stavu. Rollback vytváří auditovanou operaci `rollback`, ale
  nespouští CI ani nový build a stále musí projít health gate cílového
  provideru. Retention chrání aktuální a jeden nejnovější odlišný artifact pro každé prostředí;
  starší objekty mohou podle nastavené lhůty bezpečně expirovat.
- ✅ **6c — diagnostika workloadu.** Projektový detail nabízí
  `Workload diagnostics` pouze pro nasazené workspace Docker/Agent targety.
  Agent 0.9 dostává allocation-scoped allow-listed `logs` job bez commandu,
  image instrukce, configu nebo secretů a vrací stav kontejneru, exit code,
  health výsledek a nejvýše posledních 200 řádků / 32 KiB výstupu. Control plane
  drží právě jeden přepisovaný snapshot pro každé prostředí; logy nevkládá do
  `AgentJob` ani deployment historie. Refresh je fenced, selhání zachová poslední
  úspěšné pozorování, offline Agent je výrazně vidět a request bezpečně čeká ve
  frontě. Aplikační logy smějí číst jen role s project-write oprávněním. Při
  deaktivaci Agenta nebo mazání projektu se čekající diagnostika zruší. Živý
  acceptance s Agentem 0.9 byl potvrzen 1. září 2026 nad skutečným React
  workloadem; po aktualizaci správné target identity se diagnostický snapshot
  i navazující prostředí chovaly podle očekávání.

### Fáze 7 — organizační provoz a školní vyhodnocení — rozpracováno

Fáze nepřidává `Course`, zvláštní školní účty ani druhý tenancy model. Stejné
workspace, role a projekty obslouží školu, malý tým i firmu; školní využití je
jen konkrétní provozní a vyhodnocovací scénář.

- ✅ **Průřezový safety-confirmation pass.** Jednotný přístupný aplikační dialog
  nahrazuje systémové browser confirmy a před spuštěním ukazuje resource,
  skutečný dopad a jasně pojmenované potvrzení. Kryté jsou nevratné mazání,
  environment teardown/stop, produkční publish, změny infrastruktury a rolí,
  reset/deaktivace účtu, Agent credential, GitHub unlink a přepsání configu.
  Rutinní vratné akce zůstávají bez nadbytečného potvrzování; celý projekt nebo
  workspace navíc vyžadují opsání názvu.
- ✅ **Průřezový lifecycle správy targetu.** `Disconnect` a `Retire` ruší
  Agent/SSH/SFTP důvěru bez teardownu běžících workloadů; `Restore` vyžaduje
  nový enrollment nebo credential a ověření. Neaktivní target nepřijímá žádné
  management operace ani nové allocation, zatímco projektové vazby, URL a
  historie zůstávají pravdivě viditelné. Infrastructure vypisuje přesné
  projekty a prostředí blokující tvrdé smazání. Rozpracovaná environment
  operace změnu lifecycle stavu zablokuje.
- ✅ **Průřezová hierarchie infrastruktury.** Doménové `Target` a
  `TargetAllocation` zůstávají oddělené kvůli multi-tenant izolaci, UI je ale
  neprezentuje jako dva repetitivní seznamy. Jeden server obsahuje přístup
  aktivního workspace, kvótu, namespace a používaná prostředí; technické
  připojení a lifecycle akce jsou v rozbalovacím detailu. Uživatelský termín je
  `Workspace access`, zatímco `allocation` zůstává přesným interním názvem.

1. TODO **7a — append-only audit události.** Zavést jednotný workspace-scoped
   záznam aktéra, akce, resource identity, výsledku a času bez ukládání secretů.
   Napojit nejdřív bezpečnostně důležité změny: členství/role, projekt
   create/import/delete, target a allocation, environment target, promotion,
   rollback, diagnostiku a Agent enrollment/disable. UI nabídne filtrovaný,
   stránkovaný audit oprávněným rolím. **Uživatelský test:** dvě role provedou
   několik změn; owner vidí správné pořadí a aktéry, běžný member pouze povolený
   workspace a cizí workspace vrací 404.
   - ✅ **7a.1 — společný základ, členství a projekty.** `AuditEvent` ukládá
     snapshot aktéra a resource, stabilní akci, výsledek, čas a pouze malá
     kontrolovaná metadata. API má filtry, limit 100, stabilní cursor a cizí
     workspace skrývá jako 404. Responzivní `Audit log` nepoužívá aplikační
     logy ani tajné hodnoty a umí postupně načítat další stránku. Napojeny jsou
     workspace create/update, členství/role, projekt create/import/delete,
     environment target, promotion request, rollback request a diagnostic request.
   - ✅ **7a.2 — infrastruktura a Agent.** Target create/update/delete,
     disconnect/retire/restore/reconnect, allocation create/update/delete a
     Agent enrollment/disable zapisují
     workspace, aktéra a neměnný název resource. Update uvádí pouze skutečně
     změněná pole, destruktivní akce zachovají snapshot před smazáním a audit
     nikdy nepřebírá target host/URL/path, credentials ani enrollment token.
   - ✅ **7a.3 — výsledky a provozní vazby.** Dlouhé create/import a
     deployment lifecycle akce zapisují zvlášť přijetí (`accepted`) a
     autoritativní terminální výsledek (`succeeded`, `failed`, `cancelled`).
     Událost nese pouze typ a immutable ID `DeploymentOperation` nebo
     `ProvisioningOperation`; aktuální status/phase se při čtení doplní z
     operation tabulky. Replay Agent callbacku je idempotentní a audit
     nekopíruje provider message, logy, config ani secrety. Odkaz v UI vede na
     projekt nebo jeho deployment historii a zachová ID i po odstranění
     autoritativního řádku.
   - ◐ **7a.4 — živý acceptance.** Prošlo filtrování, prázdný výsledek,
     přepnutí workspace a vizuální oddělení jeho událostí. Zbývá ověřit
     druhý reálný účet/roli, přímý 404 pokus, stránkování a zachování
     snapshotu po změně role/jména.
2. ◐ **7b — skutečný prod approval workflow.** Produkční promotion,
   redeploy i rollback již nelze spustit přímo. Žádost ukládá immutable build,
   digest, target/allocation identity a revision i číslo revize konfigurace; samotné
   hodnoty configu a secretů neukládá. Team workspace ve výchozím stavu vyžaduje
   jiného ownera/admina, personal workspace dovoluje explicitní self-review. Schválení
   znovu ověří celý snapshot, atomicky zamkne prostředí a teprve potom založí
   autoritativní deployment operation. Souběžná, dvojitá, zamítnutá nebo
   zastaralá žádost nespustí druhé nasazení; pending artifact chrání retention.
   Workspace admin může policy změnit po potvrzení a změna platí i pro dosud
   čekající žádost. API, responzivní UI, audit a automatické regresní testy jsou
   hotové (ADR-082).
   - ◐ **7b acceptance:** owner v team workspace živě vytvořil immutable
     request, UI správně zakázalo self-approval a zrušení prošlo potvrzovacím
     dialogem bez spuštění produkce. Zbývá, aby member/maintainer požádal a oprávněný druhý člověk
     schválí a prod použije přesně zobrazený digest. Samostatně ověřit reject,
     cancel, dvojité schválení a zneplatnění po změně produkční proměnné
     nebo targetu. V Audit logu musí být oddělené request, review a deployment
     outcome události.
3. ◐ **7c — provozní policy a lifecycle.** Allocation nese validované
   CPU/RAM/PID limity, stávající maximální počet prostředí a volitelné TTL pro
   dev/test. Vestavěný Docker i vzdálený Agent vynucují stejný resource snapshot.
   Úspěšný deploy ukládá expiry a předstih varování; periodický
   compare-and-set sweep auditovaně odstraní pouze workload a při chybě jej
   bezpečně naplánuje znovu. Produkce je vyloučena dotazem i guardem a repository
   není součástí lifecycle akce (ADR-083). Automatické testy jsou hotové; zbývá
   živý test po aplikaci migrace.
   **Uživatelský test:** překročení kvóty je odmítnuto před jobem, expirující dev
   je vidět dopředu a po TTL zmizí jen workload; prod zůstane nedotčený.
4. ◐ **7d — organizační portfolio.** Workspace dashboard jedním databázovým
   read-modelem shrnuje projekty, poslední CI/deploy, health, aktivní server
   accesses, čekající approvals a cleanup dluh. Načtení nevolá SCM ani Docker
   a neroste o dotaz pro každý projekt (ADR-084). Automatické testy, produkční
   build a živý owner acceptance nad reálným workspace jsou hotové; zbývá
   živý acceptance druhé read-only role.
   **Uživatelský test:** owner pozná problémový projekt a přejde na konkrétní
   akci; viewer vidí stejný read-only stav a prázdný list se během načítání
   falešně nezobrazí.
5. ◐ **7e — vyhodnocovací export.** Owner/admin volí období a stahuje
   verzovaný JSON nebo CSV s celkovými i denními agregacemi: úspěšnost
   deploymentů, rollbacky, request-to-healthy dev a build-to-production proxy.
   Databázový select záměrně nečte logy, message, config, secrets ani identity;
   cizí workspace vrací 404 a member/viewer 403 (ADR-085). Automatické testy,
   produkční build a živé stažení obou formátů ownerem jsou hotové; Audit
   log potvrdil správný formát, období i aktéra. Zbývá živý pokus druhého
   member/viewer účtu.
   **Uživatelský test:** owner exportuje období a hodnoty odpovídají
   auditovaným operacím; member bez oprávnění export nezíská.

### Fáze 8 — hardening a vyhodnocení

1. ✅ **8a — výchozí autentizační hranice.** Celé API je session-authenticated
   by default. Veřejné, OAuth/OIDC a strojové endpointy musí nést explicitní
   důvod výjimky; CI token, SCM podpis a Agent credential se dál ověřují uvnitř
   jejich protokolu. Nový controller se už nemůže stát veřejným jen zapomenutým
   guardem. Cizí workspace/project/target/allocation se skrývá jako 404,
   nedostatečná role uvnitř vlastního workspace zůstává 403 (ADR-086).
   **Uživatelský test:** bez přihlášení odpoví health, katalog šablon a auth
   config 200, zatímco `/api/projects` vrátí 401; neplatný CI token vrátí 401.
2. ✅ **8b — dvou-workspace E2E matice.** Automatická cross-service matice
   modeluje ownera workspace A a uživatele, který je viewerem A a ownerem B.
   Ověřuje read/write hranice projektu, targetu, allocation, provisioning
   operace, auditu, diagnostiky, configu, portfolia, Agenta a exportu včetně
   přímých cizích ID. Test navíc dokazuje, že po 404/403 neběží navazující
   datový dotaz ani infrastrukturová mutace. Izolovaný acceptance runner stejnou
   matici provedl přes skutečné HTTP sessions dvou dočasných účtů: 24 kontrol
   prošlo a závěrečný databázový invariant i odstranění fixtures byly čisté.
   **Uživatelský test:** Alice zkusí přímé URL/ID zdrojů Team Beta a dostane
   404; Bob jako viewer Team Alpha stav přečte, ale každá změna skončí 403.
3. ✅ **8c — Agent adversarial testy.** Každá job operace je současně
   svázaná s aktivní credential identitou, targetem, vlastníkem lease,
   hashovaným fencing tokenem a expirací. Automatizovaná matice ověřuje, že
   kompromitovaný Agent neclaimne, neobnoví, neposune, nestáhne ani nedokončí
   job jiného targetu. Pokrývá revoke mezi autentizací a CAS zápisem, starou
   generaci credentialu, reassigned lease, změněný completion replay a pozdní
   progress delivery bez regrese viditelného stavu (ADR-087). Cizí `jobId`
   vrací jednotný konflikt ještě před čtením jeho druhu nebo artifactu.
   **Uživatelský test:** na dvou Agent targetech se spustí dva probe joby;
   odpojení/re-enrollment prvního okamžitě odmítne jeho starý credential,
   druhý job i workload zůstanou beze změny a platný Agent dokončí každý job
   nejvýše jednou.
4. ✅ **8d — failure injection a recovery drill.**

   - ✅ **8d-a — selhání před publikací.** Deterministické fault testy
     simulují nedostupný source registry, odmítnutý nebo částečný object-store
     upload, nedostupná artifact metadata, Docker `no space left on device`
     po částečném image loadu a okamžitý exit kandidátního kontejneru.
     Neúspěch nevytvoří dostupný artifact záznam, odstraní dočasná data,
     nepublikuje kandidáta a zachová poslední zdravý workload (ADR-088).
     **Uživatelský test:** v Agent labu ponechat zdravý managed deployment,
     nasadit novější testovací revizi s runtime `CMD`, který ihned skončí,
     a ověřit failed operaci, stále zdravou původní URL a nepřítomnost
     failed candidate kontejneru. Zaplnění skutečného host disku se neprovádí.
   - ✅ **8d-b — přerušení během operace.** Stavový test provede claim
     attemptu 1, expiraci lease, takeover attemptem 2, odmítnutí starého
     completion a identický retry jediného terminálního zápisu. Výpadek
     control plane při renew zastaví lokální práci bez neoprávněného
     completion. Opakovaný Docker pokus použije již vytvořeného zdravého
     kandidáta a skončí s jediným workloadem. API restart durable Agent job
     nemaže a ztracená odpověď po completion zůstává idempotentní. Agent
     navíc přijímá bezpečný chunked artifact stream bez `Content-Length`;
     velikost i digest stále ověří nad celým streamem (ADR-089).
     **Uživatelský test:** spustit 35sekundový **Test protocol**, během
     attemptu 1 zavolat `./agent-lab.sh stop-agent`, po expiraci lease použít
     `./agent-lab.sh start-agent` a ověřit jeden `succeeded` job s `attempt 2`.
   - ✅ **8d-c — provozní recovery drill.** API readiness nyní ověřuje
     databázi i privátní artifact store a Compose samostatně health-checkuje
     MinIO. Reprodukovatelný drill odmítne aktivní práci, simuluje výpadek
     MinIO nebo Gitea/OCI a po obnově kontroluje zdraví. Restore zneplatní
     runtime projekce, ukončí rozpracované operace, odebere lease starým
     Agent jobům, resetuje gateway/diagnostiku a zachová immutable artifact
     identity pro nový auditovaný deploy (ADR-090). SQL kontrakt se testuje
     nad dočasnými PostgreSQL tabulkami bez změny živých dat.
     **Uživatelský test:** na jednorázové VM spustit
     `./recovery-drill.sh artifact-store-outage` a `registry-outage`; potom
     vytvořit checkpoint pomocí `backup.sh`, obnovit jej přes `restore.sh`
     a ihned zavolat `./recovery-drill.sh verify-restore`.
5. ◐ **8e — release audit, vyhodnocení a předání.**

   - ✅ **8e-a — reprodukovatelný repository gate.** `npm run check` nejdřív
     bez sítě ověří obsah Git indexu: necommitované runtime/personal soubory,
     absolutní vývojářské cesty, známé formáty tokenů, povinnou veřejnou
     dokumentaci, executable provozní skripty a dosažitelnost produkčních modulů
     z entrypointů. Potom sestaví a otestuje všechny aplikace. Síťový
     `check:release` navíc spustí audit produkčních npm závislostí; nalezená
     `qs` DoS advisory byla odstraněna kompatibilní aktualizací lockfile.
   - TODO **8e-b — cílený maintainability pass.** Podle charakterizačních testů
     rozložit jen potvrzené hotspoty s více odpovědnostmi, zejména projektovou
     orchestraci, Agent job protokol a SCM HTTP vrstvy. Velikost souboru je signál
     pro review, ne automatický důvod k abstrakci.
   - TODO **8e-c — nezávislé vyhodnocení.** Studentský tým a vyučující projdou
     připravený scénář; změří se čas, kroky, chyby a SUS bez pomoci autora.
   - ◐ **8e-d — finální předání.**
     - ✅ **8e-d-a — instalační a distribuční kontrakt Agenta.** Běžící
       instance zveřejní kontrolní součet auditovaného Linux instalátoru a
       nabídne jej v enrollment dialogu. Instalátor vyžaduje digestem připnutý
       OCI image, token čte jen skrytě z terminálu, zachovává `0600`
       identitu, instaluje omezený restartovatelný kontejner a při chybné
       aktualizaci obnoví předchozí verzi (ADR-092). Bez
       `INITPAD_AGENT_IMAGE` se produkční instalace v UI záměrně neaktivuje.
     - ◐ **8e-d-b — skutečné vydání.**
       - ✅ **8e-d-b1 — reprodukovatelná release pipeline.** Tag shodný s
         verzí Agenta spustí gate, sestaví jeden GHCR OCI index pro
         `linux/amd64` a `linux/arm64`, připojí SBOM a maximální build
         provenance, podepíše image i stažitelné soubory přes keyless Cosign
         a vydá manifest s immutable digestem a `SHA256SUMS` (ADR-093).
         Workflow nepoužívá `latest`, odmítne již existující verzi a všechny
         cizí Actions jsou připnuté na commit SHA.
       - TODO **8e-d-b2 — publikace a živá acceptance.** Ochraňovat tagy
         `agent-v*`, spustit první release, zveřejnit GHCR package pro
         anonymní pull, nastavit vzniklý digest do release kandidáta a na
         samostatném čistém Linux hostu ověřit instalaci, reboot, update,
         rollback vadného obrazu a zachování workloadů po odpojení Agenta.
     - TODO **8e-d-c — provider a informační architektura.** Dokončit
       `Agent-first` UX, ponechat SFTP jako viditelně označenou kompatibilní
       cestu pro shared PHP/static hosting, přesunout přímé Docker ovládání
       pouze do self-hosted profilu a deprecovat zdrojový SSH runtime provider.
       Navigaci sjednotit na Overview, Projects, Deployments, Servers a Manage;
       account, workspace a instance nastavení nemíchat na jedné obrazovce.
     - TODO **8e-d-d — dokumentace release kandidáta.** Podle skutečného
       kandidáta aktualizovat architekturu, diagramy, provozní dokumentaci,
       implementační kapitolu diplomky a seznam vědomých omezení.

## Akceptační kritéria

- Nový tým dosáhne zdravého dev URL do deseti minut bez administrátorského SSH.
- Student nikdy nevidí credentials školního serveru.
- Člen workspace A nedokáže načíst ani změnit projekt, target, log nebo operaci B.
- Import repa nemění jeho kód bez explicitního potvrzení.
- Test a prod na stejném ESO se nemohou přepsat.
- Promotion používá stejný digest/SHA jako předchozí prostředí.
- Odpojený nebo kompromitovaný agent nemůže převzít job jiného targetu/workspace.
- Každá změna produkce má dohledatelného aktéra, artefakt a target allocation.

## Uživatelské ověření po každém milníku

U každého milníku se před přechodem dál provede tento acceptance test a uloží
se výsledek (screenshot/HTTP výsledek, datum a případná odchylka):

| Milník | Uživatelsky testovatelný | Scénář a očekávaný výsledek |
|---|---|---|
| 1 — bezpečný baseline | ano | Přihlášení, vytvoření projektu, viditelné CI a responzivní UI; build/test/health jsou zelené. |
| 2 — architektura | nepřímo | Uživatel nic nového neovládá; školní scénář a scope schválí vyučující proti ADR/roadmapě. |
| 3 — workspaces/RBAC | ano | Dva účty, tým, viewer, sdílený projekt, přepnutí workspace; viewer čte, nezapisuje, cizí ID vrací 404 a nedostatečná role ve vlastním workspace 403. |
| 4 — identity/onboarding | ano | Self-hosted `open`: samoobslužná registrace. Self-hosted soukromě: admin vytvoří účet a předá aktivační odkaz nebo dočasné heslo s vynucenou změnou. SaaS: pouze GitHub login. Majitel přidá do týmu existující účet podle e-mailu; role platí i v SCM. |
| 5 — import repa/SCM | částečně | Self-hosted: stávající Gitea projekty beze změny URL projdou detail/import/deploy/delete. SaaS se živou App: New project nabídne osobní/organizační instalace aktivního workspace, založí soukromé GitHub repo a import vypíše repa všech grantů; cizí workspace installation ID musí vrátit 400. Import bez Dockerfile nebo nového artifact callbacku je zablokovaný. Ověřit commity/check runs, artifact ID/digest, dev deploy stejného SHA, retry a delete/detach. Durable object-store ingestion je hotová; plný cloudový workload provoz čeká na Agenta. |
| 6 — target allocations | ano | Podle `deploy/SELF_HOSTED_ACCEPTANCE.md` dva workspace nasadí na jeden Docker target; sítě/jména se nepřekrývají, role/cizí data jsou izolované a disabled/quota policy je vynucená. |
| 7 — agent | ano | Instalace/enrollment, online heartbeat, **Test protocol** a **Test Docker**; lifecycle ověří digest-pinned image, health, bounded logy, replace/rollback/stop/start a úplný cleanup. Potom vytvořit skutečný projekt s Agent targetem pro dev, ověřit stejný artifact digest, Deploy → Stop → Start → Remove a prázdný cleanup. Po vypnutí Agent přejde offline a nový deploy zůstane ve frontě; po reconnectu se dokončí právě jednou. Druhý workspace nesmí vidět ani měnit první workload. Produkční routing navíc ověří dvě současně alokované stabilní HTTPS URL, zachování URL při redeploy/rename/stop-start, rollback při výpadku gateway a nepřístupný gateway admin endpoint i Docker API. |
| 8 — delivery/approval | ano | Push → dev, promotion stejného digestu → test, prod approval, health failure a ruční rollback. React/Vue prod se nasadí bez lokálního `npm` buildu. PHP na ESO odpoví na čisté URL bez `/www`/`public`, soukromý `composer.json` vrátí non-2xx a druhý redeploy uspěje i po vytvoření runtime cache. Delete dialog ukáže všechny targety a vyžádá prod potvrzení. Částečný ESO teardown nastaví prostředí na `empty`, vypíše cleanup cesty a bez reloadu nabídne retry/explicitní detach. Legacy strom s cizí cache se přesune do unikátní karantény a původní deployment cesta se musí prokazatelně uvolnit. Po smazání repozitáře lze založit nový projekt se stejným jménem. U Agent targetu otevřít `Workload diagnostics`: běžící workload vrátí current revision, health a bounded output; po Stop vrátí `stopped`, exit code a `not running`. Viewer akci ani logy neuvidí, offline request zůstane viditelně queued a dokončí se po reconnectu. Deployment timeline se přitom nezmění. |
| 9 — školní E2E | ano | Nezávislý studentský tým projde celý scénář; změří se čas, kroky, chyby a SUS. |

## Aktuální stav ověření

Automatizovanou regresi tvoří produkční build API, webu a Agentu, kompletní API
sada a Agent testy spouštěné příkazem `npm run check`. TypeScript má zapnuté
`noUnusedLocals` i `noUnusedParameters`; audit importního grafu nesmí najít
osiřelý produkční modul. Historické Prisma migrace se nemažou ani po odstranění
původní funkce, protože jsou součástí reprodukovatelné instalace databáze od nuly.

Dosavadní živé ověření prokázalo workspace RBAC a synchronizaci rolí do Gitey,
React i Nette deployment na ESO, chráněný PHP layout, opakovaný deploy po vzniku
runtime cache, bezpečné uvolnění kanonické cesty při částečném teardownu a
self-hosted izolaci dvou workspaceů podle
[SELF_HOSTED_ACCEPTANCE.md](deploy/SELF_HOSTED_ACCEPTANCE.md). Agent lab navíc
prokázal single-use enrollment, omezenou telemetrii, restart/retry a přechod
`online → offline → online`. Allocation-scoped Docker diagnostika navíc živě
prošla celý omezený lifecycle a nezanechala workload, image ani síť. Agent
0.4 je napojený do projektového toku a skutečný React workload byl z ověřeného
artifactu živě nasazen, prošel health checkem a byl dostupný přes lab-only
loopback bridge bez vystavení Docker API. Projektový `Stop → Start → Remove`
navíc skončil `empty` bez zbylého managed kontejneru, image projektu nebo Agent
sítě. Offline deploy znovu použil ověřený artifact bez nového SCM runu, čekal
ve frontě a po reconnectu se dokončil jediným `attempt 1` do právě jednoho
workloadu. Revoke/re-enroll následně zneplatnil credential generace 1 bez
zásahu do běžící aplikace a nový enrollment obnovil Agent jako generaci 2.
Dvě oddělené target identity nad jedním izolovaným daemonem poté nasadily
současně namespaces `team-alpha` a `it000`; Stop/Remove druhého workloadu
nezměnil první. Stabilní HTTPS routing podle ADR-073 má hotový lokální
DNS/TLS profil i automatizovaný dual-revision cutover Agenta 0.8. Živě prošel
restart gateway se zachováním routy, idempotentní zdravý redeploy a rollback
při nedostupné veřejné TLS cestě i restart API a Agenta během rozpracované
operace s fencing převzetím druhého pokusu. Souběžný start queued deploymentů
`team-alpha` a `it000` dokončil obě operace napoprvé a ověřil odlišné hostname,
project-scoped sítě i HTTP `200`; gate 8f-c a Fáze 5 jsou tím uzavřené. Tyto
dílčí výsledky nenahrazují závěrečný školní E2E scénář s nezávislým týmem.
Tenant boundary navíc prošla izolovaným HTTP acceptance během 24 požadavků:
cizí zdroje vrátily 404, viewer mutace 403, povolené čtení a owner export 200.
Přímá kontrola databáze nepotvrdila žádnou zamítnutou mutaci a automatický
cleanup nezanechal účet, workspace ani projektový fixture.

## Vyhodnocení pro diplomovou práci

Porovnat ruční postup a InitPad ve čtyřech scénářích:

1. založení nového projektu ze šablony;
2. import existujícího repozitáře;
3. doručení změny přes dev → test → prod;
4. přidání nového člena týmu a přidělení školního targetu.

Měřit čas, počet ručních kroků, počet chyb, úspěšnost provisioningu, lead time,
identitu artefaktu a schopnost obnovy. Doplnit SUS dotazník a krátký rozhovor se
studenty a vyučujícím o kognitivní zátěži a srozumitelnosti platformy.

## Tržní a technické reference

- Backstage Software Templates: https://backstage.io/docs/features/software-templates/
- Backstage Software Catalog: https://backstage.io/docs/features/software-catalog/
- Coolify Cloud / own servers: https://coolify.io/docs/get-started/cloud
- Dokploy Cloud control plane: https://docs.dokploy.com/docs/core/cloud
- GitHub self-hosted runners: https://docs.github.com/en/actions/reference/runners/self-hosted-runners
