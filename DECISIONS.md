# Deník rozhodnutí (ADR) — InitPad

Záznamy klíčových návrhových rozhodnutí. Formát: **Kontext** (proč to řešíme) →
**Možnosti** → **Rozhodnutí** → **Proč** → **Důsledky / kompromisy**.
Slouží k tomu, aby bylo v diplomce jasné, *kde* jsme se rozhodovali a *proč*.

---

## ADR-001 — Identita: platforma jako identity provider (řízená registrace)

**Kontext.** Uživatel se registruje na platformě, ale projekty žijí v Gitee.
Kdo je „zdroj pravdy" o uživatelích?

**Možnosti.** (a) Delegovat login na Giteu (přihlášení jen přes Gitea OAuth).
(b) Řízená registrace: platforma sama zakládá uživateli Gitea účet.

**Rozhodnutí.** (b) — registrační formulář na platformě → backend přes Gitea admin
API založí účet a token, uloží do DB.

**Proč.** Cíl je „univerzální" nástroj, kde je platforma vstupní bránou a Gitea jen
backend. Uživatel nemusí Giteu vůbec vidět.

**Důsledky.** Platforma drží admin token Gitey (viz ADR-002). Přihlášení funguje
i heslem, i přes Gitea SSO (viz ADR-005).

---

## ADR-002 — Git operace přes servisní účet (admin + Sudo), ne per-user token

**Kontext.** Platforma musí za uživatele zakládat repa a pushovat. Původně to
dělala uloženým **osobním tokenem** každého uživatele.

**Problém.** Per-user token byl křehký: přihlášení přes Gitea OAuth ho přepsalo
OAuth tokenem, který pro API nefunguje → chyby 401. Token se taky nedá spolehlivě
vytvořit pro čistě-OAuth uživatele (chybí heslo).

**Možnosti.** (a) Opravovat per-user tokeny. (b) Servisní účet: jeden **bot** s
admin právy jedná za uživatele přes hlavičku `Sudo`.

**Rozhodnutí.** (b) — repo se zakládá `Sudo: <uživatel>` (repo patří uživateli),
push jede pod credentials bota, autor commitu se nastaví na uživatele. Čtení
commitů/statusů jde admin tokenem.

**Proč.** Robustní a nezávislé na tom, jak se uživatel přihlásil. Standardní vzor
„platform service account". Blast radius se nemění — platforma admin token už
stejně má (zakládá jím účty).

**Důsledky.** Per-user token je dnes vedlejší (viz ADR-006 o šifrování).
Doporučeno: bota vydat na dedikovaný účet (`initpad-bot`), ne osobní admin.

---

## ADR-003 — Název projektu unikátní per uživatel

**Kontext.** Dva uživatelé chtějí mít projekt stejného jména.

**Rozhodnutí.** DB constraint z globálního `@unique(name)` na složený
`@@unique([ownerId, name])`. Interní identifikátory namespacované vlastníkem:
workspace složka `.workspace/<owner>/<name>`, Docker jméno `<owner>-<name>`,
Gitea repo je pod vlastníkem už z principu.

**Proč.** Bez namespacingu by se stejnojmenné projekty praly o složku i o jména
kontejnerů (jeden by přepsal druhého).

---

## ADR-004 — Stav CI čteme z commit statusů, logy odkazujeme do Gitey

**Kontext.** Chceme v platformě vidět, jak dopadla pipeline.

**Možnosti.** (a) Postavit v platformě vlastní prohlížeč logů. (b) Číst jen stav
(pass/fail/running) a na detail/logy odkázat do Gitey.

**Rozhodnutí.** (b) — každý CI job = jeden Gitea commit status; z nich skládáme
stavy stagí. Kliknutí vede na log v Gitee.

**Proč.** Nekopírovat Gitea Actions UI (hodně práce, malý přínos). Gitea je zdroj
pravdy. „Platforma orchestruje, Gitea je CI nástroj."

---

