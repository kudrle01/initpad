# Architektonická rozhodnutí InitPadu

Tento index obsahuje přijatá návrhová rozhodnutí v pořadí, v jakém vznikala.
Každý záznam zachovává původní kontext, zvažované možnosti, rozhodnutí a
důsledky. Novější ADR může starší rozhodnutí výslovně doplnit nebo nahradit.

| ADR | Rozhodnutí |
|---|---|
| [ADR-001](./ADR-001.md) | Identita: platforma jako identity provider (řízená registrace) |
| [ADR-002](./ADR-002.md) | Git operace přes servisní účet (admin + Sudo), ne per-user token |
| [ADR-003](./ADR-003.md) | Název projektu unikátní per uživatel |
| [ADR-004](./ADR-004.md) | Stav CI čteme z commit statusů, logy odkazujeme do Gitey |
| [ADR-005](./ADR-005.md) | SSO: platforma jako OIDC provider, Gitea jako klient |
| [ADR-006](./ADR-006.md) | Šifrování tokenů v DB (AES-256-GCM) |
| [ADR-007](./ADR-007.md) | CI → deploy přes webhook |
| [ADR-008](./ADR-008.md) | „Build once, deploy many" přes Gitea container registry |
| [ADR-009](./ADR-009.md) | Reálné SSH a SFTP nasazení (heterogenní cíle) |
| [ADR-010](./ADR-010.md) | „Connect Git": jednorázové nastavení přístupu ke klonování |
| [ADR-011](./ADR-011.md) | Hardening source-based nasazení (izolace, integrita verzí, vlastnictví) |
| [ADR-012](./ADR-012.md) | Přidělování aplikačních portů z databáze (SSH cíl) |
| [ADR-013](./ADR-013.md) | Trunk-based development + promotion artefaktu (ne environment branches) |
| [ADR-014](./ADR-014.md) | Bezstavové zacházení se zdrojáky (žádné trvalé lokální kopie) |
| [ADR-015](./ADR-015.md) | Instalace jedním příkazem (plně kontejnerizovaný stack + bootstrap) |
| [ADR-016](./ADR-016.md) | Jediný směr identity: odstranění „Continue with Gitea" |
| [ADR-017](./ADR-017.md) | Reflexe změn provedených přímo v Gitee (systémový webhook) |
| [ADR-018](./ADR-018.md) | „Všechno je target": cíle nasazení jako první-třídní zdroj |
| [ADR-019](./ADR-019.md) | PHP frameworky přes SFTP: verzovaný zdroj + „build-and-extract" |
| [ADR-020](./ADR-020.md) | Produkční nasazení: vrstvy cílů a Kubernetes jako doporučená produkce |
| [ADR-021](./ADR-021.md) | CI běží v odděleném rootless Docker daemonu |
| [ADR-022](./ADR-022.md) | Deployment je persistentní operace, ne fire-and-forget promise |
| [ADR-023](./ADR-023.md) | Oddělená autentizace uživatele, CI projektu a SCM webhooku |
| [ADR-024](./ADR-024.md) | Databázi mění pouze verzované migrace a upgrade selhává bezpečně |
| [ADR-025](./ADR-025.md) | Golden-path šablona je verzovaný, testovaný a reprodukovatelný produkt |
| [ADR-026](./ADR-026.md) | Produktové vymezení: opinionated IDP pro malé týmy, výuku a on-prem |
| [ADR-027](./ADR-027.md) | Veřejný control plane, školní target pool a infrastruktura uživatele |
| [ADR-028](./ADR-028.md) | Workspace je tenant a jediná autorizační hranice |
| [ADR-029](./ADR-029.md) | Agent MVP používá HTTPS polling a omezený job protokol |
| [ADR-030](./ADR-030.md) | GitHub je výchozí cloudový SCM, Gitea zůstává self-contained cestou |
| [ADR-031](./ADR-031.md) | CI runner registrujeme adresou dosažitelnou i z izolovaných jobů |
| [ADR-032](./ADR-032.md) | „Run again“ bez prázdných commitů přes dočasný CI tag |
| [ADR-033](./ADR-033.md) | Runtime image musí ověřit bootstrap, ne jen Composer závislosti |
| [ADR-034](./ADR-034.md) | Smazání projektu je ověřený cleanup plán, ne odstranění jednoho řádku |
| [ADR-035](./ADR-035.md) | SFTP runtime adresáře zachovávají přístup deploy identity |
| [ADR-036](./ADR-036.md) | SFTP publikuje pouze CI artefakt a chráněný webroot |
| [ADR-037](./ADR-037.md) | Částečný teardown rozlišuje veřejný workload a cleanup dluh |
| [ADR-038](./ADR-038.md) | Vestavěný SFTP webroot má explicitního vlastníka a write probe |
| [ADR-039](./ADR-039.md) | Obecné workspaces nahrazují Course doménu; SCM se liší podle edice |
| [ADR-040](./ADR-040.md) | Identity a workspace onboarding: registrační politika, správa účtů, pozvánky a obnova hesla |
| [ADR-041](./ADR-041.md) | ScmProvider šev, externí identita a GitHub installation tokeny |
| [ADR-042](./ADR-042.md) | Zjednodušení onboardingu: dva režimy, aktivační odkazy, členství jen pro existující účty |
| [ADR-043](./ADR-043.md) | Edice jsou bezpečnostní hranice a GitHub vyžaduje explicitní repository contract |
| [ADR-044](./ADR-044.md) | GitHub App instalace je explicitní workspace grant, ne globální webhook stav |
| [ADR-045](./ADR-045.md) | GitHub operace rozlišují installation a user token; osobní create vyžaduje rotovatelný credential |
| [ADR-046](./ADR-046.md) | Edice určuje SCM; workspace grant určuje GitHub destinaci |
| [ADR-047](./ADR-047.md) | Provisioning používá write-ahead effect journal a kompenzační rollback |
| [ADR-048](./ADR-048.md) | Retry je povolen až po prokázané kompenzaci; recovery používá lease |
| [ADR-049](./ADR-049.md) | GitHub Actions artifact je ověřený handoff; platforma jej musí převzít |
| [ADR-050](./ADR-050.md) | PHP produkce preferuje deklarovaný SFTP/PHP target; capability změny jsou směrové |
| [ADR-051](./ADR-051.md) | GitHub callback je veřejné HTTPS API; SaaS nemá falešné lokální targety |
| [ADR-052](./ADR-052.md) | GitHub Actions Jobs jsou autorita pro stages; změna targetu vytváří deployment intent |
| [ADR-053](./ADR-053.md) | Ruční Deploy nejdřív obnoví hotový GitHub Actions artifact |
| [ADR-054](./ADR-054.md) | Pipeline je vázaná na nasazený run; status vede přímo do SCM logu |
| [ADR-055](./ADR-055.md) | CI runner log a deployment activity jsou dvě odlišné auditní stopy |
| [ADR-056](./ADR-056.md) | Detail projektu je náhled; historie odděluje build od deploymentu |
| [ADR-057](./ADR-057.md) | SCM handoff a InitPad publication nesmějí sdílet jeden stav |
| [ADR-058](./ADR-058.md) | Oprava failed handoffu je explicitní GitHub run attempt |
| [ADR-059](./ADR-059.md) | Ověřený build artifact patří do durable object storage, ne jen do lokálního Docker daemonu |
| [ADR-060](./ADR-060.md) | Environment běží přes workspace-scoped TargetAllocation, ne přímo přes fyzický Target |
| [ADR-061](./ADR-061.md) | Per-environment konfigurace a secrety nasazovaných aplikací |
| [ADR-062](./ADR-062.md) | Provozní zajištění self-hosted nasazení (zálohy, obnova, interní HTTPS, úklid) |
| [ADR-063](./ADR-063.md) | Aktuální built-in URL a životní cyklus lokálních Docker zdrojů |
| [ADR-064](./ADR-064.md) | Fronta CI je explicitní a kapacita runneru je omezená |
| [ADR-065](./ADR-065.md) | CI a externí SCM nesmí blokovat control plane |
| [ADR-066](./ADR-066.md) | Agent trust bootstrap patří fyzickému Targetu |
| [ADR-067](./ADR-067.md) | Agent target je outbound-only a před delivery zůstává nepoužitelný |
| [ADR-068](./ADR-068.md) | Agent heartbeat je minimální, odchozí a provozně obnovitelný |
| [ADR-069](./ADR-069.md) | Agent job je durable target-scoped envelope s fencing lease |
| [ADR-070](./ADR-070.md) | Docker lifecycle Agenta je allocation-scoped allow-list |
| [ADR-071](./ADR-071.md) | Agent delivery odděluje trvalý intent od lease-scoped materiálu |
| [ADR-072](./ADR-072.md) | Projektová operace zůstává autoritou nad Agent jobem |
| [ADR-073](./ADR-073.md) | Produkční Agent target používá spravovanou gateway a stabilní hostname |
| [ADR-074](./ADR-074.md) | Detailní deployment phase je oddělená od transakčního statusu |
| [ADR-075](./ADR-075.md) | Ruční rollback znovu publikuje ověřený artifact bez nového buildu |
| [ADR-076](./ADR-076.md) | Diagnostika workloadu je omezený přepisovaný snapshot, ne logovací služba |
| [ADR-077](./ADR-077.md) | Audit změn je append-only workspace timeline se snapshoty identit |
| [ADR-078](./ADR-078.md) | Potvrzení se řídí dopadem akce, ne HTTP metodou |
| [ADR-079](./ADR-079.md) | Odpojení správy targetu nesmí být skrytý teardown |
| [ADR-080](./ADR-080.md) | Target a allocation jsou oddělené v doméně, spojené v uživatelském modelu |
| [ADR-081](./ADR-081.md) | Audit asynchronní akce odděluje přijetí od autoritativního výsledku |
| [ADR-082](./ADR-082.md) | Produkce je schválení neměnného záměru, ne druhé kliknutí na deploy |
| [ADR-083](./ADR-083.md) | Provozní limity a expirace patří workspace allocation |
| [ADR-084](./ADR-084.md) | Dashboard používá databázový workspace read-model |
| [ADR-085](./ADR-085.md) | Vyhodnocovací metriky jsou omezená projekce deployment operací |
| [ADR-086](./ADR-086.md) | HTTP API je autentizované ve výchozím stavu |
| [ADR-087](./ADR-087.md) | Autorita Agenta je průnik credentialu, targetu a lease |
| [ADR-088](./ADR-088.md) | Nezdravý kandidát se nikdy nestane publikovaným stavem |
| [ADR-089](./ADR-089.md) | Přerušený Agent job se obnovuje deklarativním takeoverem |
| [ADR-090](./ADR-090.md) | Obnovený control plane nesmí zdědit autoritu ani observed stav |
| [ADR-091](./ADR-091.md) | Lokální gate je deterministický, supply-chain kontrola síťová |
| [ADR-092](./ADR-092.md) | Agent je výchozí správa Docker targetu, nikoli jediný konektor |
| [ADR-093](./ADR-093.md) | Agent release je tag-gated, multi-arch a ověřitelný bez důvěry v tag |
| [ADR-094](./ADR-094.md) | Navigace kopíruje uživatelské úlohy a scope nastavení |
| [ADR-095](./ADR-095.md) | Docker je Agent-first, SFTP kompatibilní a SSH runtime pouze migrační |
| [ADR-096](./ADR-096.md) | Agent credential se rotuje dvoufázově s potvrzením nové generace |
| [ADR-097](./ADR-097.md) | Statická kontrola je povinná, type-aware a odděluje produkční kód od test doubles |
| [ADR-098](./ADR-098.md) | Údržba projektů má vlastní lifecycle a reconciliation hranici |
| [ADR-099](./ADR-099.md) | Container reference je immutable a aktualizace prochází build acceptance |
| [ADR-100](./ADR-100.md) | Hosted egress znovu ověří DNS a připne schválenou IP |
| [ADR-101](./ADR-101.md) | Workflow correlation je trvalá, request ID je serverové a logy jsou strukturované |
| [ADR-102](./ADR-102.md) | Citlivé HTTP operace používají distribuovaný per-IP a per-subject limit |
| [ADR-103](./ADR-103.md) | Distribuovaný Agent release je svázaný s digestem i deklarovanou verzí |
| [ADR-104](./ADR-104.md) | Self-hosted instalace vybírá Agent release, cílový server nepotřebuje host CLI |
| [ADR-105](./ADR-105.md) | Dočasná Docker diagnostika má allocation-scoped jméno |
| [ADR-106](./ADR-106.md) | Browser request ID nesmí záviset jen na `crypto.randomUUID` |
| [ADR-107](./ADR-107.md) | Docker resource identity zahrnuje immutable allocation |
| [ADR-108](./ADR-108.md) | Upgrade Agenta ověřuje identitu před zastavením a re-enrollment je explicitní |
| [ADR-109](./ADR-109.md) | Self-hosted distribuční kanál povyšuje Agent 0.12.1 |
| [ADR-110](./ADR-110.md) | Vzdálený update Agenta je podepsaný, typovaný job bez shellu |
| [ADR-111](./ADR-111.md) | On-prem platformu aktualizuje oddělený Supervisor z release bundle |
| [ADR-112](./ADR-112.md) | Multiarch platformní images se staví na nativních runnerech |
| [ADR-113](./ADR-113.md) | Recovery přerušeného platformního updatu provádí jednorázový helper |
| [ADR-114](./ADR-114.md) | Release descriptor se při reboot recovery obnovuje atomickým přesunem |
| [ADR-115](./ADR-115.md) | URL control plane je ověřitelná transportní konfigurace Agenta |
| [ADR-116](./ADR-116.md) | Lokální přihlašovací identifikátory nerozlišují velikost písmen |
| [ADR-117](./ADR-117.md) | Produkční review používá maintain, policy vlastní owner |
| [ADR-118](./ADR-118.md) | Projekt volí jednu ze tří pevných pipeline předvoleb |
| [ADR-119](./ADR-119.md) | Release platformy a Agenta prochází candidate a stable kanálem |
