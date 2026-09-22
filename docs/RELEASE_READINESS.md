# Release readiness a známá omezení

Stav dokumentu odpovídá doporučenému Agentu 0.14.2, odmítnutým release
0.13.0 a 0.14.0 a podepsanému platformnímu releasu 0.2.2. Seznam je záměrně
otevřený: odděluje funkční prototyp od tvrzení, že je služba připravená pro
veřejný produkční provoz.

## Co je připravené

- Self-hosted instalace na jednom důvěryhodném hostu včetně Gitey, CI,
  databáze, artifact storage a zálohy/obnovy. Čistá instalace, skutečný
  reboot a destruktivní restore drill prošly na disposable Ubuntu VM.
- Workspace RBAC, role synchronizované do SCM a automatizovaná dvou-workspace
  isolation matice.
- Dvanáct verzovaných šablon včetně Laravelu, Nette a Symfony.
- Immutable build artifact a promotion stejného digestu přes prostředí.
- Produkční approval, rollback, audit a bezpečné dialogy destruktivních akcí.
- Outbound Agent protokol s enrollmentem, rotací credentials, lease fencingem,
  diagnostikou, resource limity a stabilní gateway routou.
- Reprodukovatelná repository gate, immutable container references a
  podepsané multiarch vydání Agenta 0.14.2 s runtime probem výsledné image,
  živým identity-preserving updatem a ověřeným automatickým rollbackem.
- Podepsaný platformní release bundle, oddělený Supervisor, ověřený backup,
  postupný health-gated cutover a image rollback pro self-hosted instalaci.
- Strukturované redigované logy a korelace request → operation → Agent job
  → workload.
- PostgreSQL-backed per-IP a per-account rate limit sdílený všemi API
  replikami bez ukládání zdrojových identit.

## Blokátory veřejného SaaS

Veřejný SaaS zatím není release profil. Před připojením nedůvěryhodných
zákazníků musí být hotové alespoň:

1. samostatný SaaS deployment profil bez vestavěné Gitey a lokálního
   object store;
2. živé end-to-end ověření GitHub OAuth, GitHub App instalace, osobního i
   organizačního repozitáře, Actions artifactu, rename/suspend/uninstall;
3. externí správa secretů a rotace produkčních credentials;
4. edge connection/volumetric ochrana a ověřená proxy topologie; aplikační
   distribuovaný limiter není náhradou WAF nebo DDoS ochrany;
5. produkční e-mail provider pro reset hesla tam, kde zůstane password login;
   SaaS přihlášení používá ověřenou GitHub identitu;
6. egress firewall odpovídající aplikační SSRF/DNS-rebinding policy;
7. centrální log collector nebo OpenTelemetry pipeline s definovanou retencí,
   přístupovými rolemi, metrikami, alerty a incident runbookem;
8. load test, kapacitní limity a rozhodnutí o scheduleru pro více API replik;
9. nezávislé uživatelské a provozní ověření release kandidáta.

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

### Agenty 0.13.0 a 0.14.0 byly při runtime acceptance odmítnuty

