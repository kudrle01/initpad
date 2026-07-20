# InitPad — aktuální handoff pro dalšího implementátora

Toto je pracovní zadání pro Claude během nepřítomnosti uživatele. Pokračuj
autonomně, ale pouze v pořadí a hranicích níže. Nejdřív přečti `AGENTS.md`,
`DECISIONS.md` (zejména ADR-027–030, ADR-039, ADR-042–049 a ADR-051–058) a
`PRODUCT_ROADMAP.md`. Pokračuj po malých atomických commitech, neupravuj Git
historii a zachovej existující data. Tvrzení „hotovo“ musí být podložené testem;
existence rozhraní, nepoužívaného registru nebo samotného modelu nestačí.

## Výchozí stav předání

- Výchozí code/docs baseline před tímto handoff commitem je
  `761c89f docs: record explicit GitHub job reruns`; implementační commit
  bezprostředně před ním je `a3fe555`.
- Baseline je 45 API suites / 281 testů, API build a web production build
  zelené. API/web image jsou lokálně přestavěné a API bylo healthy.
- Worktree byl čistý kromě uživatelského neversionovaného souboru
  `VYSVETLENI_zmen.md`. Neupravuj, nemaž ani necommituj jej bez výslovného
  pokynu uživatele.
- `deploy/.env` používá `INITPAD_EDITION=saas`, ale compose callback zůstává
  `INITPAD_PUBLIC_URL=http://localhost:8080`. To není adresa dostupná z GitHub
  hosted runneru. Pro compose se nastavuje `INITPAD_PUBLIC_URL`; proměnná
  `INITPAD_PLATFORM_PUBLIC_URL` je přímý runtime vstup API, který compose z
  první proměnné naplní.
- GitHub App instalace osobního účtu `kudrle01` byla živě propojena. Nelze
  předpokládat, že vlastník už změnil maximum App permission na
  `Actions: Read and write` a schválil update instalace.

### Pravidla práce během předání

- Velké rozhodnutí nejprve zapiš jako další ADR; potom implementace, testy a
  zvlášť dokumentační commit. Každý dokončený podkrok musí mít vlastní commit.
- Zachovej self-hosted Gitea cestu. Public SaaS používá GitHub; nepřidávej SaaS
  Giteu, GitLab, uživatelský PAT classic ani private-GHCR pull.
- Nespouštěj destruktivní Docker cleanup, nemaž volumes/databázi/repozitáře a
  neměň skutečnou GitHub App či cizí servery bez přítomnosti nebo výslovného
  souhlasu uživatele.
- Agent nikdy nesmí přijmout libovolný shell. Nepřidávej Kubernetes, billing,
  SMTP ani marketplace před dokončením níže uvedeného vertikálního řezu.