## ADR-005 — SSO: platforma jako OIDC provider, Gitea jako klient

**Kontext.** Uživatel přihlášený na platformě klikne na privátní repo → Gitea ho
odhlášeného odmítne (404). Chceme jednotné přihlášení.

**Rozhodnutí.** Platforma je OIDC provider (`/authorize`, `/token`, `/userinfo`,
`/jwks`, discovery). Gitea se přidá jako Authentication Source a přihlášení
deleguje na platformu. Odkazy do Gitey vedou přes `/user/login?redirect_to=…`.

**Proč.** Skutečné SSO — přihlášený na platformě se do Gitey dostane jedním
klikem bez psaní hesla. Cross-origin cookie nejde „potichu" nastavit, proto OIDC.

**Důsledky.** Split-horizon adresy: prohlížeč používá `localhost`, Gitea-server
`host.docker.internal`. Podpisový klíč je in-memory (po restartu se mění — pro
prototyp OK).

---

## ADR-006 — Šifrování tokenů v DB (AES-256-GCM)

**Kontext.** Uložené Gitea tokeny jsou citlivé.

**Rozhodnutí.** Šifrovat `accessToken` v DB (formát `enc:v1:…`), klíč z env.
Dešifrování je odolné — při selhání (změněný klíč) vrátí prázdno místo pádu,
protože token je dnes jen fallback (git jede přes bota, viz ADR-002).

**Kompromis.** Změna `INITPAD_ENCRYPTION_KEY` znehodnotí dřív zašifrované hodnoty.

---

## ADR-007 — CI → deploy přes webhook

**Kontext.** Uzavřít E2E: po úspěšném buildu v CI má platforma nasadit.

**Rozhodnutí.** CI `deploy` job zavolá `POST /api/ci/deploy` (autentizace přes
Actions secret repa). Platforma stáhne commit a nasadí dev na pozadí. Nasazuje
se jen z větve `main`.

**Proč.** CI je zdroj signálu „build prošel"; platforma řídí „kam nasadit".
Webhook je jednoduchý a auditovatelný.

---

## ADR-008 — „Build once, deploy many" přes Gitea container registry

> Tohle je rozhodnutí s nejdelším vysvětlením — schválně, protože je jádrem
> správného CD a do práce se hodí popsat pořádně.

### Kontext (proč to vůbec řešíme)

Máme tři prostředí: **dev → test → prod**. Když vývojář „promotuje" z dev do test,
co se má stát? Naivně: postavit aplikaci znovu a spustit ji v test. Jenže tím
**stavíme ten samý kód víckrát** a nikdy nemáme jistotu, že výsledek je bit po bitu
stejný (jiná verze závislosti, jiná cache, jiný čas → jiný obraz). A pak „to, co
prošlo testy", nemusí být „to, co běží v produkci".

Princip **build once, deploy many** (z knihy *Continuous Delivery*): artefakt
postavíš **přesně jednou**, a ten **stejný** posouváš dál. To je jádro toho, proč
promote != nový build.

### Co je „image" a „registry" (pro úplný začátek)

- **Docker image** = zabalená aplikace i s prostředím (kód + Node + závislosti),
  připravená ke spuštění. Něco jako „instalačka" nebo „zip, který se dá rozběhnout".
- **Container** = běžící instance image. Z jednoho image spustíš kolik kontejnerů
  chceš — a všechny jsou identické.
- **Registry** = „sklad obrazů". Server, kam se image **nahraje** (`docker push`)
  a odkud se **stáhne** (`docker pull`). Jako npm registry, ale pro Docker image.
  Gitea má takový sklad **vestavěný** (OCI container registry).
- **Tag** = jmenovka konkrétní verze image, např.
  `registry.local/honza/payments:a1b2c3d`. Ta část za dvojtečkou (`a1b2c3d`) je
  obvykle hash commitu — takže tag jednoznačně říká „přesně tenhle commit".

### Rozhodnutí

