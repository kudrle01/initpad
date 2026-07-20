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
reset hesla. GitHub login/link je součást rozpracované Fáze 3.

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
   handoff a lokální Docker ingestion jsou také hotové; zbývá durable object
   storage + agent transport pro multi-instance veřejný SaaS.
5. Potom dokončit migrace v cílových prostředích, živý GitHub App E2E a browser
   acceptance: login, instalace pro vybrané repo, create/import, CI, odebrání
   instalace, rename ownera a dvě repa se stejným názvem.

GitLab je vědomě až další adapter. Template manifest jako verzovaný blueprint
contract a firemní blueprint repozitáře zůstávají následným rozšířením.

### Fáze 4 — target pool a allocations

- Fyzický `Target` spravuje škola, firma nebo uživatel.
- `TargetAllocation` přiděluje omezený výsek targetu workspace/týmu a prostředí.
- Allocation nese capabilities, root path/namespace, public URL, kvótu a policy.
- Učitel může pool publikovat, přidělovat a odebírat bez odhalení credentials.
- ESO test/prod používají oddělené cesty a konfigurace na stejném fyzickém hostu.

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
| 5 — import repa/SCM | částečně | Self-hosted: stávající Gitea projekty beze změny URL projdou detail/import/deploy/delete. SaaS se živou App: New project nabídne osobní/organizační instalace aktivního workspace, založí soukromé GitHub repo a import vypíše repa všech grantů; cizí workspace installation ID musí vrátit 400. Import bez Dockerfile nebo nového artifact callbacku je zablokovaný. Ověřit commity/check runs, artifact ID/digest, dev deploy stejného SHA, retry a delete/detach. Lokální control-plane ingestion je hotová; plný multi-instance cloudový provoz čeká na object storage/agent. |
| 6 — target allocations | ano | Učitel přidělí jednomu týmu dev/test/prod; druhý tým target ani credentials nevidí, ESO cesty se nepřekrývají. |
| 7 — agent | ano | Instalace/enrollment, online heartbeat, deploy image, logy; po vypnutí agent přejde offline a job čeká bez duplikace. |
| 8 — delivery/approval | ano | Push → dev, promotion stejného digestu → test, prod approval, health failure a ruční rollback. React/Vue prod se nasadí bez lokálního `npm` buildu. PHP na ESO odpoví na čisté URL bez `/www`/`public`, soukromý `composer.json` vrátí non-2xx a druhý redeploy uspěje i po vytvoření runtime cache. Delete dialog ukáže všechny targety a vyžádá prod potvrzení. Částečný ESO teardown nastaví prostředí na `empty`, vypíše cleanup cesty a bez reloadu nabídne retry/explicitní detach. Legacy strom s cizí cache se přesune do unikátní karantény a původní deployment cesta se musí prokazatelně uvolnit. Po smazání repozitáře lze založit nový projekt se stejným jménem. |
| 9 — školní E2E | ano | Nezávislý studentský tým projde celý scénář; změří se čas, kroky, chyby a SUS. |

### Aktuální výsledek milníku 3

- Migrace reálné databáze: úspěšná, žádný projekt bez workspace.
- Osobní workspace a týmový workspace: přepínání ověřeno v browseru.
- Viewer viděl týmový projekt, ale create/deploy/delete UI bylo read-only.
- API: osobní seznam 0 projektů, týmový seznam 1; viewer write 403, cizí
  workspace ID 403.
- Reálná Gitea integrace: viewer měl `pull=true, push=false`, po změně na member
  `pull=true, push=true` a po odebrání už privátní repo vracelo 404.
- Auditní projekt, Gitea repo, účty a workspaces byly po testu odstraněny.

### Aktuální výsledek milníku 4 (identity/onboarding)

Implementováno podle ADR-040/042 a ověřeno API unit testy (registrační politika,
stavový guard, platform-admin, členství, reset/verifikace) i typecheckem obou
aplikací a produkčním emitem API. Migrace jsou aditivní a ověřené `prisma
migrate diff` proti předchozímu schématu. Browser acceptance test se spouští
proti běžící instalaci; testovatelné scénáře:

- Normální registrace v `open`; v `admin-provisioned` je self-service zavřená
  (kromě prvního bootstrap účtu) a login screen to vysvětlí.
- Správce vytvoří účet → dostane aktivační odkaz i jednorázové dočasné heslo.
  Aktivační odkaz: uživatel si nastaví vlastní heslo a je přihlášen. Dočasné
  heslo: uživatel je při přihlášení nucen ho změnit, než smí cokoli dalšího.
- Majitel týmu přidá do workspace existující účet podle username/e-mailu → je
  členem a role platí i v privátním Gitea repu; přidání neexistujícího účtu selže.
- Reset hesla přes `/forgot-password` → odkaz (log/e-mail) → nastavení nového
  hesla zneplatní původní session.