- Po každém milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` i tento
  handoff, včetně přesného automatizovaného a uživatelského testu.

## Závazný produktový model

- Žádná `Course` doména ani `Join course`; škola je use case nad workspaces.
- Autorizační hranice je `Workspace` + `WorkspaceMember`.
- Self-hosted: vestavěná Gitea a `open` nebo `admin-provisioned` onboarding.
- Public SaaS: GitHub login, GitHub App a GitHub Actions; bez SaaS Gitey a bez
  vlastních hesel InitPadu. Nový workflow používá ověřený Actions artifact
  handoff (ADR-049), ne uživatelský PAT ani private-GHCR pull.
- GitHub App instalace je podmínka create/import repozitáře, ne vytvoření účtu.
- Do týmu se přidávají existující účty podle username/e-mailu; tokenové
  workspace pozvánky byly odstraněny v ADR-042.

## Co je skutečně dokončeno

- Workspaces/RBAC, edition-aware identity lifecycle, platform-admin správa
  self-hosted účtů, aktivační odkazy, forced password change, reset/verifikace
  a přidání existujícího účtu do týmu se synchronizací Gitea collaboratora.
- `ScmProvider` + `ScmRegistry`; edice určuje create/import provider a každý
  existující projekt následně používá adapter ze své uložené SCM identity.
- Explicitní SCM identita projektu: provider, immutable repository ID,
  owner/name/full name, default branch a installation binding. Import vybírá
  podle ID; CI/reconcile/archive/deploy/delete používají `ScmRepositoryRef`.
  Legacy Gitea řádky dostanou bezpečný backfill a provider reconciliation.
- Import Gitea/GitHub repozitáře: seznam všech workspace grantů, serverový
  preflight, import bez přepsání kódu, per-repo CI secret, prostředí `empty` a
  základní `ProvisioningOperation`. Non-static vyžaduje Dockerfile a každý
  provider kompatibilní InitPad workflow.
- GitHub OAuth sign-in/link podle immutable user ID, CSRF state+nonce,
  `ExternalIdentity`, podepsané installation webhooky a krátkodobé tokeny.
- GitHub App setup podle ADR-044: immutable installation account ID, osobní/
  organizační účet, hashovaný single-use state, serverové ověření callbacku,
  owner/admin re-check a explicitní user/workspace grant. Rename zachová vazbu;
  uninstall je auditní tombstone a zablokuje token. Osobní instalace má
  bezpečný recovery tok pro případ, že GitHub nevyvolá Setup callback:
  platný pending state + owner/admin + shoda immutable GitHub user ID; pro
  organizace se tento fallback nepoužívá. Organizace prochází user-bound OAuth
  kontrolou `/user` + `/user/installations`; krátkodobý token se neukládá.
- `GitHubScmProvider` obsahuje čtecí i write/provision operace. Osobní create
  používá rotovatelný šifrovaný user credential, organization create a další
  operace krátkodobé installation tokeny. Adapter umí bezpečný scaffold push,
  rollback nového repa, sealed-box Actions secrets, archiv, collaborators,
  retry tag, delete/detach/packages a GitHub Actions workflow runs/jobs;
  Check Runs jsou pouze kompatibilní fallback.
- GitHub build handoff persistuje `BuildArtifact`; operation token s `Actions: read`
  ověřuje repository/run/commit/digest, stažení znovu hashujeme a Docker archive
  smí obsahovat jediný očekávaný tag. Lokální control plane image ingestuje a
  deployuje bez GHCR. Deployment i Environment váže přesné artifact ID a UI
  ukazuje digest; duplicate/restart/retry větve jsou explicitní. Ruční Deploy
  nejprve obnoví hotový artifact pro přesný commit; bez něj a bez veřejné HTTPS
  callback URL nevytvoří další předem nefunkční Actions run (ADR-053).
  Pipeline je vázaná na `providerRunId` skutečně nasazeného artifactu.
  Provider-native `deploy` job a InitPad `publish` jsou samostatné stage:
  první zachová přesný SCM stav/URL, druhá vede do deployment historie stejně
  jako environment status. Recovery proto může ukázat failed handoff i
  successful publication bez nového runneru (ADR-054 a ADR-057).
  Pokud chce uživatel opravit i failed GitHub audit, dev Tools má explicitní
  `Re-run failed GitHub jobs`: používá přesný artifact run, latest attempt,
  předem obnoví veřejný callback secret a vyžaduje App repository permission
  `Actions: read/write` bez Organization/Account permission (ADR-058).
  Aktuální CD průběh je samostatná inline Deployment activity s immutable
  target snapshotem; deploy ověřeného artifactu záměrně nespouští nový runner
  (ADR-055). Detail ukazuje bounded náhled a samostatné commit/deployment
  historie; source CI run je v deployment activity deduplikovaný (ADR-056).
- Create/import zapisuje před každým ne-transakčním zásahem durable
  `ProvisioningEffect`. Import při chybě odstraní platformní secrets, obnoví
  původní přímou Gitea/GitHub collaborator roli a smaže Project jen po úplné
  kompenzaci; jinak jej ponechá viditelný s `cleanup required` efektem.
- Provisioning recovery má process lease, `interrupted/reconciliation_required`
  stavy, workspace-wide Dashboard seznam, maintainer CAS cleanup a nejvýše pět
  idempotentních setup pokusů. Retry vidí pouze původní iniciátor a až po
  prokázané kompenzaci; vznik attemptu a retirement předchůdce je transakční.
- New project v SaaS nabízí aktivní osobní/organizační instalace aktuálního
  workspace; API cizí installation ID znovu odmítne. Chybějící/legacy OAuth
  credential má v Settings „Renew authorization“. Self-hosted UI zůstává Gitea.
- PHP frameworky preferují ověřený workspace SFTP/PHP target pro prod.
  Skrytý static-only target je v New project/target pickeru vysvětlen jménem;
  capability lze bezpečně přidat i za provozu, ne odebírat. Inline odkazy
  mají jednotný zelený affordance včetně ikon (ADR-050).
- GitHub odkazy jsou provider-aware a GitHub CI používá oddělenou veřejnou
  HTTPS callback URL. SaaS odmítne localhost/private callback před vytvořením
  repa, skryje self-hosted built-ins a vyžaduje explicitní verified target pro
  dev/test/prod. Lokální/private Docker připojí až Agent (ADR-051).
- Audit 2026-07-17 opravil: native auth v SaaS, automatického prvního SaaS admina,
  odpojení poslední použitelné identity, ověření GitHub e-mailu, atomický claim
  jednorázových tokenů, oddělení platformního hesla od lokálního hesla Gitey a
  OIDC kontrolu deaktivace/session generation/forced-change před Gitea SSO.

## Co dokončeno není

- Není dokončen živý GitHub E2E po ADR-058. Dokud compose používá localhost,
  `Re-run failed GitHub jobs` se musí zastavit před externí mutací; nesmí se
  obcházet ani vydávat za chybu status fetchování. Existující App navíc musí
  mít repository `Actions: Read and write`, zatímco Organization a Account
  permissions zůstávají prázdné, a vlastník musí update instalace schválit.
- Ověřený artifact je zatím po stažení uložen pouze v Docker daemonu jednoho
  control-plane hostu. Pro multi-instance SaaS doplň platformní object storage,
  retention/GC a job-scoped presigned download pro agenta; GitHub artifact není
  dlouhodobé úložiště. Nepřidávej uživatelský PAT classic (ADR-049).
- Neexistuje `TargetAllocation`: dnešní Environment míří přímo na fyzický
  Target. Před multi-tenant Agentem je nutné oddělit server/credentials od
  workspace namespace, cest, URL, capabilities a kvót (Fáze 4, ADR-027/029).
- Neexistuje InitPad Agent, enrollment, agent identity, heartbeat ani durable
  leased job queue. Control plane proto stále potřebuje lokální Docker socket.
- Neexistuje reálný public-SaaS deploy profil bez Gitey.
- Není připojený SMTP/e-mail provider. Self-hosted odkazy v UI/logu jsou demo
  mechanismus, ne produkční důkaz vlastnictví e-mailu; SaaS ukládá jen GitHubem
  ověřenou adresu.

## Nejbližší implementační pořadí

### 0. Externí GitHub acceptance pouze při splněných předpokladech

Tento krok neblokuje lokální implementaci. Proveď jej jen pokud uživatel
zpřístupnil veřejný HTTPS InitPad a schválil GitHub App permissions:

1. GitHub App repository `Actions: Read and write`; Organization/Account nic.
2. V compose `deploy/.env` nastav `INITPAD_PUBLIC_URL=https://...`, ne
   `INITPAD_PLATFORM_PUBLIC_URL`. Callback `/api/ci/deploy`, OAuth callback,
   Setup URL a Webhook URL musí být z internetu dosažitelné podle ADR-044/051.
