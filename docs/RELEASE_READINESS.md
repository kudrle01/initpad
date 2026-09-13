# Release readiness a známá omezení

Stav dokumentu odpovídá vývojové verzi po zavedení InitPad Agentu 0.11.
Seznam je záměrně otevřený: odděluje funkční prototyp od tvrzení, že je
služba připravená pro veřejný produkční provoz.

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
- Reprodukovatelná repository gate, immutable container references a
  připravená podepsaná multiarch release pipeline Agenta.
- Strukturované redigované logy a korelace request → operation → Agent job
  → workload.
- PostgreSQL-backed per-IP a per-account rate limit sdílený všemi API
  replikami bez ukládání zdrojových identit.

## Blokátory veřejného SaaS

Veřejný SaaS zatím není release profil. Před připojením nedůvěryhodných
zákazníků musí být hotové alespoň:

1. první podepsané vydání Agenta, veřejný anonymní pull z GHCR a acceptance
   instalace, rebootu, upgradu i rollbacku na čistém Linux hostu;
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

### Agent image 0.11 nemusí být ještě publikovaný

Zdrojový kód, instalátor a release workflow jsou připravené, ale dokud
neexistuje neměnný veřejný digest a dokončená acceptance, UI nesmí vydávat
lokální vývojový image za produkční download. Postup je v
[`apps/agent/RELEASING.md`](../apps/agent/RELEASING.md).

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
- známá omezení jsou uvedena v release notes a provozovatel je přijme.

Pro nezávislý test použij [`EVALUATION.md`](./EVALUATION.md). Detailní
self-hosted acceptance je v
[`deploy/SELF_HOSTED_ACCEPTANCE.md`](../deploy/SELF_HOSTED_ACCEPTANCE.md).