- Deaktivace účtu odepře přihlášení i běžící session; poslední aktivní
  administrátor a sebe-deaktivace jsou chráněny.
- Po testu se smažou všechny dočasné účty, workspaces a repozitáře.

### Revize a SCM identity podkrok Fáze 3 (2026-07-17)

- Lokálně prošlo 32 API test suites / 174 testů, API production build a skutečný
  webový `tsc -b && vite build`. `docker compose config` a Prisma schema validate
  také prošly (schema validate s testovací `DATABASE_URL`).
- Opravena hranice edic: SaaS neumožňuje native registraci/password login ani
  self-hosted správu uživatelů; první OAuth účet není automaticky správce.
- Managed Gitea účet dostává po vydání PAT náhodné neznámé lokální heslo a legacy
  účty se best-effort zpevní při startu, aby reset/deaktivaci nešlo obejít přímým
  Gitea loginem.
- OIDC pro Giteu před vydáním code/token/userinfo znovu ověřuje aktivní účet,
  session generation a forced-change stav; `email_verified` odpovídá databázi.
- Jednorázové auth tokeny se claimují atomicky; GitHub OAuth nepovažuje neověřený
  profilový e-mail za ověřený; poslední použitelnou identitu nelze odpojit.
- GitHub webhook při chybě DB neztratí událost tichým 202 a installation tokeny
  používají operation-specific podmnožiny oprávnění.
- GitHub installation setup používá hashovaný jednorázový state navázaný na
  user/workspace, serverově ověřené immutable account ID a owner/admin re-check.
  Osobní instalace musí odpovídat propojené identitě, organizace dostává
  explicitní workspace grant a uninstall se historizuje místo fyzického smazání.
- GitHub linking/installation ze Settings se otevírá v samostatném bezpečném
  okně a původní aplikace po návratu fokusu automaticky obnoví stav; login flow
  zůstává top-level redirect. Organization setup ověřuje installation proti
  krátkodobému GitHub user access tokenu a `/user/installations`.
- Dokončen explicitní repository contract: aditivní migrace, immutable provider
  ID, mutable souřadnice, default branch, installation binding a jeden
  `ScmRepositoryRef` pro import/CI/reconcile/deploy/archive/delete. Test pokrývá
  rename dohledaný podle ID i delete webhook s legacy fallbackem.
- Lokální existující Docker DB úspěšně aplikovala
  `20260717232000_project_scm_identity` i
  `20260718120000_github_installation_authorization`; tři původní projekty zachovaly URL a
  startup jim doplnil reálná Gitea ID 5/9/15. Health i nepřihlášený browser
  smoke jsou zelené. Autentizovaný browser acceptance nebyl možný, protože
  lokální `deploy/.env` je v `saas` edici bez nakonfigurované GitHub App.
- Neprovedeno: autentizovaný browser acceptance ani živý GitHub App E2E.
  Public SaaS proto zatím není produkčně dokončený profil.

### GitHub user-token vault podkrok Fáze 3 (2026-07-20)

- Aditivní migrace rozšířila externí identitu o šifrované provider credentials,
  expirace, verzi a refresh lease; existující identity i Gitea tok nemění.
- GitHub OAuth parsuje expirační metadata a rotuje celý access/refresh pair.
  Login a link jej uloží až po shodě immutable GitHub ID; organization setup
  použije user token jen v paměti.
- Součběžné API instance koordinuje databázový lease, proto stejný single-use
  refresh token nemohou spotřebovat dvakrát. Revokační webhook credential maže
  podle immutable sender ID, propojení identity ale zachová.
- Tento podkrok nemá novou obrazovku. Uživatelsky lze regresně zopakovat
  GitHub login/link a organization install; plný test rotace/revokace bude
  viditelný v následujícím osobním create toku.
- Ověřeno: 34 API suites / 202 testů, API production build, Prisma validate,
  aplikace migrace `20260720160000_github_user_credentials` na existující lokální
  databázi a zdravý restart kontejneru.

### GitHub repository provision podkrok Fáze 3 (2026-07-20)

- Provider zakládá soukromé osobní i organizační repo přes credential
  odpovídající konkrétní operaci a vrací immutable repository ID + installation
  binding. Při chybě Actions secrets nebo push provede rollback repozitáře.
- Scaffold push nepersistuje installation token do remote URL ani `.git/config`.
  GitHub varianta workflow používá `.github/workflows` a automatický
  `GITHUB_TOKEN` pro GHCR; Gitea šablona zůstává beze změny.
- Ověřeno automatizovaně: personal/org credential selection, workflow
  transformace, rollback a stávající read/write operace; celkem 34 suites /
  207 testů a API production build.
- V okamžiku tohoto adapterového commitu ještě neexistoval UI tok; následující
  routing podkrok jej již zapojil do New project/import.