3. Restartuj API/web, ověř `GET /api/scm/github/status` a až potom spusť dev
   Tools → `Re-run failed GitHub jobs` u recovery projektu. Stejné run ID musí
   dostat nový attempt a nové job ID; `deploy` se synchronizuje přes
   `filter=latest`, `publish` zůstane samostatný.
4. Dokonči personal i organization create/import, rename, suspend/uninstall,
   role a delete/detach. Zapiš skutečné výsledky; co nebylo živě spuštěno,
   nesmí být označeno za ověřené.

Pokud předpoklady chybí nebo uživatel není přítomen, nic externě neměň, zapiš
blokátor a pokračuj bodem 1.

### 1. Hlavní úkol: durable artifact object storage

Nejdřív vytvoř ADR-059 a až potom implementuj tento kompletní vertikální řez:

1. Zaveď provider-neutral `ArtifactStore`. Produkční kontrakt je privátní
   S3-compatible storage; lokální compose použije MinIO a cloud může použít S3
   bez změny projektové domény. Doporučené balíčky jsou
   `@aws-sdk/client-s3` a `@aws-sdk/s3-request-presigner`.
2. Přidej explicitní config: endpoint, region, bucket, access/secret key,
   path-style, presign TTL a retention. SaaS nesmí tiše spadnout na lokální
   filesystem ani veřejný bucket. Secrety nepatří do Git historie ani logů.
