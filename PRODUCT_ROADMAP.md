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

### Fáze 4 — target pool a allocations — kód dokončen, čeká živý gate (ADR-060)

- Fyzický `Target` spravuje škola, firma nebo uživatel.
- `TargetAllocation` přiděluje omezený výsek targetu workspace/týmu a prostředí.
- Allocation nese capabilities, root path/namespace, public URL, kvótu a policy.
- Učitel může pool publikovat, přidělovat a odebírat bez odhalení credentials.
- ESO test/prod používají oddělené cesty a konfigurace na stejném fyzickém hostu.

**Stav (ADR-060):** model + aditivní migrace, idempotentní legacy backfill,
providerové routování root/URL, workspace-scoped Docker síť i jméno kontejneru,
CRUD API a create/edit UI `/allocations`, role/cross-tenant 404 a policy při
create/import, změně targetu i deploy — implementováno a automaticky testováno.
Nové built-in allocations dostávají workspace prefix; legacy URL a ESO cesty
zůstanou beze změny. Otevřený je pouze **živý uživatelský test dvou workspaceů**
na skutečné VM. Durable object storage je hotové (ADR-059), takže po zeleném
gate může začít Agent. Fronta jedním runnerem má explicitní `awaiting CI`
stav, první job hlásí skutečné převzetí callbackem a počet souběžných slotů
je provozně konfigurovatelný (ADR-064); zbývá živý dvouprojektový gate.

**Uživatelské ověření Fáze 4 (TargetAllocation):** dva workspace nasadí na stejný
built-in target — každý má vlastní namespace, běží současně bez kolize a na cizí
allocation nevidí (404). Owner vytvoří/zakáže allocation, member v ní nasadí,
viewer jen čte; zakázaná allocation odmítne nový deploy, ale běžící nezruší;
překročení kvóty je odmítnuto s jasnou zprávou. Migrace zachová URL a ESO cesty
existujících projektů. Neověřovat jen existencí DB řádku — prokázat reálný deploy
a izolaci mezi workspace. Reprodukovatelný postup je v
[`deploy/SELF_HOSTED_ACCEPTANCE.md`](deploy/SELF_HOSTED_ACCEPTANCE.md).

### Fáze 4.5 — quality checkpoint před Agentem — kód dokončen, čeká živý gate

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
5. **Živý gate.** Produkční build, API a template testy, dependency audit,
   self-hosted smoke test, kontrola mrtvého kódu a browser acceptance musí být
   zelené. Teprve potom začne Agent.

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

- Pro MVP platí jeden target = jeden agent = jeden Linux Docker server.
- Jednorázový enrollment token sváže agenta s fyzickým targetem a vymění se za
  rotovatelnou identitu; agent jde zablokovat a eviduje verzi i poslední kontakt.
- Agent navazuje pouze odchozí HTTPS spojení. První verze používá polling/long
  polling; WebSocket je optimalizace, ne podmínka správnosti.
- Control plane ukládá durable job; agent si jej pronajme, průběžně obnovuje
  lease, posílá heartbeat/capabilities a publikuje strukturovaný progress.
- Agent nepřijímá libovolný shell. Protokol povoluje pouze verzované operace
  `DEPLOY_SERVICE`, `STOP_SERVICE`, `START_SERVICE`, `REMOVE_SERVICE`,
  `GET_SERVICE_STATUS`, `FETCH_LOGS`, `RUN_HEALTH_CHECK` a `ROLLBACK_SERVICE`.
- Agent stahuje image podle neměnného digestu, vynucuje allocation, resource limity,
  síť a naming; control plane už nepotřebuje host Docker socket.
- Každý job má tenant/target scope, correlation ID a idempotency key. Odpojení
  agenta operaci neztratí: lease vyprší a job lze bezpečně zopakovat bez druhého
  kontejneru nebo sítě.
- Secret hodnoty mohou zůstat pouze na targetu; cloud ukládá jejich názvy a stav
  `configured/missing`, agent je lokálně mapuje do deploymentu.

### Fáze 6 — jednotný delivery tok

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

### Fáze 7 — organizační provoz a školní vyhodnocení

- Portfolio workspaceů: týmy, projekty, CI, aktivní allocations a poslední deploy.
- Approval pravidla, termíny, kvóty CPU/RAM/disk a automatický teardown.
- Audit log registrace, změn členství, target assignmentů, promotion a mazání.
- Volitelný export workspace metrik pro firmu nebo vyhodnocení výuky bez
  zavedení druhé autorizační domény.

