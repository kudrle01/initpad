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
- týmové vlastnictví, workspaces, pozvánky a role;
- automatický build/test a dohledatelný artefakt;
- řízený tok dev → test → prod nad heterogenní infrastrukturou;
- přidělení prostředí bez předání serverových credentials studentům;
- stejný produkt pro školní infrastrukturu i server přinesený uživatelem.

## Povinné MVP pro diplomovou práci

MVP je hotové, když lze na jedné veřejně dostupné instalaci prokázat tento tok:

1. správce nebo owner založí týmový workspace a publikuje target pool;
2. uživatelé se normálně zaregistrují nebo dostanou self-hosted účet a přijmou pozvánku;
3. tým vytvoří projekt ze šablony nebo importuje existující Gitea repo;
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

### Fáze 2 — identity a workspace onboarding — dokončeno (mimo GitHub login/link)

- Jediný organizační model tvoří workspaces a role; žádný zvláštní `Course` login.
- Public SaaS má normální registraci a později GitHub login/link.
- Workspace owner/admin zve existující i dosud neregistrované uživatele a přidělí roli.
- Self-hosted správce volí `open`, `invite-only` nebo `admin-provisioned`, spravuje
  uživatele a vydává jednorázové dočasné přihlašovací údaje s vynucenou změnou hesla.
- Ochrana proti automatizovanému zneužití, ověření e-mailu a bezpečný reset hesla.

Implementováno (ADR-040, zjednodušeno v ADR-042): registrační politika se
dvěma režimy (`open` veřejně / `admin-provisioned` soukromě) s bezpečným
first-user bootstrapem; stavové session s generací tokenu (deaktivace i reset
zneplatní staré session); platform-admin API a UI pro seznam/vytvoření/
deaktivaci/reset uživatelů s jednorázovým dočasným heslem NEBO aktivačním
odkazem (uživatel si nastaví vlastní heslo a je přihlášen); přidávání do týmu
jen pro existující účty podle username/e-mailu; ověření e-mailu a neenumerující
reset hesla. GitHub login/link a `ScmProvider` adapter jsou ve Fázi 3.

### Fáze 3 — existující repozitáře — rozpracováno

Hotový základ (ADR-041): rozhraní `ScmProvider` s DI tokenem `SCM_PROVIDER`,
Gitea jako jeho adapter a projektová doména napojená na rozhraní; model
`ExternalIdentity` vázaný na neměnné provider ID; `GitHubAppService` pro ražení
krátkodobých installation tokenů s minimálními oprávněními; GitHub OAuth flow
(sign-in/link přes immutable ID) s CSRF ochranou a UI (Continue with GitHub,
propojení účtu v Settings); `GitHubInstallation` evidence instalací synchronizovaná
podepsanými webhooky, ražení tokenu pro konkrétního ownera a status/preflight
endpoint s „Install GitHub App" v UI — vše inertní bez nakonfigurované App.

Import existujícího repozitáře (přes `ScmProvider`, zatím Gitea): `listRepositories`
a `readFile` na rozhraní; `GET /projects/import/repos` (repa uživatele, označená
už-importovaná), `POST /projects/import/preflight` (kontrola default branch,
Dockerfile, runtime kontraktu, kolize jména, prázdné repo) a `POST /projects/import`
(vytvoří projektový záznam nad existujícím repem bez přepsání kódu, nakonfiguruje
per-repo CI secret, prostředí startují `empty`, rollback DB delete při chybě) +
UI stránka Importu. Import kód nikdy nepřepisuje.

Persistentní `ProvisioningOperation` (audit + krok validate → repository → ci →
done) pro create i import: import zaznamenává celou sekvenci kroků, create je
obalen kolem nezměněného `createInternal`; zápis je best-effort a nikdy nemění
výsledek. `GET /projects/:id/provisioning` a banner na detailu projektu, když
setup neskončil úspěšně.