CI **postaví image jednou a pushne ho do Gitea registru** pod tagem = hash commitu.
Platforma pak image **jen stáhne a spustí** — a při promote spouští **ten samý tag**
v dalším prostředí. Žádný rebuild.

### Jak to celé teče (krok za krokem)

1. Vývojář pushne commit `a1b2c3d`.
2. Gitea Actions spustí pipeline: `build → test → docker build`.
3. V kroku „docker build" se image nejen postaví, ale i **pushne** do registru:
   `docker login` → `docker build -t <registry>/<owner>/<name>:a1b2c3d .` →
   `docker push …`. Teď je artefakt uložený **jednou** ve skladu.
4. `deploy` job zavolá webhook platformy s hashem `a1b2c3d`.
5. Platforma z hashe složí tag a řekne Dockeru **`docker pull` + spustit** ten
   image v dev. Nestaví nic znovu.
6. Promote do test → platforma spustí **stejný tag** `…:a1b2c3d` na síti test.
   Promote do prod → zase stejný tag. **Build once, deploy many.** ✅

### Proč B (registr) a ne A (sdílený daemon)

Na jednom stroji sdílí runner i platforma tentýž Docker daemon, takže by stačilo
image jen otagovat a spustit bez registru (varianta A). Šli jsme ale do **B
(registr)**, protože:

- **Simuluje reálný svět správně.** V produkci runner a cílové servery běží na
  *jiných* strojích a musí si image předat přes registr. B je ta „opravdová" cesta.
- **Je to silnější argument do práce** — ukazuje kompletní CD řetězec včetně
  skladu artefaktů, ne zkratku, co funguje jen lokálně.

### Kompromisy / na co pozor

- **Split-horizon adresy.** Tag v sobě nese hostname registru a ten musí sedět
  z místa, kde se pushuje, i odkud se pulluje. V našem setupu obojí dělá
  hostitelský Docker daemon, takže používáme adresu dosažitelnou z hostu
  (`localhost:3001`). Registry na `localhost` bere Docker jako „insecure" (HTTP)
  automaticky, takže netřeba TLS.