### SCM routing a GitHub create/import podkrok Fáze 3 (2026-07-20)

- Edice je produktové rozhodnutí, ne volba v projektu: self-hosted create/import
  používá Gitea, SaaS GitHub. New project v SaaS zobrazuje osobní/organizační
  instalace autorizované pro aktivní workspace a API jejich grant ověří znovu.
- Projektové operace po vytvoření vybírají adapter z uloženého provideru:
  reconcile, CI callback, commity a GitHub Check Runs, retry tag, archiv,
  synchronizace rolí, package cleanup a repository delete/detach. CI callback
  rozliší případně stejný full name per-project tajemstvím, ne vstupem od CI.
- Import vylistuje repozitáře ze všech aktivních instalací workspace, deduplikuje
  immutable ID a serverově opakuje preflight. Non-static runtime vyžaduje
  Dockerfile; provider musí mít kompatibilní `.gitea/workflows/ci.yml` nebo
  `.github/workflows/ci.yml` s InitPad callbackem. Import zdrojový kód nemění.
- UI ukazuje chybějící GitHub link/instalaci, suspend a nutnost obnovit starší
  OAuth credential; Settings nabízí bezpečný popup pro obnovení autorizace.
- Ověřeno: 35 API suites / 215 testů, API i web production build, compose config,
  rebuild běžících API/web kontejnerů, health a nepřihlášený SaaS browser smoke.
  Test výslovně odmítá instalaci z cizího workspace. Živý autentizovaný create/
  import a organizace se musí provést proti skutečné GitHub App.
- Historický otevřený bod tohoto commitu: workflow pushovalo privátní image do GHCR pomocí
  repository-scoped `GITHUB_TOKEN`, ale control plane tento token nemá. GitHub
  registry pro externí pull oficiálně očekává PAT classic nebo `GITHUB_TOKEN`;
  dlouhodobý uživatelský PAT proto do platformy nepřidáváme. Následující návrh
  musí zvolit managed OCI registry s projektově omezenými credentials, nebo
  agent-mediated artifact transport. Lokální větev byla následně vyřešena
  GitHub artifact handoffem níže; durable multi-instance storage/agent zůstává.

**Uživatelský test tohoto podkroku.** V SaaS se přihlásit přes GitHub, v Settings
autorizovat osobní App instalaci, otevřít New project, zkontrolovat vybraného
ownera a vytvořit unikátně pojmenované repo. Na GitHubu ověřit private repo,
`.github/workflows/ci.yml`, Actions secrets a první run; v InitPadu ověřit URL,
commity/check runs a možnost Run again. V týmovém workspace zopakovat pro
organizaci; member nesmí instalaci přidat, ale smí použít již udělený workspace
grant podle role. Import testovat jedním kompatibilním repem a dvěma negativními
variantami bez Dockerfile a bez InitPad workflow. Nakonec zvolit detach i úplné
smazání a ověřit, že jiné workspace stejnou instalaci bez grantu nepoužije.

### Provisioning effect journal podkrok Fáze 3 (2026-07-20)

- Aditivní `ProvisioningEffect` zapisuje intent před create/import mutací a
  rozlišuje `planned`, `applying`, `applied`, `failed`, `compensated` a
  `compensation_failed`. Projektový detail u neúspěchu vypíše jednotlivé efekty.
- Create journaluje repozitář, každého collaboratora a databázový projekt;
  selhání journal transition po úspěšném provider API nově také spustí cleanup.
- Import registruje kompenzaci ještě před zápisem secrets, ukládá původní
  přímou provider roli a rollback provádí v opačném pořadí. GitHub teamovou
  zděděnou roli nikdy neobnoví jako direct grant.
- Projektový záznam se po chybě smaže jen při úplné externí kompenzaci.
  Výpadek cleanupu jej zachová jako recovery handle s `cleanup required`.
- Startup reconciliation stavů `applying`, workspace přehled operací a
  idempotentní retry/cleanup dokončuje následující podkrok níže.

**Uživatelský test tohoto podkroku.** Běžný create i import musí proběhnout
beze změny. Pro viditelnou chybovou větev dočasně znepřístupnit provider během
cleanup importu: projekt musí zůstat v dashboardu, detail ukázat `cleanup
required` a Delete project se zachováním repozitáře musí po obnovení provideru
umožnit recovery. Bezpečnější opakovatelná varianta je automatizovaný failure-
injection test, který ověřuje úplný rollback i zachování cleanup dluhu.

### Provisioning recovery a idempotent retry podkrok Fáze 3 (2026-07-20)

- Persistuje se validovaný request bez credentials, iniciátor, attempt a
  `retryOfId`; staré auditní operace bez requestu zůstávají pouze ke čtení.
