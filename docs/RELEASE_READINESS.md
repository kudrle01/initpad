# Release readiness a známá omezení

Stav dokumentu odpovídá vývojové verzi s kandidátem Agenta 0.13 a podepsaným
aktualizačním kanálem self-hosted platformy. Poslední veřejně přijatý Agent
zůstává 0.12.1. Seznam je záměrně otevřený: odděluje funkční prototyp od
tvrzení, že je služba připravená pro veřejný produkční provoz.

## Co je připravené

- Self-hosted instalace na jednom důvěryhodném hostu včetně Gitey, CI,
  databáze, artifact storage a zálohy/obnovy.
- Workspace RBAC, role synchronizované do SCM a automatizovaná dvou-workspace
  isolation matice.
- Dvanáct verzovaných šablon včetně Laravelu, Nette a Symfony.
- Immutable build artifact a promotion stejného digestu přes prostředí.
- Produkční approval, rollback, audit a bezpečné dialogy destruktivních akcí.
- Outbound Agent protokol s enrollmentem, rotací credentials, lease fencingem,
  diagnostikou, resource limity a stabilní gateway routou.
- Reprodukovatelná repository gate, immutable container references a první
  podepsané multiarch vydání Agenta 0.12.1.
- Podepsaný platformní release bundle, oddělený Supervisor, ověřený backup,
  postupný health-gated cutover a image rollback pro self-hosted instalaci.
- Strukturované redigované logy a korelace request → operation → Agent job
  → workload.
- PostgreSQL-backed per-IP a per-account rate limit sdílený všemi API
  replikami bez ukládání zdrojových identit.

## Blokátory veřejného SaaS

Veřejný SaaS zatím není release profil. Před připojením nedůvěryhodných
zákazníků musí být hotové alespoň:

1. acceptance instalace, rebootu, upgradu i rollbacku veřejně dostupného
   Agenta na čistém Linux hostu;
2. samostatný SaaS deployment profil bez vestavěné Gitey a lokálního
   object store;
3. živé end-to-end ověření GitHub OAuth, GitHub App instalace, osobního i
   organizačního repozitáře, Actions artifactu, rename/suspend/uninstall;
4. externí správa secretů a rotace produkčních credentials;
5. edge connection/volumetric ochrana a ověřená proxy topologie; aplikační
   distribuovaný limiter není náhradou WAF nebo DDoS ochrany;
6. produkční e-mail provider pro reset hesla tam, kde zůstane password login;
   SaaS přihlášení používá ověřenou GitHub identitu;
7. egress firewall odpovídající aplikační SSRF/DNS-rebinding policy;
8. centrální log collector nebo OpenTelemetry pipeline s definovanou retencí,
   přístupovými rolemi, metrikami, alerty a incident runbookem;
9. load test, kapacitní limity a rozhodnutí o scheduleru pro více API replik;
10. nezávislé uživatelské a provozní ověření release kandidáta.

## Známá provozní omezení

### Self-hosted není hostile multi-tenancy

Workspace oprávnění chrání data a operace, ale projekty na jednom Docker
daemonu sdílejí kernel hosta. Nedůvěryhodné týmy odděl samostatným hostem,
VM nebo silnějším sandboxem. InitPad dnes neprovisionuje Kubernetes namespace
ani microVM.

### Control plane je single-node

Periodický retention, environment expiry a reconciliation běží uvnitř API
procesu. Databázové compare-and-set operace chrání destruktivní přechody, ale
není implementovaný distribuovaný scheduler pro aktivní/aktivní repliky.

### Vestavěný object store je pouze důvěryhodný profil

Připnutý komunitní MinIO image zajišťuje reprodukovatelnost lokální instalace,
ale není doporučenou veřejnou produkční hranicí. Produkce musí použít
samostatně udržované privátní S3-compatible úložiště a nacvičenou obnovu.

### Agent 0.12 je veřejně distribuovaný, ale čeká na host acceptance