3. Object key musí být tenant/project/artifact scoped, odvozený z immutable
   interních ID a digestu, nikdy z uživatelské cesty. `storageRef` zůstane
   opaque key, ne veřejná URL.
4. Odděl validaci Docker archive identity od `DockerProvider`, aby bezpečnostní
   kontrola fungovala i v control plane bez Docker socketu. Do object store se
   smí označit jako available pouze artifact, který prošel provider metadata,
   SHA-256 skutečných bajtů a kontrolou jediného očekávaného image tagu.
5. Upload streamuj ze soukromého temp souboru. Stav musí být atomický:
   `accepted → ingesting → available`; `storageKind=object-store` a `storageRef`
   nastav až po úspěšném put/head ověření. Chyba odstraní částečný objekt a
   skončí `failed` s bezpečnou zprávou. Žádné celé image v RAM.
6. Zachovej současný lokální Docker acceptance: po uložení lze ze stejného
   ověřeného souboru image načíst do daemonu. Když daemon po restartu image
   nemá, Run again/redeploy ji musí rehydratovat z object store, znovu ověřit
   digest/manifest a teprve potom nasadit. `storageRef` už nesmí být zaměňován
   za Docker image ref; image ref odvozuj samostatně.
7. Implementuj mazání/retention/GC bez smazání artifactu stále referencovaného
   Environmentem nebo aktivní DeploymentOperation. Project delete musí mít
   idempotentní externí cleanup; selhání storage se nesmí vydávat za úspěšné
   smazání. Politiku a kompromisy popiš v ADR.
8. Přidej krátkodobý job-scoped presigned GET kontrakt pro budoucího Agenta.
   Nevytvářej obecný browser download endpoint a neukládej presigned URL do DB.

Povinné testy: fake/in-memory store pro unit testy, upload failure a partial
cleanup, checksum mismatch, manifest mismatch, rehydratace po chybějící lokální
image, idempotentní duplicate callback, GC reference protection, krátké presign
TTL a cross-tenant key isolation. Compose musí mít persistentní MinIO volume,
private bucket bootstrap a healthy API; nemaž existující Postgres/Gitea data.

Uživatelský test: nový GitHub build se uloží jako `object-store`, dev běží,
lokální Docker image se odstraní bez smazání objectu a `Redeploy verified build`
ji znovu obnoví. Dev → test musí zachovat stejné BuildArtifact ID/digest. Po
restartu API musí být artifact stále dostupný. Neověřuj to jen existencí DB
řádku; prokaž stažení a reálný deploy.

### 2. Až po zeleném object storage: TargetAllocation základ

Vytvoř ADR-060. Přidej aditivní `TargetAllocation`, který váže fyzický Target
na workspace a nese namespace/root path, public URL, capabilities, stav a
základní kvóty. Credentials zůstávají pouze u fyzického Targetu. Environment
má používat allocation; migrace/backfill musí zachovat existující projekty,
URL a ESO cesty. Owner/admin allocation spravuje, member ji může použít,
viewer pouze čte; cizí workspace dostane 403/404. Nezačínej Agent, dokud není
tenant isolation a uživatelský test dvou workspaceů zelený.

### 3. Potom InitPad Agent — jen jeden bezpečný Docker vertikální řez

Řiď se ADR-029. Implementuj jednorázový enrollment, hashovanou/rotovatelnou
agent identity, outbound HTTPS polling, heartbeat/capabilities a durable job s
lease, correlation ID a idempotency key. První hotový řez stačí
`DEPLOY_SERVICE`, `GET_SERVICE_STATUS` a `REMOVE_SERVICE`; obecný shell je
zakázaný. Job musí být allocation-scoped a artifact stahuje krátkodobým
presigned URL, znovu ověří digest a vynutí deterministický naming/resource
limity. Duplicitní doručení ani ztracená odpověď nesmí vytvořit druhý kontejner.

Teprve když skutečný dev deploy projde přes Agenta bez Docker socketu v API,
doplň STOP/START, health, rollback a omezené logy. Agent failure-injection musí
obsahovat offline stav, expiraci lease, duplicate claim a restart po úspěšném
Docker zásahu před potvrzením výsledku.