- **Přísné build-once (žádný tichý fallback u reálných deployů).** Když
  otestovaný image v registru chybí, **CI → deploy i promote úmyslně SELŽOU** –
  nebuildují lokálně jiný (možná odlišný) artefakt. Jediná výjimka je **bootstrap**:
  úplně první nasazení scaffoldu při založení projektu (kdy v registru ještě nic
  není a není se od čeho „lišit") se postaví lokálně. Po prvním pushi (CI) je dev
  nahrazen řádným registrovým image a od té chvíle jede vše striktně z registru.
  Důsledek: promotovat lze jen verzi, kterou CI reálně postavilo a otestovalo.
- **Lowercase.** Jména image musí být malými písmeny; vlastník/název sanitujeme.

### Důsledky pro kód

- `DeployInput` má nové volitelné `imageRef`. `DockerProvider`: když je `imageRef`,
  zkusí `pull` (s přihlášením bota) a spustí; když selže, postaví z repa.
- CI `docker` job: `login` + `build` + `push` do registru.
- Platforma při zakládání repa nastaví Actions secrets s přihlášením do registru.
- `deployEnv` skládá `imageRef` z verze (hash) → promote pak spouští stejný tag.

---

## ADR-009 — Reálné SSH a SFTP nasazení (heterogenní cíle)

**Kontext.** Docker byl jediný reálný cíl; `SshProvider`/`SftpProvider` vracely
falešný výsledek. Pro simulaci firemní infrastruktury chceme **tři různé cíle**:
kontejner (dev/test), vzdálený server přes SSH (prod runtime) a file hosting přes
SFTP (prod statika). To ukazuje, že platforma abstrahuje „kam a jak" nasazuje.

### Co jsou ty cíle (pro úplný začátek)

- **SSH** = přihlásíš se na cizí server a spouštíš na něm příkazy (jako vzdálený
  terminál). My přes něj nahrajeme aplikaci a nastartujeme ji.
- **SFTP** = přenos souborů přes stejné SSH spojení (jako „zkopíruj soubory na
  server"). U statické stránky stačí nahrát soubory, žádný proces neběží.
- Reálné servery nemáme, takže je hrají **kontejnery**: `fake-vps` (sshd + Node)
  a `fake-sftp` (jen SFTP). Chovají se ale jako opravdové – mluvíme s nimi
  skutečným SSH/SFTP protokolem (knihovna `ssh2`), ne „na oko".

### Rozhodnutí

- **SSH (runtime):** nahraj zdroj (tar) → `releases/<verze>` → `npm install` →
  přehoď symlink `current` → (re)start `node` (pidfile, `nohup`) → **health check**.
  App poslouchá na pevném portu z rozsahu **8090–8099** (slot podle hashe
  projektu), publikovaném 1:1 na host → funkční URL a ověřitelný health.
- **SFTP (statika):** nahraj soubory do `releases/<verze>` a **atomicky přehoď**
  symlink `current`. Obsah servíruje **nginx** (`current` = kořen webu).
- **Release + symlink `current`** = standardní vzor „atomického" nasazení:
  rozpracovaný upload nikdy neservíruješ, přepnutí je jen změna symlinku.

### Jak je cíl dosažitelný z platformy

API běží na hostu (`npm run dev`), fake-* v Dockeru. Proto **publikujeme porty**:
SSH `2200`, SFTP `2222`, web `8085`, app `8090–8099`. `config.providers.ssh/sftp`
míří na `localhost:<port>` a defaulty sedí s `infra/docker-compose.yml`.

### Kompromisy / na co pozor

- **Rozsah app portů je konečný (10).** Dva projekty se stejným hashem slotu by
  na `fake-vps` kolidovaly – pro účel simulace (pár projektů) stačí.
- **SSH deployuje ze zdroje** (`npm install` na cíli), ne z hotového image jako
  Docker. Je to klasický „git-style" deploy; „build once" platí pro Docker větev.
- **Bez reálné izolace internetu** – `net-prod` má NAT ven (kvůli `npm install`).
  Izolace prostředí je logická (oddělené sítě), ne bezpečnostní hranice.
- **SFTP zatím nemá šablonu** (chybí statická/React šablona), takže se plně
  vyzkouší až s ní; kód je hotový a reálný.

### Důsledky pro kód

- `providers/ssh-utils.ts` – sdílené promisifikované helpery (connect, exec, SFTP,
  upload tar/adresáře, symlink, rekurzivní úklid).
- `SshProvider` / `SftpProvider` implementují `deploy` + `teardown` + `logs`
  (reálně). Při nedostupném cíli vrací `failed` se srozumitelným důvodem (žádné
  falešné „running").
- `config.providers.ssh/sftp` + nové `INITPAD_SSH_*` / `INITPAD_SFTP_*` proměnné.
- Infra: `infra/fake-vps/Dockerfile` (openssh + Node), služba `static-web`
  (nginx) a sdílený volume `sftp-www`, publikované porty.

---

## ADR-010 — „Connect Git": jednorázové nastavení přístupu ke klonování

**Kontext.** Repozitáře zakládáme jako **privátní** (ADR-001/002). `git clone`
privátního repa vrací nepřihlášenému klientovi z Gitey 404 „Repository not found".
Chceme, aby se vývojář propojil **jednou** a pak klonoval/pushoval bez hesla.

### Co jsou ty „přihlášení" (pro úplný začátek)

Míchají se dvě různé věci: **(A)** vývojář se přihlásí do platformy (session
cookie), **(B)** jeho *stroj* se musí prokázat Git serveru při `git clone`. B je
strojové přihlášení – každý git nástroj (GitHub, GitLab…) k němu potřebuje buď
SSH klíč, nebo **token/heslo** uložené v gitu. „Automaticky" = nastavit B jednou,
pak už si to git pamatuje.

### Rozhodnutí

- Zvolili jsme **token + `git config … insteadOf`** (ne SSH klíč): jeden příkaz,
  bez zásahu do infra. Git přepíše každou http URL Gitey tak, že do ní vloží
  `user:token`, takže čistá URL `git clone http://…/owner/repo.git` funguje sама.
- Token **vydává platforma za uživatele** – v Settings je karta „Connect Git",
  která přes `GET /api/me/git-access` vrátí PAT a složí setup příkaz.

### Zádrhel: Gitea vydá token jen přes Basic auth

Endpoint `POST /users/{username}/tokens` **nepřijímá** admin token ani `Sudo` –
jen Basic auth (username+heslo). Uložený `accessToken` navíc u SSO účtů není PAT,
ale krátkodobý **OAuth2 JWT**, který git-over-HTTP nepřijme.

**Řešení.** `MeController` pozná, že uložený token není PAT (PAT = 40 hex znaků),
a nechá `GiteaService.issueCloneToken()` vydat čerstvý: platforma jako **Gitea
admin** účtu nastaví dočasné náhodné heslo a tím token založí (Basic auth). PAT se
uloží (šifrovaně) pro příště. V tomto modelu se do Gitey přihlašuje přes platformu
(SSO), takže Gitea heslo se jinak nepoužívá a jeho přenastavení nic nerozbije.

### Kompromisy / na co pozor

- **Token v `~/.gitconfig`** (plaintext) – stejný profil jako credential helper
  u GitHubu; pro simulaci na localhostu OK, jde kdykoli odvolat v Giteji.
- **Přenastavení hesla** funguje spolehlivě u **lokálních** Gitea účtů (řízená
  registrace). U účtů z externího auth source (čistě SSO auto-registrace v Giteji)
  může selhat – pak endpoint vrátí `token: null` a UI nabídne **ruční** vygenerování
  tokenu v Giteji (vždy funkční fallback).
- SSH klíč (realističtější) by vyžadoval vystavit Gitea SSH port a správu klíčů –
  ponecháno jako možné rozšíření.

### Důsledky pro kód

- `GiteaService.issueCloneToken(username)` – set-password (admin) + `createUserToken`.
- `MeController` `GET /me/git-access` – vrátí použitelný PAT (nebo `null` → fallback).
- Frontend: stránka **Settings** s kartou „Connect Git"; drobný odkaz u `git clone`
  v detailu projektu.

---

## ADR-011 — Hardening source-based nasazení (izolace, integrita verzí, vlastnictví)

**Kontext.** Audit SSH/SFTP providerů (po ADR-009) našel čtyři slabiny:
(1) SFTP nasazoval do globálního `/www` – dva projekty by se přepsaly a
teardown mazal releases všech; (2) SSH/SFTP nahrávaly aktuální working tree,
takže promote mohl potichu nasadit novější kód, než jaký uživatel povyšoval;
(3) start příkaz `node src/index.js` byl zadrátovaný v provideru (vlastnost
šablony); (4) API neověřovalo vlastnictví projektu (IDOR – UUID stačilo
k operacím nad cizím projektem).

**Rozhodnutí.**

- **Izolace SFTP:** layout `<root>/<owner>-<název>-<env>-releases/<verze>` +
  veřejný symlink `<root>/<owner>-<název>-<env>` → release. URL je
  `<publicUrl>/<slug>/`; nginx servíruje kořen volume a symlink dělá atomické
  přepnutí verze. Teardown/stop se dotýká jen vlastního podstromu.
- **Integrita verzí:** před uploadem se nasazovaná verze exportuje přes
  `git archive <sha>` do dočasné složky (`source-export.ts`). Nasazuje se tedy
  přesně povyšovaný commit; working tree je fallback jen pro ne-git verze
  (bootstrap). Zrcadlí „build once" z Docker větve na úrovni zdrojáků.
- **`startCommand` v manifestu šablony** (+ `artifactDir` pro statické buildy):
  provider je generický, šablona deklaruje, jak se spouští / kde má artefakt.
- **Vlastnictví:** `assertOwner(projectId, userId)` na začátku všech
  uživatelských operací nad projektem (detail, commity, promote, redeploy,
  stop/start/teardown, logy). CI webhook jde mimo (autentizace tokenem).
- Navíc: Docker bez daemonu už nevrací simulované „running", ale `failed`
  s důvodem (konzistence s ostatními providery); `DeployStatus` zná `stopped`;
  `mkdirp` toleruje jen reálně existující adresář (stat), ne každou chybu.

**Kompromisy.** SFTP slug v URL je delší (`/owner-projekt-prod/`), zato
kolize jsou vyloučené. `git archive` přidává ~sekundu na deploy. Port sloty
8090–8099 na fake-vps zůstávají sdílené (kolize možná, v ADR-009 přiznaná).

---

## ADR-012 — Přidělování aplikačních portů z databáze (SSH cíl)

**Kontext.** Aplikace na sdíleném SSH hostu (fake-vps) potřebují unikátní
porty. Původní řešení `port = 8090 + (hash(projekt) % 10)` bylo bezstavové a
jednoduché, ale hash unikátnost negarantuje — při ~5 projektech je kolize
pravděpodobnější než ne (narozeninový paradox) a druhý deploy by přepsal
první. Platforma má po diplomce sloužit reálné výuce s desítkami projektů.

**Rozhodnutí.** `Environment.allocatedPort Int? @unique` — první SSH deploy
prostředí dostane nejnižší volný port z rozsahu (default 8090–8189, sladěno
s publikovanými porty v compose), teardown ho uvolní (`null`). Souběh řeší
unikátní constraint: prohrávající zápis dostane unique violation a zkusí
další port. Provider dostává port v `DeployInput.appPort`; hash-slot zůstal
jen jako fallback pro volání bez přiděleného portu.

**Důsledky.** Vyžaduje migraci DB (`prisma migrate dev`). Plný rozsah =
srozumitelná chyba s návodem („Remove unused deployments or widen
INITPAD_SSH_APP_PORT_SLOTS“).

---

## ADR-013 — Trunk-based development + promotion artefaktu (ne environment branches)

**Kontext.** Nabízí se model „větev na prostředí": dev branch → dev, main →
test, tag/production branch → prod (GitLab Flow). Proč ho platforma nepoužívá?

**Rozhodnutí.** Jedna větev (`main`) + **promotion téhož artefaktu**: každý
push do main → CI postaví a otestuje jeden image → automaticky dev → ručním
promote jde TEN SAMÝ image do test a prod.

**Proč.** (a) Merge mezi environment větvemi typicky spouští nový build —
porušuje „build once, deploy many" (do prod jde jiný binární artefakt, než
prošel testy). (b) Větve se rozjíždějí a „co běží na testu?" se zjišťuje
archeologií v gitu; v promotion modelu je to jeden pohled na kartu prostředí
(verze = hash). (c) Doporučení literatury (Continuous Delivery, DevOps
Handbook, Accelerate) směřuje k trunk-based + promotion. Role prostředí:
**dev** = živé zrcadlo mainu (mění se každým pushem), **test** = stabilní
plocha pro QA/demo (mění se jen vědomým promote), **prod** = ruční schválení.
Continuous deployment (main → rovnou prod) vyžaduje hustou automatizovanou
testovací síť, kterou školní projekty mít nebudou — ruční gate je tu správně.

**Možné rozšíření.** Push do jiné větve než main → dočasné preview prostředí
(vzor Vercel/PR previews); doplněk promotion modelu, ne jeho náhrada.

---

## ADR-014 — Bezstavové zacházení se zdrojáky (žádné trvalé lokální kopie)

**Kontext.** Platforma držela trvalou kopii každého repa v `.workspace/`
(scaffold + `git fetch/reset` při CI deployi) a SSH/SFTP nasazení z ní
exportovala zdroje. Pro reálný provoz je to stav navíc: musí se uklízet,
přežívat přesuny serveru a udržovat v synchronu s Giteou.

**Rozhodnutí.** Zdrojem pravdy o kódu je výhradně Gitea. Nasazení, která
potřebují zdrojáky (SSH, SFTP, bootstrap build Dockeru), si stáhnou archiv
přesného commitu přes Gitea API (`GET /repos/{o}/{r}/archive/{sha}.tar.gz`)
do dočasné složky a po nasazení ji smažou. Scaffold se po pushi do Gitey
maže; `syncFromRemote` byl odstraněn. Lokální `git archive` z (legacy)
pracovní kopie zůstal jen jako fallback.

**Proč.** API server je bezstavový vůči kódu — lze ho přeinstalovat či
škálovat bez ztráty; „je pracovní kopie aktuální?" přestává být otázka;
o zálohy se stará jen Gitea volume + Postgres.

**Kompromisy.** Každý source-based deploy = jeden HTTP download archivu
(na localhostu zanedbatelné). Při nedostupné Gitee source-based deploy
selže s důvodem — což je korektní: bez zdroje pravdy se nemá co nasazovat.

---

## ADR-015 — Instalace jedním příkazem (plně kontejnerizovaný stack + bootstrap)

**Kontext.** Platforma má být snadno nasaditelná kýmkoli — lokálně i na
server pro výuku. Původní runbook měl šest ručních kroků (průvodce Gitey,
tokeny, registrace runneru, OIDC source, migrace, dva `npm run dev`).

**Rozhodnutí.** `deploy/` obsahuje produkční compose (api a web mají vlastní
Dockerfile — uživatel nepotřebuje Node) a idempotentní `install.sh`:
vygeneruje secrety, nastartuje jádro, přes Gitea CLI založí servisní účet,
vydá admin token, zaregistruje OIDC SSO i CI runner, a spustí zbytek stacku.
`INSTALL_LOCK=true` přeskočí webového průvodce Gitey. Server režim = tentýž
compose + profil `server` (Caddy, automatické HTTPS pro dvě domény);
rozdíl proti lokálu je jen v `.env`. Schéma DB se synchronizuje při startu
API (`prisma db push` v entrypointu).

**Proč.** „Instalace = jeden příkaz" je přesně vlastnost, kterou IDP hlásá
pro projekty — platforma ji má splňovat sama (dogfooding). Bootstrap přes
`compose exec` + Gitea CLI nevyžaduje žádné ruční klikání a je opakovatelný.

**Kompromisy.** `install.sh` je bash (Windows → WSL/Git Bash). Dev stack
(`infra/`, `npm run dev`) zůstává oddělený — sdílí jméno compose projektu,
takže se nesmí běžet oba najednou. Registry porty zůstávají publikované na
hostu (push/pull dělá hostitelský daemon).

---

## ADR-016 — Jediný směr identity: odstranění „Continue with Gitea"

**Kontext.** Login platformy nabízel i přihlášení přes Gitea OAuth2 —
pozůstatek z doby před ADR-005. Od zavedení SSO jde identita opačným směrem
(platforma je OIDC provider, Gitea deleguje přihlášení na ni). Obě cesty
najednou matou („kdo je zdroj pravdy?") a hrozí smyčka login ↔ login. Navíc
instalátor OAuth aplikaci v Gitee nikdy nezakládal, takže tlačítko bylo
v čerstvé instalaci nefunkční.

**Rozhodnutí.** Legacy větev odstraněna celá: UI tlačítko, endpointy
`/auth/login` + `/auth/callback`, OAuth-klient helpery v AuthService i
`INITPAD_OAUTH_*` konfigurace. Identita má jediný zdroj: účet platformy
(řízená registrace), Gitea se přihlašuje přes platformu (SSO).

**Důsledky.** Uživatelé existující jen v Gitee se do platformy nepřihlásí —
v modelu řízené registrace takoví legitimně nevznikají (výjimkou je servisní
bot, který se do platformy hlásit nemá).
