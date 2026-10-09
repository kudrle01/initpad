# Architektonická rozhodnutí InitPadu

Tento index obsahuje architektonická rozhodnutí v pořadí, v jakém vznikala.
Každý záznam zachovává původní kontext, zvažované možnosti, rozhodnutí a
důsledky. Novější ADR může starší rozhodnutí výslovně doplnit nebo nahradit.

Stav `Accepted` označuje současné rozhodnutí, `Superseded` rozhodnutí nahrazené
novějším ADR a `Deprecated` kompatibilní cestu, která se už nemá používat pro
nové nasazení. Historické názvy zůstávají beze změny, aby byly odkazy a kontext
stabilní.

| ADR | Stav | Rozhodnutí |
|---|---|---|
| [ADR-001](./ADR-001.md) | Accepted | Identita: platforma jako identity provider (řízená registrace) |
| [ADR-002](./ADR-002.md) | Accepted | Git operace přes servisní účet (admin + Sudo), ne per-user token |
| [ADR-003](./ADR-003.md) | Superseded | Název projektu unikátní per uživatel |
| [ADR-004](./ADR-004.md) | Accepted | Stav CI čteme z commit statusů, logy odkazujeme do Gitey |
| [ADR-005](./ADR-005.md) | Accepted | SSO: platforma jako OIDC provider, Gitea jako klient |
| [ADR-006](./ADR-006.md) | Accepted | Šifrování tokenů v DB (AES-256-GCM) |
| [ADR-007](./ADR-007.md) | Accepted | CI → deploy přes webhook |
| [ADR-008](./ADR-008.md) | Accepted | „Build once, deploy many" přes Gitea container registry |
| [ADR-009](./ADR-009.md) | Superseded | Reálné SSH a SFTP nasazení (heterogenní cíle) |
| [ADR-010](./ADR-010.md) | Accepted | „Connect Git": jednorázové nastavení přístupu ke klonování |
| [ADR-011](./ADR-011.md) | Accepted | Hardening source-based nasazení (izolace, integrita verzí, vlastnictví) |
| [ADR-012](./ADR-012.md) | Superseded | Přidělování aplikačních portů z databáze (SSH cíl) |
| [ADR-013](./ADR-013.md) | Accepted | Trunk-based development + promotion artefaktu (ne environment branches) |
| [ADR-014](./ADR-014.md) | Accepted | Bezstavové zacházení se zdrojáky (žádné trvalé lokální kopie) |
| [ADR-015](./ADR-015.md) | Accepted | Instalace jedním příkazem (plně kontejnerizovaný stack + bootstrap) |
| [ADR-016](./ADR-016.md) | Accepted | Jediný směr identity: odstranění „Continue with Gitea" |
| [ADR-017](./ADR-017.md) | Accepted | Reflexe změn provedených přímo v Gitee (systémový webhook) |
| [ADR-018](./ADR-018.md) | Accepted | „Všechno je target": cíle nasazení jako první-třídní zdroj |
| [ADR-019](./ADR-019.md) | Accepted | PHP frameworky přes SFTP: verzovaný zdroj + „build-and-extract" |
| [ADR-020](./ADR-020.md) | Superseded | Produkční nasazení: vrstvy cílů a Kubernetes jako doporučená produkce |
| [ADR-021](./ADR-021.md) | Accepted | CI běží v odděleném rootless Docker daemonu |
| [ADR-022](./ADR-022.md) | Accepted | Deployment je persistentní operace, ne fire-and-forget promise |
| [ADR-023](./ADR-023.md) | Accepted | Oddělená autentizace uživatele, CI projektu a SCM webhooku |
| [ADR-024](./ADR-024.md) | Accepted | Databázi mění pouze verzované migrace a upgrade selhává bezpečně |
| [ADR-025](./ADR-025.md) | Accepted | Golden-path šablona je verzovaný, testovaný a reprodukovatelný produkt |
| [ADR-026](./ADR-026.md) | Accepted | Produktové vymezení: opinionated IDP pro malé týmy, výuku a on-prem |
| [ADR-027](./ADR-027.md) | Accepted | Veřejný control plane, školní target pool a infrastruktura uživatele |
| [ADR-028](./ADR-028.md) | Accepted | Workspace je tenant a jediná autorizační hranice |
| [ADR-029](./ADR-029.md) | Accepted | Agent MVP používá HTTPS polling a omezený job protokol |
| [ADR-030](./ADR-030.md) | Accepted | GitHub je výchozí cloudový SCM, Gitea zůstává self-contained cestou |
| [ADR-031](./ADR-031.md) | Accepted | CI runner registrujeme adresou dosažitelnou i z izolovaných jobů |
| [ADR-032](./ADR-032.md) | Accepted | „Run again“ bez prázdných commitů přes dočasný CI tag |
| [ADR-033](./ADR-033.md) | Accepted | Runtime image musí ověřit bootstrap, ne jen Composer závislosti |
| [ADR-034](./ADR-034.md) | Accepted | Smazání projektu je ověřený cleanup plán, ne odstranění jednoho řádku |
| [ADR-035](./ADR-035.md) | Accepted | SFTP runtime adresáře zachovávají přístup deploy identity |
| [ADR-036](./ADR-036.md) | Accepted | SFTP publikuje pouze CI artefakt a chráněný webroot |
| [ADR-037](./ADR-037.md) | Accepted | Částečný teardown rozlišuje veřejný workload a cleanup dluh |
| [ADR-038](./ADR-038.md) | Accepted | Vestavěný SFTP webroot má explicitního vlastníka a write probe |
| [ADR-039](./ADR-039.md) | Accepted | Obecné workspaces nahrazují Course doménu; SCM se liší podle edice |
| [ADR-040](./ADR-040.md) | Superseded | Identity a workspace onboarding: registrační politika, správa účtů, pozvánky a obnova hesla |
| [ADR-041](./ADR-041.md) | Accepted | ScmProvider šev, externí identita a GitHub installation tokeny |
| [ADR-042](./ADR-042.md) | Accepted | Zjednodušení onboardingu: dva režimy, aktivační odkazy, členství jen pro existující účty |
| [ADR-043](./ADR-043.md) | Accepted | Edice jsou bezpečnostní hranice a GitHub vyžaduje explicitní repository contract |
| [ADR-044](./ADR-044.md) | Accepted | GitHub App instalace je explicitní workspace grant, ne globální webhook stav |
| [ADR-045](./ADR-045.md) | Accepted | GitHub operace rozlišují installation a user token; osobní create vyžaduje rotovatelný credential |
| [ADR-046](./ADR-046.md) | Accepted | Edice určuje SCM; workspace grant určuje GitHub destinaci |
| [ADR-047](./ADR-047.md) | Accepted | Provisioning používá write-ahead effect journal a kompenzační rollback |
| [ADR-048](./ADR-048.md) | Accepted | Retry je povolen až po prokázané kompenzaci; recovery používá lease |
| [ADR-049](./ADR-049.md) | Accepted | GitHub Actions artifact je ověřený handoff; platforma jej musí převzít |
| [ADR-050](./ADR-050.md) | Accepted | PHP produkce preferuje deklarovaný SFTP/PHP target; capability změny jsou směrové |
| [ADR-051](./ADR-051.md) | Accepted | GitHub callback je veřejné HTTPS API; SaaS nemá falešné lokální targety |
| [ADR-052](./ADR-052.md) | Accepted | GitHub Actions Jobs jsou autorita pro stages; změna targetu vytváří deployment intent |
| [ADR-053](./ADR-053.md) | Accepted | Ruční Deploy nejdřív obnoví hotový GitHub Actions artifact |
| [ADR-054](./ADR-054.md) | Accepted | Pipeline je vázaná na nasazený run; status vede přímo do SCM logu |
| [ADR-055](./ADR-055.md) | Accepted | CI runner log a deployment activity jsou dvě odlišné auditní stopy |
| [ADR-056](./ADR-056.md) | Accepted | Detail projektu je náhled; historie odděluje build od deploymentu |
| [ADR-057](./ADR-057.md) | Accepted | SCM handoff a InitPad publication nesmějí sdílet jeden stav |
| [ADR-058](./ADR-058.md) | Accepted | Oprava failed handoffu je explicitní GitHub run attempt |
| [ADR-059](./ADR-059.md) | Accepted | Ověřený build artifact patří do durable object storage, ne jen do lokálního Docker daemonu |
| [ADR-060](./ADR-060.md) | Accepted | Environment běží přes workspace-scoped TargetAllocation, ne přímo přes fyzický Target |
| [ADR-061](./ADR-061.md) | Accepted | Per-environment konfigurace a secrety nasazovaných aplikací |
| [ADR-062](./ADR-062.md) | Accepted | Provozní zajištění self-hosted nasazení (zálohy, obnova, interní HTTPS, úklid) |
| [ADR-063](./ADR-063.md) | Accepted | Aktuální built-in URL a životní cyklus lokálních Docker zdrojů |
| [ADR-064](./ADR-064.md) | Accepted | Fronta CI je explicitní a kapacita runneru je omezená |
| [ADR-065](./ADR-065.md) | Accepted | CI a externí SCM nesmí blokovat control plane |
| [ADR-066](./ADR-066.md) | Accepted | Agent trust bootstrap patří fyzickému Targetu |
| [ADR-067](./ADR-067.md) | Accepted | Agent target je outbound-only a před delivery zůstává nepoužitelný |
| [ADR-068](./ADR-068.md) | Accepted | Agent heartbeat je minimální, odchozí a provozně obnovitelný |
| [ADR-069](./ADR-069.md) | Accepted | Agent job je durable target-scoped envelope s fencing lease |
| [ADR-070](./ADR-070.md) | Accepted | Docker lifecycle Agenta je allocation-scoped allow-list |
| [ADR-071](./ADR-071.md) | Accepted | Agent delivery odděluje trvalý intent od lease-scoped materiálu |
| [ADR-072](./ADR-072.md) | Accepted | Projektová operace zůstává autoritou nad Agent jobem |
| [ADR-073](./ADR-073.md) | Accepted | Produkční Agent target používá spravovanou gateway a stabilní hostname |
| [ADR-074](./ADR-074.md) | Accepted | Detailní deployment phase je oddělená od transakčního statusu |
| [ADR-075](./ADR-075.md) | Accepted | Ruční rollback znovu publikuje ověřený artifact bez nového buildu |
| [ADR-076](./ADR-076.md) | Accepted | Diagnostika workloadu je omezený přepisovaný snapshot, ne logovací služba |
| [ADR-077](./ADR-077.md) | Accepted | Audit změn je append-only workspace timeline se snapshoty identit |
| [ADR-078](./ADR-078.md) | Accepted | Potvrzení se řídí dopadem akce, ne HTTP metodou |
| [ADR-079](./ADR-079.md) | Accepted | Odpojení správy targetu nesmí být skrytý teardown |
| [ADR-080](./ADR-080.md) | Accepted | Target a allocation jsou oddělené v doméně, spojené v uživatelském modelu |
| [ADR-081](./ADR-081.md) | Accepted | Audit asynchronní akce odděluje přijetí od autoritativního výsledku |
| [ADR-082](./ADR-082.md) | Accepted | Produkce je schválení neměnného záměru, ne druhé kliknutí na deploy |
| [ADR-083](./ADR-083.md) | Accepted | Provozní limity a expirace patří workspace allocation |
| [ADR-084](./ADR-084.md) | Accepted | Dashboard používá databázový workspace read-model |
| [ADR-085](./ADR-085.md) | Accepted | Vyhodnocovací metriky jsou omezená projekce deployment operací |
| [ADR-086](./ADR-086.md) | Accepted | HTTP API je autentizované ve výchozím stavu |
| [ADR-087](./ADR-087.md) | Accepted | Autorita Agenta je průnik credentialu, targetu a lease |
| [ADR-088](./ADR-088.md) | Accepted | Nezdravý kandidát se nikdy nestane publikovaným stavem |
| [ADR-089](./ADR-089.md) | Accepted | Přerušený Agent job se obnovuje deklarativním takeoverem |
| [ADR-090](./ADR-090.md) | Accepted | Obnovený control plane nesmí zdědit autoritu ani observed stav |
| [ADR-091](./ADR-091.md) | Accepted | Lokální gate je deterministický, supply-chain kontrola síťová |
| [ADR-092](./ADR-092.md) | Accepted | Agent je výchozí správa Docker targetu, nikoli jediný konektor |
| [ADR-093](./ADR-093.md) | Accepted | Agent release je tag-gated, multi-arch a ověřitelný bez důvěry v tag |
| [ADR-094](./ADR-094.md) | Accepted | Navigace kopíruje uživatelské úlohy a scope nastavení |
| [ADR-095](./ADR-095.md) | Superseded | Docker je Agent-first, SFTP kompatibilní a SSH runtime pouze migrační |
| [ADR-096](./ADR-096.md) | Accepted | Agent credential se rotuje dvoufázově s potvrzením nové generace |
| [ADR-097](./ADR-097.md) | Accepted | Statická kontrola je povinná, type-aware a odděluje produkční kód od test doubles |
| [ADR-098](./ADR-098.md) | Accepted | Údržba projektů má vlastní lifecycle a reconciliation hranici |
| [ADR-099](./ADR-099.md) | Accepted | Container reference je immutable a aktualizace prochází build acceptance |
| [ADR-100](./ADR-100.md) | Accepted | Hosted egress znovu ověří DNS a připne schválenou IP |
| [ADR-101](./ADR-101.md) | Accepted | Workflow correlation je trvalá, request ID je serverové a logy jsou strukturované |
| [ADR-102](./ADR-102.md) | Accepted | Citlivé HTTP operace používají distribuovaný per-IP a per-subject limit |
| [ADR-103](./ADR-103.md) | Accepted | Distribuovaný Agent release je svázaný s digestem i deklarovanou verzí |
| [ADR-104](./ADR-104.md) | Accepted | Self-hosted instalace vybírá Agent release, cílový server nepotřebuje host CLI |
| [ADR-105](./ADR-105.md) | Accepted | Dočasná Docker diagnostika má allocation-scoped jméno |
| [ADR-106](./ADR-106.md) | Accepted | Browser request ID nesmí záviset jen na `crypto.randomUUID` |
| [ADR-107](./ADR-107.md) | Accepted | Docker resource identity zahrnuje immutable allocation |
| [ADR-108](./ADR-108.md) | Accepted | Upgrade Agenta ověřuje identitu před zastavením a re-enrollment je explicitní |
| [ADR-109](./ADR-109.md) | Superseded | Self-hosted distribuční kanál povyšuje Agent 0.12.1 |
| [ADR-110](./ADR-110.md) | Accepted | Vzdálený update Agenta je podepsaný, typovaný job bez shellu |
| [ADR-111](./ADR-111.md) | Accepted | On-prem platformu aktualizuje oddělený Supervisor z release bundle |
| [ADR-112](./ADR-112.md) | Accepted | Multiarch platformní images se staví na nativních runnerech |
| [ADR-113](./ADR-113.md) | Accepted | Recovery přerušeného platformního updatu provádí jednorázový helper |
| [ADR-114](./ADR-114.md) | Accepted | Release descriptor se při reboot recovery obnovuje atomickým přesunem |
| [ADR-115](./ADR-115.md) | Accepted | URL control plane je ověřitelná transportní konfigurace Agenta |
| [ADR-116](./ADR-116.md) | Accepted | Lokální přihlašovací identifikátory nerozlišují velikost písmen |
| [ADR-117](./ADR-117.md) | Accepted | Produkční review používá maintain, policy vlastní owner |
| [ADR-118](./ADR-118.md) | Accepted | Projekt volí jednu ze tří pevných pipeline předvoleb |
| [ADR-119](./ADR-119.md) | Accepted | Release platformy a Agenta prochází candidate a stable kanálem |
| [ADR-120](./ADR-120.md) | Accepted | SaaS control plane má samostatný runtime profil |
| [ADR-121](./ADR-121.md) | Accepted | OAuth state a OIDC granty jsou hashované a trvalé |
| [ADR-122](./ADR-122.md) | Accepted | Workspace kapacita je samostatná transakční hranice |
| [ADR-123](./ADR-123.md) | Accepted | Autentizační e-maily používají šifrovaný transakční outbox |
| [ADR-124](./ADR-124.md) | Accepted | Load a SMTP outage acceptance jsou omezené staging gate, ne důkaz active-active mutací |
| [ADR-125](./ADR-125.md) | Accepted | Background lifecycle volí jediného leadera databázovým lease |
| [ADR-126](./ADR-126.md) | Accepted | Process-bound deployment používá obnovovaný generační lease |
| [ADR-127](./ADR-127.md) | Accepted | Dependency audit připouští jen úzkou a expirující výjimku |
| [ADR-128](./ADR-128.md) | Accepted | Artifact ingestion používá vlastní generační execution lease |
| [ADR-129](./ADR-129.md) | Accepted | Sdílený artifact fence a operation-backed lifecycle uzavírají mutační hranici |
| [ADR-130](./ADR-130.md) | Accepted | API exportuje traces a metriky přes explicitní OTLP hranici |
| [ADR-131](./ADR-131.md) | Accepted | Source-based SSH runtime je odstraněn, SFTP zůstává kompatibilní konektor |
| [ADR-132](./ADR-132.md) | Accepted | Staging veřejného SaaS tvoří nízkonákladová sestava vyměnitelných externích služeb |
| [ADR-133](./ADR-133.md) | Accepted | Příjem artefaktu plní lokální Docker daemon jen pro vlastní nasazení control plane |
| [ADR-134](./ADR-134.md) | Accepted | Gitea tokeny mají rozsah podle spotřebitele a CI dostává jen token pro registry |
| [ADR-135](./ADR-135.md) | Accepted | Serverový profil posílá API z Caddy přímo, aby měla každá cesta jeden proxy hop |
| [ADR-136](./ADR-136.md) | Accepted | První administrátor vyžaduje instalační token a registrace je ve výchozím stavu uzavřená |
| [ADR-137](./ADR-137.md) | Accepted | Mutace se session cookie vyžadují JSON a session cookie pod HTTPS nese prefix `__Host-` |
| [ADR-138](./ADR-138.md) | Accepted | Každý CI job běží na čerstvě vymazaném Docker daemonu |
| [ADR-139](./ADR-139.md) | Accepted | Šablonové CI testuje, staví a publikuje image v jednom jobu s cache vrstev v registry projektu |
| [ADR-140](./ADR-140.md) | Accepted | Šablony předávají kontext CI jako data, nemají klíče v kódu a dodávají závislosti bez známých zranitelností |
| [ADR-141](./ADR-141.md) | Accepted | Klíč pro šifrování dat je samostatný, jde vyměnit a nečitelná hodnota je chyba |
| [ADR-142](./ADR-142.md) | Accepted | Přihlášení, správa účtů a smazání workspace se zapisují do platformního auditu |
| [ADR-143](./ADR-143.md) | Accepted | Jednorázové odkazy nesou token ve fragmentu URL |
| [ADR-144](./ADR-144.md) | Accepted | Platformní obrazy běží s nejmenšími oprávněními a CI je skenuje na zranitelnosti |
| [ADR-145](./ADR-145.md) | Accepted | Vstupy zvenčí mají ověřený tvar a podepsaný webhook se nepoužije dvakrát |
| [ADR-146](./ADR-146.md) | Accepted | Podpis Supervisoru pokrývá metodu a cestu a produkce vyžaduje trvalé úložiště artefaktů |
| [ADR-147](./ADR-147.md) | Accepted | Přihlášení je odvolatelná session a uživatel vidí, kde je přihlášený |
| [ADR-148](./ADR-148.md) | Accepted | Obnova účtu odvolá všechny Gitea tokeny a provoz umí ukončit Gitea sessions |
| [ADR-149](./ADR-149.md) | Accepted | Sítě sdílené za jednou adresou mají vyšší limit na IP |
| [ADR-150](./ADR-150.md) | Accepted | Historie bez dalšího využití se po stanovené době maže |
| [ADR-151](./ADR-151.md) | Accepted | Záloha se šifruje veřejným klíčem, který server nedokáže otevřít |
| [ADR-152](./ADR-152.md) | Accepted | PHP šablony běží na FrankenPHP |
| [ADR-153](./ADR-153.md) | Accepted | SaaS nespouští součásti self-hosted Gitey a install.sh SaaS neinstaluje |
| [ADR-154](./ADR-154.md) | Accepted | Počet vlastněných týmových workspaces je omezený |