- Process lease odliší živou operaci od pádu. Expirované `running`, `cleaning`
  nebo `retrying` přejde na `interrupted`; nejasný efekt na
  `reconciliation_required`, nikdy rovnou do retry.
- Workspace endpoint a Dashboard zobrazí poslední operace včetně create bez
  Project ID. Stav se obnovuje po 15 sekundách.
- `Retry cleanup` je CAS + lease operace pro maintainer/owner. Import obnoví
  původní direct role a odstraní platformní secrets; create smaže repo podle
  journal identity. Všechny kroky jsou opakovatelné a Project se smaže poslední.
- `Retry setup` je dostupný jen původnímu iniciátorovi, po prokázané kompenzaci
  a maximálně pětkrát. Nový attempt + retired predecessor vzniknou atomicky.
- Otevřený bod Fáze 3 již není provisioning recovery ani private-GHCR pull.
  Ověřený lokální artifact handoff je hotový; zbývá durable storage/agent
  delivery pro veřejný SaaS a následný živý GitHub E2E.

**Uživatelský test tohoto podkroku.** Na importu vyvolat chybu Secrets API.
Po úplném rollbacku musí Dashboard ukázat `Retry setup`; po neúspěšném
rollbacku `Retry cleanup` a zachovaný projekt. Po obnovení provideru kliknout
cleanup, ověřit odstranění projektu a odemčení setup retry. Tentýž účet
smí založit attempt 2, jiný member ne; maintainer smí cleanup, viewer/member
nikoli. Pád procesu a dvojitý claim se testují automatizovaně, aby acceptance
nemusel destruktivně ukončovat lokální API.

### GitHub artifact handoff podkrok Fáze 3 (2026-07-20)

- GitHub workflow již nepushuje nový build do private GHCR. Jednou vytvořenou
  a otestovanou image uloží jako přímý immutable `initpad-image.tar` artifact;
  upload action je pinovaný plným commitem a retention je jeden den.
- Callback předává ID a digest. GitHub provider přes workspace installation s
  `Actions: read` ověří repository ID, run, commit SHA, název, expiraci,
  velikost i metadata digest; stažené bajty znovu SHA-256 ověří.
- `BuildArtifact` persistuje identitu a lifecycle. Lokální prototyp zkontroluje,
  že Docker archive obsahuje jen očekávaný tag, načte jej do daemonu a deployuje
  bez GHCR pullu nebo rebuildu. Ingestion je background operace, callback tedy
  nečeká na přenos velké image.
- Tag obsahuje commit + workflow run ID a deployment/environment ukládají přesné
  BuildArtifact ID. UI ukazuje zkrácený SHA-256 digest; promotion proto dokáže
  prokázat stejný build i při dvou CI runs stejného commitu.
- Duplicate callback je no-op, přerušená ingestion se po restartu označí failed
  a Run again bez skutečně dostupné lokální image spustí nový CI run.
- Import GitHub repa se starým callbackem je zablokovaný s konkrétním varováním.
  Gitea registry flow se nezměnil.
- Ověřeno lokálně: 42 API suites / 246 testů, API i web production build,
  compose rebuild, aplikované migrace `20260720220000_build_artifact_handoff`
  a `20260720230000_deployment_artifact_binding`, healthy API a login UI smoke.
  Zbývá živý test proti skutečné App.

**Uživatelský test tohoto podkroku.** GitHub App nastavit `Actions: Read-only`
a přijmout změnu instalace. Založit nový projekt; v Actions zkontrolovat upload
`initpad-image.tar` a callback, v InitPadu přechod přes `Downloading and
verifying tested image` do zeleného dev. Karta prostředí ukáže `build <digest>`;
promote do test musí zachovat stejné artifact ID/digest i SHA. Ruční callback s
jiným artifact ID/digest/SHA musí vrátit 400. Staré repo
bez artifact handoff se nesmí dát importovat. Produkční object-store/agent test
patří až do milníku 7.

### Průběžné ověření delivery části milníku 8

- React/Vite produkce byla na ESO nasazena z CI-tested nginx artefaktu bez
  spuštění `npm ci` v API; veřejná aplikace odpovídala.
- Nette produkce odpověděla na čisté URL HTTP 200; soukromý `composer.json` a
  runtime security probe vracely HTTP 403.
- Po HTTP požadavku, který vytvořil frameworkovou cache, druhý redeploy znovu
  skončil `running` bez permission chyby.
- Jeden legacy release s již cizím vlastnictvím byl přesunut do chráněné
  karantény; jeho fyzické odstranění zůstává jednorázovým úkolem správce ESO.
- Reálný částečný teardown odstranil veřejnou Nette aplikaci, přesunul
  cizí runtime cache do chráněné karantény a v UI správně zobrazil `empty`,
  konkrétní cleanup cesty, `Retry cleanup` a explicitní volbu pro odstranění
  project record se zachováním administrátorského dluhu.

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