Release [`agent-v0.12.1`](https://github.com/kudrle01/initpad/releases/tag/agent-v0.12.1)
vznikl z commitu `f92a95829fecd3bb84196057d061d7c97e37ad5d` a obsahuje
image
`ghcr.io/kudrle01/initpad-agent@sha256:5cdf2e08904138b3160bda808632fc1982f74750ef9d4c6840a29cba8c7c8c4f`
pro `linux/amd64` a `linux/arm64`. Release workflow ověřil Cosign podpis image
i všech stažitelných souborů; následná lokální kontrola manifestu a jeho GitHub
checksumu prošla a samostatné Cosign ověření potvrdilo přesnou workflow
identitu i záznam v transparentním logu. Tag chrání aktivní ruleset před
vytvořením, změnou nebo smazáním bez výjimky release správce.

GHCR package je veřejný. Anonymní registry požadavek vrátil `200`, shodný
immutable digest a OCI index pro `linux/amd64` i `linux/arm64`. Lokální release
kandidát používá dvojici tohoto digestu a verze `0.12.1`; distribuční API ji
označuje jako dostupnou a servírovaný instalátor se shoduje s podepsaným
checksumem release. Živý recovery test nejprve potvrdil, že odmítnutý uložený
credential nezmění config ani kontejner, a explicitní `--re-enroll` následně
vrátil target online; protocol, Docker lifecycle a reálný workload poté prošly.
Dokud neproběhne celý clean-host runbook včetně rebootu a vadného update image, nejde
vydání považovat za produkčně přijaté. Postup je v clean-host runbooku
[`apps/agent/ACCEPTANCE.md`](../apps/agent/ACCEPTANCE.md); vydávací proces
popisuje [`apps/agent/RELEASING.md`](../apps/agent/RELEASING.md).
Digest a release verze se konfigurují jako jedna povinná dvojice z podepsaného
manifestu; API neúplnou nebo nestabilní verzi při startu odmítne.

### Platformní update čeká na první veřejný release a živý rollback test

Workflow `initpad-v*` lokálně prochází release gate a vytváří tři podepsané
multiarch images, SBOM, provenance, Compose descriptor, checksums a recovery
instalátor. Admin UI přijímá jen novější ověřenou verzi a Supervisor před
přepnutím ověří PostgreSQL dump i readiness každé komponenty. Implementace
ale nebude označena za provozně přijatou, dokud `initpad-v0.2.0` nevznikne z
chráněného tagu, všechny tři GHCR packages nebudou veřejně čitelné a čistý
Linux host neprojde bootstrapem, rebootem, úspěšným `0.2.x` updatem, vadným
candidate rollbackem a přerušením uprostřed cutoveru. Docker socket
Supervisoru je root-equivalent oprávnění, nikoli rootless sandbox.

### E-mail delivery není zapojená

Self-hosted uživatel si může bezpečně ověřit vlastní e-mail odkazem
zobrazeným v jeho session. Zapomenuté heslo ale bez e-mail providera neposílá
reset link; správce instance musí vydat dočasné heslo nebo aktivační odkaz.
Resetovací token se z bezpečnostních důvodů nevypisuje do logu.

### Observability končí strukturovaným logem

Correlation ID umožňuje dohledat celý deployment, ale repozitář neinstaluje
centrální collector, dashboard ani paging. Self-hosted provozovatel si volí
vlastní log stack; SaaS musí před spuštěním stanovit retenci a přístup.

### SFTP nemá stejné garance jako Agent

SFTP zůstává kompatibilní cestou pro školní a sdílený PHP/static hosting,
kde nelze instalovat Agenta. Oprávnění souborů a vlastnictví runtime cache
určuje cizí server. InitPad používá release adresáře, karanténu a pravdivý
cleanup debt, ale administrátorský zásah hostingu může být stále nutný.

### Veřejný hostname není DNS provisioning

Managed gateway rezervuje a obsluhuje stabilní hostname, nevlastní ale
registraci domény ani veřejný DNS. Provozovatel musí připravit wildcard DNS,
TLS a firewall. Lokální `.test` profil je acceptance lab, ne produkční DNS.

## Kritéria release kandidáta

Self-hosted release kandidát lze označit až tehdy, když:

- `npm ci && npm run check:release` projde z čistého checkoutu;
- Compose config projde pro použité profily a všechny služby jsou healthy;
- relevantní container/template image workflow je zelený;
- migrace proběhne nad kopií reálné databáze a obnova poslední zálohy je
  nacvičená na jednorázovém hostu;
- dva workspace projdou isolation acceptance;
- Agent release projde ověřením podpisu a živým lifecycle testem;
- platform release projde anonymním GHCR pull testem, recovery bootstrapem,
  následným UI updatem, rollbackem a restartem hosta uprostřed operace;
- známá omezení jsou uvedena v release notes a provozovatel je přijme.

Pro nezávislý test použij [`EVALUATION.md`](./EVALUATION.md). Detailní
self-hosted acceptance je v
[`deploy/SELF_HOSTED_ACCEPTANCE.md`](../deploy/SELF_HOSTED_ACCEPTANCE.md).