GitHub-only účet: `User.giteaId` je volitelný a při prvním přihlášení přes GitHub
v edici `saas` se založí účet z GitHub identity (bez Gitea, s propojenou
identitou a osobním workspace); e-mail se nikdy neslévá s existujícím účtem.
V self-hosted edici GitHub slouží jen k propojení existujícího účtu.

GitHub `ScmProvider` adapter: `GitHubScmProvider` implementuje rozhraní. Čtecí
operace (`listRepositories`, `readFile`, `repoMissing`, `listCommits`,
`listCommitStatuses`) i čistě‑HTTP zápisové operace (`deleteRepo`, `detachRepo`,
set/removeCollaborator s mapováním role→permission, createRetryTag/deleteTag,
GHCR `deletePackages`, `issueCloneToken` = installation token) běží na
krátkodobých installation tokenech podle ownera. `ScmRegistry` vybírá gitea|github
za stejným rozhraním.

Zbývá (živá GitHub App): `provision` (create repo + push scaffoldu),
`configureRepoSecrets` (Actions secrets šifrované libsodium sealed‑boxem) a
`downloadArchive`; a napojení create/import na `ScmRegistry` podle zdroje. Tyto
operace se neručně‑nešifrují a jsou jasně označené `not implemented`. GitLab až potom.

- SCM rozhraní oddělí seznam repozitářů, import, secrets, webhooky a archivy.
- První implementace importuje existující Gitea repo dostupné uživateli.
- Import nikdy nepřepisuje aplikační kód; uživatel zvolí template/runtime contract
  a uvidí preflight kontrolu Dockerfile, workflow, health endpointu a branch.
- Platforma vytvoří pouze svůj projektový záznam, environmenty, per-repo CI
  secret a volitelný onboarding pull request/workflow po explicitním potvrzení.
- Založení i import dostanou persistentní `ProvisioningOperation` s kroky
  validate → repository → render/preflight → CI configuration → first deploy;
  externí stav se nevytváří, dokud neprojde celý preflight.
- Template manifest se povýší na verzovaný blueprint contract. Projekt vždy
  odkazuje na konkrétní verzi; vlastní firemní blueprint repozitáře jsou až
  následné rozšíření.
- `ScmProvider` oddělí Giteu a GitHub od projektové domény. Self-contained profil
  dál používá Gitea Actions/registry; hosted profil zvolí GitHub App, GitHub
  Actions a GHCR jako výchozí cloudovou cestu.
- Jedna GitHub App zajistí dvě oddělené vazby: OAuth user authorization pro
  přihlášení/propojení identity a instalaci aplikace pro přístup k vybraným
  repozitářům, webhookům a krátkodobým installation tokenům.
- Přihlášení přes GitHub samo o sobě neuděluje přístup ke kódu. GitHub projekt
  lze vytvořit/importovat až po propojení účtu a nalezení odpovídající instalace;
  Gitea projekt ani prohlížení platformy se kvůli chybějícímu GitHubu neblokuje.
- Externí účet se váže přes neměnné GitHub user ID, nikdy automaticky jen shodou
  e-mailu. Propojení z existujícího účtu vyžaduje jeho aktivní session.
- GitHub App je další adapter po funkčním Gitea školním E2E. Návrh a permission
  model patří do diplomky, ale plná implementace nesmí blokovat ověření hlavního
  scénáře; GitLab následuje později.

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
| 4 — identity/onboarding | ano | Veřejně: samoobslužná registrace. Soukromě: admin vytvoří účet a pošle aktivační odkaz (uživatel si nastaví heslo a je přihlášen) nebo dočasné heslo s vynucenou změnou. Majitel přidá do týmu existující účet podle e-mailu; role platí i v SCM. |
| 5 — import repa/SCM | ano | Gitea: výběr repa a preflight bez změny kódu. Cloud: GitHub login/link, instalace App pro vybrané repo, create/import; odvolání instalace zablokuje další SCM operace, ne účet. |
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

Implementováno podle ADR-040 a ověřeno API unit testy (registrační politika,
stavový guard, platform-admin, pozvánky, reset/verifikace) i typecheckem obou
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