Release [`agent-v0.14.0`](https://github.com/kudrle01/initpad/releases/tag/agent-v0.14.0)
vznikl z commitu `9a5cf51a009a0d492abbeb945ed8a164567ed35f` a obsahuje
image
`ghcr.io/kudrle01/initpad-agent@sha256:833363e31a724d1faf228ab64bc871a3641fb112d0ac69f8f982f2b75120caf1`
pro `linux/amd64` a `linux/arm64`. Release workflow ověřil Cosign podpis image
i všech stažitelných souborů; následná lokální kontrola manifestu a jeho GitHub
checksumu prošla. Nezávislý anonymní audit ověřil přesnou Sigstore
workflow identitu, záznam v transparentním logu, shodný OCI digest i obě
cílové platformy. Tag chrání aktivní ruleset před vytvořením, změnou nebo
smazáním bez výjimky release správce.

Stejnou vadu obsahuje starší podepsaný release `agent-v0.13.0`: jeho image
rovněž nekopíroval produkční `node_modules`. Distribuční integrita obou verzí
tedy byla v pořádku, ale runtime preflight nemohl načíst balíček `sigstore`.
Instalátor chybu v obou případech zachytil před odstavením stávajícího
Agenta; identita a workloady zůstaly beze změny. Release katalog obě verze
explicitně vynechává. Oprava 0.14.1 přidala produkční dependency
stage a povinný CLI smoke test sestaveného image v běžném i release workflow.
Podepsaná multiarch image
`ghcr.io/kudrle01/initpad-agent@sha256:08b7829c02a06d343b825557df2e79abf2d6a745c591b6ae523a0605942948a9`
prošla 20. září 2026 runtime probem i nezávislým anonymním distribučním
auditem. Podepsaná image 0.14.2 se stejnou opravou prošla 21. září 2026
anonymním auditem release assets, runtime probe i multiarch OCI indexu.
Na samostatném Linux hostu poté prošel živý update `0.14.1 → 0.14.2` se
zachováním identity a workloadů; fault-injected selhání replacement instance
obnovilo 0.14.1 a následný čistý pokus připojil 0.14.2. Verze 0.14.2 je proto
aktuálním doporučeným releasem. Reprodukovatelný postup zůstává v clean-host runbooku
[`apps/agent/ACCEPTANCE.md`](../apps/agent/ACCEPTANCE.md); vydávací proces
popisuje [`apps/agent/RELEASING.md`](../apps/agent/RELEASING.md).
Digest a release verze se konfigurují jako jedna povinná dvojice z podepsaného
manifestu; API neúplnou nebo nestabilní verzi při startu odmítne.

### Platformní release 0.2.2 prošel čistým živým updatem

Workflow `initpad-v*` lokálně prochází release gate a vytváří tři podepsané
multiarch images, SBOM, provenance, Compose descriptor, checksums a recovery
instalátor. Admin UI přijímá jen novější ověřenou verzi a Supervisor před
přepnutím ověří PostgreSQL dump i readiness každé komponenty. Tag
GitHub repozitář, release assets i GHCR packages `initpad-api`, `initpad-web`
a `initpad-supervisor` jsou veřejně čitelné. Anonymní audit release 0.2.1
i 0.2.2 ověřil Sigstore identity manifestu a checksumů, SHA-256 vazby i
OCI indexy pro `linux/amd64` a `linux/arm64`. Dne 21. září 2026 prošly na
disposable Ubuntu VM čisté updaty `0.2.0 → 0.2.1` a `0.2.1 → 0.2.2`:
skončily na podepsaném release a zachovaly identity v databázi i přesnou
lokální sadu managed workloadů (`workloads=0` na control-plane VM).
Zachování aktivního externího Agent workloadu se ověří v navazujícím
drillu. Acceptance odhalila chybějící source image záznam, root-owned release
descriptor a pozorovatele závislého na descriptoru během cutoveru; všechny tři
vady mají regresní ochranu ve veřejném release 0.2.4. Jeho anonymní audit
dne 22. září 2026 potvrdil veřejnou dostupnost, Sigstore podpisy a OCI
indexy pro `linux/amd64` i `linux/arm64`. Kandidát 0.2.3 nebyl
publikován, protože emulovaný ARM64 Node proces release buildu skončil
`SIGILL` před vytvořením multiarch manifestu; 0.2.4 používá pro amd64 i
arm64 nativní GitHub-hosted runnery. Fault-injected candidate API se při
`0.2.2 → 0.2.4` správně vrátil na předchozí release se zachováním dat.
Následná čistá aktualizace skončila na podepsaném `0.2.4` a
`after-success` potvrdil stejné identity, workload snapshot i tři immutable
image reference. Krátká nedostupnost browserového spojení během výměny
API/web odpovídá dokumentovanému single-node omezení.
Reboot po API cutoveru nejprve odhalil, že Supervisor s odebranými
capabilities nemůže přímo číst operátorem vlastněný descriptor `0600`.
Release 0.2.5 proto přesunul obnovu do jednorázového helperu s
`DAC_OVERRIDE`. Živý reboot gate ale následně odhalil `EPERM` v `copyFile`:
původní descriptor zůstal bezpečně zachovaný, ale nebyl vrácen na aktivní
cestu. Verze 0.2.5 je proto runtime-revokovaná. Oprava 0.2.6 používá
atomický `rename` v jednom adresáři a chybějící rollback artefakt již nikdy
nezpůsobí odstranění aktivního descriptoru; reboot gate se opakuje z
baseline 0.2.4.
Veřejný release 0.2.6 dne 22. září 2026 prošel anonymní kontrolou
podpisů a obou architektur. Na disposable Ubuntu VM pak přechod z 0.2.4
prošel vadným candidate rollbackem, restartem hosta po startu candidate
Supervisoru i závěrečnou čistou aktualizací. `after-success` potvrdil
stejné databázové identity, managed workload snapshot a tři immutable
release reference. Osiřelý lock z předchozího neúspěšného 0.2.5 pokusu
zablokoval první helper ještě před spuštěním; acceptance proto nově
odmítne uložit baseline, pokud lock existuje bez běžícího helperu.
Krátké 502 během výměny API/web je očekávané omezení
single-node profilu, nikoli výpadek projektových workloadů. Docker socket Supervisoru je
root-equivalent oprávnění, nikoli rootless sandbox.

Anonymní distribuční kontrolu lze kdykoli zopakovat bez GitHub credentials:

```bash
npm run audit:public-release -- --tag initpad-v0.2.2
npm run audit:public-release -- --tag initpad-v0.2.4
npm run audit:public-release -- --tag initpad-v0.2.6
npm run audit:public-release -- --tag agent-v0.14.2
```

Audit odmítne soukromý repozitář, neúplné nebo nedostupné assets, chybné
Sigstore identity a OCI digesty i image bez `linux/amd64` a `linux/arm64`.

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

Control-plane preflight, stav služeb, restart policy, změnu Linux boot ID,
zachování kontejnerů a strukturu backupu ověřuje nedestruktivní
[`self-hosted-check.sh`](../deploy/self-hosted-check.sh). Jeho lokální PASS
záznam není náhradou ručního multi-user scénáře ani samostatného Agent hostu.

Pro nezávislý test použij [`EVALUATION.md`](./EVALUATION.md). Detailní
self-hosted acceptance je v
[`deploy/SELF_HOSTED_ACCEPTANCE.md`](../deploy/SELF_HOSTED_ACCEPTANCE.md).
