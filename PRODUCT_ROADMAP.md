# InitPad — produktová a implementační roadmapa

## Cílový produkt

InitPad bude mít jeden kód a dva podporované provozní režimy:

| Režim | Control plane | Workloady | Použití |
|---|---|---|---|
| Self-contained | u uživatele, včetně Gitey a CI | lokální simulovaná infrastruktura | diplomkové demo, offline laboratoř, malý tým |
| Hosted / school | veřejný InitPad | školní nebo uživatelské servery | předměty, studentské týmy, BYOS malé firmy |

Veřejný režim není hosting aplikací. InitPad hostuje řízení, identity, metadata a
deployment workflow; aplikace běží na targetech školy nebo uživatele. Studenti
nemusejí kupovat VPS — učitel jim může přidělit kapacitu ze školního target
poolu. Detailní rozhodnutí je v ADR-027.

## Hlavní hodnota

InitPad není obecný serverový panel. Je to opinionated developer platform:

- nový projekt ze zkontrolované golden-path šablony nebo import existujícího repa;
- týmové vlastnictví, role a školní předměty;
- automatický build/test a dohledatelný artefakt;
- řízený tok dev → test → prod nad heterogenní infrastrukturou;
- přidělení prostředí bez předání serverových credentials studentům;
- stejný produkt pro školní infrastrukturu i server přinesený uživatelem.

## Povinné MVP pro diplomovou práci

MVP je hotové, když lze na jedné veřejně dostupné instalaci prokázat tento tok:

1. učitel založí předmět a publikuje školní target pool;
2. studenti se přes pozvánku zaregistrují a vytvoří tým;
3. tým vytvoří projekt ze šablony nebo importuje existující Gitea repo;
4. CI postaví a otestuje jediný verzovaný artefakt;
5. dev se automaticky nasadí na školní Docker target přes agenta;
6. stejný artefakt se povýší do testu;
7. prod vyžádá schválení učitele/maintainera a nasadí se na oddělenou ESO cestu;
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

### Fáze 1 — tenancy: workspaces a role

**Datový model**

- `Workspace` typu personal/team/school.
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
- Viditelné označení osobního, týmového a školního projektu.

### Fáze 2 — školní model a onboarding

- `Course`, instruktoři, enrollment kód/pozvánka a studentské týmy.
- Veřejná registrace s ověřením e-mailu; školní členství jen přes pozvánku/kód.
- Učitel může tým vytvořit, uzamknout členství a odebrat přístup.
- Serverový režim dostane bezpečný reset hesla a ochranu proti automatizovanému
  zneužití; self-contained režim může zůstat jednodušší.

### Fáze 3 — existující repozitáře

- SCM rozhraní oddělí seznam repozitářů, import, secrets, webhooky a archivy.
- První implementace importuje existující Gitea repo dostupné uživateli.
- Import nikdy nepřepisuje aplikační kód; uživatel zvolí template/runtime contract
  a uvidí preflight kontrolu Dockerfile, workflow, health endpointu a branch.
- Platforma vytvoří pouze svůj projektový záznam, environmenty, per-repo CI
  secret a volitelný onboarding pull request/workflow po explicitním potvrzení.
- GitHub App a GitLab provider následují za diplomkovým Gitea E2E.

### Fáze 4 — target pool a allocations

- Fyzický `Target` spravuje škola, firma nebo uživatel.
- `TargetAllocation` přiděluje omezený výsek targetu workspace/týmu a prostředí.
- Allocation nese capabilities, root path/namespace, public URL, kvótu a policy.
- Učitel může pool publikovat, přidělovat a odebírat bez odhalení credentials.
- ESO test/prod používají oddělené cesty a konfigurace na stejném fyzickém hostu.

### Fáze 5 — InitPad Agent

- Jednorázový enrollment token sváže agenta s fyzickým targetem.
- Agent navazuje pouze odchozí HTTPS/WSS spojení, posílá heartbeat a capabilities.
- Control plane ukládá durable job; agent si jej pronajme, průběžně obnovuje lease,
  streamuje logy a publikuje výsledek.
- Agent stahuje image podle neměnného digestu, vynucuje allocation, resource limity,
  síť a naming; control plane už nepotřebuje host Docker socket.
- Odpojení agenta operaci neztratí: lease vyprší a job lze bezpečně zopakovat.

### Fáze 6 — jednotný delivery tok

- CI produkuje OCI image nebo archiv a jeho digest/SHA.
- Automatický deploy do dev, ruční promotion do testu a approval do prod.
- Docker agent spouští OCI image; ESO provider nahraje tentýž extrahovaný PHP či
  statický artefakt do přidělené cesty.
- Destruktivní akce a prod promotion ukazují target, verzi a dopad.
- Rollback vybírá předchozí úspěšný artefakt, nic znovu nestaví.

### Fáze 7 — učitelský provoz

- Dashboard předmětu: týmy, projekty, CI, aktivní allocations a poslední deploy.
- Approval pravidla, termíny, kvóty CPU/RAM/disk a automatický teardown po kurzu.
- Audit log registrace, změn členství, target assignmentů, promotion a mazání.
- Export výsledků pro vyhodnocení předmětu bez přístupu ke zdrojovému kódu navíc.

### Fáze 8 — hardening a vyhodnocení

- Threat-model review pro každou tenant boundary a agent protocol.
- E2E test nejméně se dvěma workspaces, aby se ověřila izolace.
- Restore drill, výpadek agenta během deploye a retry bez dvojitého spuštění.
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