### Fáze 8 — hardening a vyhodnocení

- Threat-model review pro každou tenant boundary a agent protocol.
- E2E test nejméně se dvěma workspaces, aby se ověřila izolace.
- Restore drill, výpadek agenta během deploye a retry bez dvojitého spuštění.
- Failure injection: agent offline, registry nedostupná, disk plný, okamžitý
  exit kontejneru, health timeout, duplicitní doručení a ztracená odpověď po
  úspěšném deploymentu.
- Usability test se studenty a učitelem.
- Aktualizace architektury, diagramů, ADR a implementační kapitoly diplomky.

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
| 3 — workspaces/RBAC | ano | Dva účty, tým, viewer, sdílený projekt, přepnutí workspace; viewer čte, nezapisuje, cizí ID vrací 403. |
| 4 — identity/onboarding | ano | Self-hosted `open`: samoobslužná registrace. Self-hosted soukromě: admin vytvoří účet a předá aktivační odkaz nebo dočasné heslo s vynucenou změnou. SaaS: pouze GitHub login. Majitel přidá do týmu existující účet podle e-mailu; role platí i v SCM. |
| 5 — import repa/SCM | částečně | Self-hosted: stávající Gitea projekty beze změny URL projdou detail/import/deploy/delete. SaaS se živou App: New project nabídne osobní/organizační instalace aktivního workspace, založí soukromé GitHub repo a import vypíše repa všech grantů; cizí workspace installation ID musí vrátit 400. Import bez Dockerfile nebo nového artifact callbacku je zablokovaný. Ověřit commity/check runs, artifact ID/digest, dev deploy stejného SHA, retry a delete/detach. Durable object-store ingestion je hotová; plný cloudový workload provoz čeká na Agenta. |
| 6 — target allocations | ano | Podle `deploy/SELF_HOSTED_ACCEPTANCE.md` dva workspace nasadí na jeden Docker target; sítě/jména se nepřekrývají, role/cizí data jsou izolované a disabled/quota policy je vynucená. |
| 7 — agent | ano | Instalace/enrollment, online heartbeat, deploy image, logy; po vypnutí agent přejde offline a job čeká bez duplikace. |
| 8 — delivery/approval | ano | Push → dev, promotion stejného digestu → test, prod approval, health failure a ruční rollback. React/Vue prod se nasadí bez lokálního `npm` buildu. PHP na ESO odpoví na čisté URL bez `/www`/`public`, soukromý `composer.json` vrátí non-2xx a druhý redeploy uspěje i po vytvoření runtime cache. Delete dialog ukáže všechny targety a vyžádá prod potvrzení. Částečný ESO teardown nastaví prostředí na `empty`, vypíše cleanup cesty a bez reloadu nabídne retry/explicitní detach. Legacy strom s cizí cache se přesune do unikátní karantény a původní deployment cesta se musí prokazatelně uvolnit. Po smazání repozitáře lze založit nový projekt se stejným jménem. |
| 9 — školní E2E | ano | Nezávislý studentský tým projde celý scénář; změří se čas, kroky, chyby a SUS. |

## Aktuální stav ověření

Automatizovanou regresi tvoří produkční build obou aplikací a kompletní API
sada spouštěná příkazem `npm run check`. TypeScript má zapnuté
`noUnusedLocals` i `noUnusedParameters`; audit importního grafu nesmí najít
osiřelý produkční modul. Historické Prisma migrace se nemažou ani po odstranění
původní funkce, protože jsou součástí reprodukovatelné instalace databáze od nuly.

Dosavadní živé ověření prokázalo workspace RBAC a synchronizaci rolí do Gitey,
React i Nette deployment na ESO, chráněný PHP layout, opakovaný deploy po vzniku
runtime cache a bezpečné uvolnění kanonické cesty při částečném teardownu.
Tyto dílčí výsledky nenahrazují celý self-hosted acceptance gate.

Před zahájením Agenta zbývá na čisté VM dokončit
[SELF_HOSTED_ACCEPTANCE.md](deploy/SELF_HOSTED_ACCEPTANCE.md): dva workspaces musí
současně nasadit na sdílený Docker target bez kolize jmen, sítí, portů nebo dat;
cizí projekt, allocation a operace musí zůstat nedostupné. Výsledek se uloží jako
samostatný testovací protokol pro diplomovou práci, ne jako průběžný deník v
roadmapě.

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