### 4. Nakonec skutečný SaaS profil

Vytvoř compose/deploy profil bez Gitey, act runneru a control-plane Docker
socketu. Používá GitHub, Postgres, object storage a Agent; ESO SFTP zůstává
přímý provider. Self-hosted profil se nesmí rozbít. GitLab, SMTP a další
adaptery jsou až následující práce a nesmí blokovat školní Gitea ani SaaS E2E.

## Ověření před dalším handoffem

- Aktuálně: 45 API suites / 281 testů, API build a web `tsc -b && vite build`
  jsou zelené. Compose config prošel; API/web kontejnery byly přestavěné a API
  je healthy bez modulárního DI cyklu.
- Lokální existující Docker DB migraci aplikovala úspěšně; tři legacy
  projekty zachovaly URL a dostaly reálná Gitea repository ID. Health a
  nepřihlášený browser smoke prošly. Aditivní migrace
  `20260720200000_provisioning_effect_journal` i
  `20260720210000_provisioning_recovery` jsou na stejné DB aplikované;
  přestavěné API je healthy. Na stejné DB je aplikovaná i migrace
  `20260720220000_build_artifact_handoff` i
  `20260720230000_deployment_artifact_binding`; API/web compose rebuild, ready
  health a nepřihlášený browser login smoke následně prošly.
- Stále je nutný úplný autentizovaný browser acceptance a živý GitHub App E2E.
  Lokální `deploy/.env` je `saas`; propojení identity a osobní instalace
  `kudrle01` byly uživatelsky ověřeny. Organizace zatím živě ověřena nebyla.
- Identity acceptance: self-hosted open/admin-provisioned onboarding, forced
  change, reset/deaktivace; v týmu přidej dva existující účty a ověř role v
  privátním SCM i tenant isolation.
- SaaS acceptance: GitHub-only login, žádný password formulář/API fallback,
  první účet zůstane běžný uživatel a poslední sign-in identitu nelze odpojit.
- GitHub installation acceptance se živou App: owner/admin spustí setup v
  osobním i týmovém workspace, member jej spustit nesmí; ověř user/org,
  rename, suspend/uninstall a odmítnutý replay callbacku. Setup URL je
  `/api/scm/github/setup/callback`.
- GitHub project acceptance: New project musí ukázat pouze granty aktivního
  workspace; ověř personal i organization repo, `.github/workflows/ci.yml`,
  Actions run a workflow jobs. Import bez Dockerfile nebo InitPad workflow musí
  zůstat zablokovaný. Nový projekt musí vytvořit `initpad-image.tar`, callback
  musí předat ID/digest a lokální dev nasadit stejné SHA. Staré workflow se
  automaticky nepřepisuje. Multi-instance/agent delivery zatím není produkční.
- Po browser testu odstraň dočasné účty, workspaces a repozitáře.
- U každého milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` a uveď, zda a
  jak je uživatelsky testovatelný.

### Povinné lokální ověření každého dokončeného podkroku

Spusť minimálně:

```bash
npm test --workspace @initpad/api -- --runInBand
npm run build --workspace @initpad/api
npm run build --workspace @initpad/web
cd deploy
docker compose config
docker compose build api web
docker compose up -d api web
docker compose exec -T web wget -qO- http://api:3000/api/health
```

Při přidání MinIO/Agenta ověř také jejich health a restart persistence. Pokud
Docker není v sandboxu dostupný, neobcházej to mockem a netvrď compose ověření;
uveď přesně, co nešlo spustit. Test count v handoffu aktualizuj až po plném
suite, ne podle cíleného specu.

### Jak práci zanechat uživateli / dalšímu agentovi

- Preferuj čistý worktree. Pokud musí zůstat rozpracovaný, vypiš každý změněný
  soubor, přesný nehotový invariant a poslední zelený commit.
- V závěru uveď commity v pořadí, migrace, nové env proměnné, automatické testy,
  co bylo opravdu nasazeno a samostatně co čeká na externí/user acceptance.
- Nezapočítávej `VYSVETLENI_zmen.md` do svých změn.
- Pokud dokončíš bod 1 dříve, pokračuj bodem 2. Nezačínej více velkých fází
  současně a nenechávej napůl object store i napůl Agenta.
