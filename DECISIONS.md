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

**Dodatek (audit trail).** Založení repa bylo později přepnuto ze
`Sudo: <uživatel>` na admin endpoint `POST /admin/users/{user}/repos`:
vlastníkem zůstává uživatel, ale aktivita v Gitee se připisuje botovi —
konzistentně s pushem scaffoldu a poctivě vůči tomu, kdo akci skutečně
provedl (automatizace, ne člověk). Sudo dávalo do feedu zavádějící
„uživatel vytvořil repozitář" o akci, o které uživatel nevěděl.

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
`host.docker.internal`. V kontejnerové instalaci je podpisový klíč uložený v
`api-data`, takže restart nerozbije SSO; in-memory klíč zůstává jen dev fallback.

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

Na jednom stroji by technicky šlo sdílet Docker daemon. Runner je ale po
bezpečnostním auditu úmyslně izolovaný ve vlastním rootless DinD, takže image
musí předat přes registry stejně jako v distribuovaném provozu. Šli jsme do **B
(registr)**, protože:

- **Simuluje reálný svět správně.** V produkci runner a cílové servery běží na
  *jiných* strojích a musí si image předat přes registr. B je ta „opravdová" cesta.
- **Je to silnější argument do práce** — ukazuje kompletní CD řetězec včetně
  skladu artefaktů, ne zkratku, co funguje jen lokálně.

### Kompromisy / na co pozor

- **Split-horizon adresy.** Tag v sobě nese hostname registru a ten musí sedět
  z místa, kde se pushuje, i odkud se pulluje. V našem setupu obojí dělá
  hostitelský Docker daemon, takže používáme adresu dosažitelnou z hostu
  (`127.0.0.1:3001`, v CI mapovanou na izolovanou gateway). Lokální registry je HTTP
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
API (`prisma migrate deploy` v entrypointu). Upgrade staré instalace nejprve
ověří její legacy schema a teprve potom bezpečně založí migrační historii.

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

---

## ADR-017 — Reflexe změn provedených přímo v Gitee (systémový webhook)

**Kontext.** Uživatel vlastní své repo, takže ho může smazat i přímo v Gitee.
Platforma o tom nevěděla — zůstal „zombie" projekt: záznam v DB, běžící
kontejnery a obsazený port bez existujícího zdroje. Pushe problém nemají
(CI → deploy webhook, commity se čtou z Gitey živě), smazání repa ano.

**Rozhodnutí.** Gitea → platforma systémový webhook: API si ho při startu
samo idempotentně registruje (`ensureSystemWebhook`, admin API
`/admin/hooks`, události `repository`, autentizace sdíleným tokenem
v Authorization hlavičce). Handler `POST /api/scm/webhook` na událost
`repository/deleted` spustí úplný úklid projektu (teardown prostředí,
uvolnění portů, smazání images a DB záznamu) — stejná cesta jako ruční
smazání, jen bez mazání již neexistujícího repa. Samoregistrace při startu
pokrývá dev i kontejnerový režim bez kroku v instalátoru.

**Kompromisy → dodatek z ostrého testu.** Hook založený přes admin API se
na Gitea 1.22 choval jako „default hook" (šablona pro nová repa) a události
nedoručoval. Autoritativním mechanismem je proto **rekonciliace při čtení**:
načtení seznamu projektů ověří existenci rep (paralelně, s krátkým
timeoutem; smazání = výhradně explicitní 404, výpadek sítě se smazáním
nikdy nezamění) a chybějící projekty uklidí. Uživatelská očekávání zní
„po refreshi vidím realitu" — periodický časovač na pozadí by byl
zbytečná složitost navíc. Webhook zůstává jako okamžitá cesta, když ho daná verze Gitey
doručí. Přejmenování repa v Gitee zůstává nepodporované (rozbije uložené
URL) — vědomé omezení.

---

## ADR-018 — „Všechno je target": cíle nasazení jako první-třídní zdroj

**Kontext.** „Kam se nasazuje" žilo ve dvou oddělených mechanismech: `provider`
u prostředí (docker/ssh/sftp, implicitně mířil na vestavěnou simulovanou
infrastrukturu přes `config.ts`) a osm inline sloupců `target*` na Environment
(údaje vlastního serveru zadané ve formuláři). Dvě cesty pro tutéž věc se
špatně udržují a nešlo v nich čistě vyjádřit, že **schopnost hostit PHP je
vlastnost cíle, ne šablony**: náš vestavěný SFTP je statický nginx (PHP
nespustí), zatímco reálný školní SFTP host (ESO) PHP běžně spouští.

**Co je „target" (pro úplný začátek).** Jedno místo, kam lze nasadit: má druh
(docker/ssh/sftp), adresu + přihlášení a **schopnosti** (co umí spustit —
podmnožina `static,node,php,python`). Prostředí (dev/test/prod) se na jeden
target odkazuje.

**Rozhodnutí.** Zavést první-třídní model **Target**. Cíle jsou dvojího původu:
- **builtin** — vestavěná simulovaná infrastruktura (Docker, SSH VPS, SFTP host),
  seedovaná při startu z `config.ts` (idempotentní upsert se stabilními id).
  Nasazují se dál přes původní „demo" cestu providerů (`connection = undefined`),
  takže jejich chování je beze změny.
- **user** — servery, které si uživatel zaregistruje (host/port/přihlášení,
  tajemství šifrované AES-256-GCM) a ověří tlačítkem **Test connection**
  (`provider.verify()` → uloží `verifiedAt`).

Environment odkazuje na Target (`targetId`); `provider` zůstává jako
denormalizovaná kopie `target.kind` (kvůli mnoha čtecím cestám). **dev/test** se
váží na vestavěný Docker, **prod** na vybraný cíl a **jde ho změnit i po
nasazení** — staré nasazení se nejdřív teardownuje (jinak by osiřelo na starém
cíli). Výběr cíle je hlídán: `template.compatibleProviders` (přípustné druhy)
∩ `template.runtime ∈ target.capabilities` (cíl to umí spustit). Tím se PHP+SFTP
vyřeší samo: vestavěný statický SFTP je z nabídky vyloučen (neumí PHP),
uživatelův PHP-schopný SFTP zahrnut.

**Důsledky pro kód.** Nový `TargetsModule` (`/targets` CRUD + `POST
/targets/:id/verify`), `DeploymentProvider.verify()` u všech tří providerů,
migrace `20260710120000_targets` (tabulka `Target`, `Environment.targetId`,
zrušení inline `target*` sloupců), routy **Infrastructure** (správa a ověřování
cílů) a **Environments** (přehled napříč projekty). Zakládání projektu i změna
cíle běží přes `resolveEnvTarget` / `bindTarget` v `ProjectsService`.

**Kompromisy.** Inline prod-cíle z předchozí verze (ADR mimo) při migraci
zanikají — je nutná jejich re-registrace jako Target (v prototypu, který se
běžně resetuje, přijatelné). Vestavěný SFTP zůstává jen statický; „PHP přes
SFTP" má smysl výhradně na PHP-schopném uživatelském cíli.

---

## ADR-019 — PHP frameworky přes SFTP: verzovaný zdroj + „build-and-extract"

**Kontext.** Frameworkové šablony (Nette/Laravel/Symfony) potřebují před během
`composer install` a adresář `vendor/`. Samotný zdroj z gitu proto není hotový
artefakt pro SFTP hosting. Starší varianta navíc spouštěla `composer
create-project` až při Docker buildu, takže repo neobsahovalo skutečnou aplikaci
a výsledek nebyl dobře auditovatelný ani reprodukovatelný.

**Rozhodnutí.** Šablona verzovaně obsahuje minimální funkční aplikaci,
`composer.json`, `composer.lock` a PHPUnit testy. CI nad ní sestaví jediný Docker
image. Pro SFTP nasazení šablon s `buildArtifactPath` platforma z tohoto image
**vytáhne hotový strom** (`/app`, tedy aplikaci včetně `vendor/`) a nahraje ho
přes SFTP „real-host" režimem (bez symlinku, s web-čitelnými právy). Manifest
deklaruje `buildArtifactPath`, `webRoot` (`www` u Nette, `public` u
Laravel/Symfony) a `writableDirs`. Extrakci dělá
`DockerProvider.extractArtifact`, tok řídí `ProjectsService.deployEnv`.

**Důsledky.** Repo je samo o sobě čitelné a testovatelné; build je díky lockfile
reprodukovatelný. Nette/Laravel/Symfony jsou SFTP-nasaditelné na vlastní PHP
hosting a běží na `<publicUrl>/<slug>/<webRoot>/`. Statické šablony (React/Vue)
nadále jedou přes build + upload `dist/` bez extrakce.

**Kompromisy / na co pozor.** URL končí na `/www/` či `/public/`, protože na
sdíleném hostingu obvykle nelze změnit docroot. `vendor/` znamená tisíce souborů,
takže upload po souborech přes SFTP je pomalejší. Registry image musí existovat
před promote na prod. Stabilní Laravel `APP_KEY` a Symfony `APP_SECRET` se
nastavují jako per-environment secrety podle ADR-061.

**Upřesnění runtime kontraktu (2026-08-03).** Golden-path image musí být po
vygenerování ihned spustitelný, ale nesmí sdílet klíč zapečený do všech
projektů. Laravel a Symfony proto při chybějícím frameworkovém klíči vytvoří
jen pro aktuální kontejner náhodný fallback, který se nezapíše do image ani
logu; trvalé sessions a podepsaná data vyžadují explicitní secret z ADR-061.
Laravel bez backing služeb používá file-backed cache/sessions a jeho `/health`
prochází stejným HTTP middlewarem jako aplikace. Symfony verzovaně obsahuje
nesenzitivní `.env.dist`, produkce nemá zapnutý test mode a optimalizovaný
autoload se generuje až nad kompletním zdrojovým stromem.

Samotný `docker build` není důkaz funkčního runtime. CI Laravel/Symfony po
sestavení image nastartuje kontejner a ověří strukturovanou odpověď skutečné
aplikace. Frameworkové testy navíc vyžadují 404 pro projektové soubory jako
`composer.json` a `.env`; server vždy publikuje jen deklarovaný `webRoot`.

---

## ADR-020 — Produkční nasazení: vrstvy cílů a Kubernetes jako doporučená produkce

**Kontext.** Platforma není „fake" prototyp — nasazovací mašinerie je reálná
(Gitea SCM + OCI registry + Actions CI, PostgreSQL, buildy/deploye image, OIDC
SSO, šifrované secrety, Caddy HTTPS). Potřebujeme rozhodnout, **jak platformu
provozovat reálně** (firma/škola) a **kam nasazovat projekty v produkci**, aniž
bychom ztratili jednoduchou lokální ukázku.

**Rozhodnutí — jeden kód, dva režimy přes „everything is a target" (ADR-018).**

Vrstvy nasazovacích cílů (target kinds):
- **Lokální demo (simulace):** vestavěné cíle — Docker + `fake-vps` (SSH) +
  `fake-sftp`/nginx v izolované síti. Self-contained, bez cloudu; slouží k ukázce.
- **Malé / legacy reálné:** Docker na hostiteli, SSH VPS, nebo SFTP shared
  hosting (např. školní ESO). Už implementováno a funkční.
- **Produkce (doporučeno): Kubernetes.** Build once (CI → image v registry),
  pak deploy image do K8s: **namespace na prostředí** (dev/test/prod, případně
  cluster na prostředí), objekty **Deployment + Service + Ingress** (URL typu
  `projekt-env.apps.org.tld`), tajemství jako **K8s Secrets**, rollout/rollback
  a škálování zdarma, reálná izolace. Stejný tok pro dev/test/prod, liší se jen
  namespace/cluster.

Hosting **samotné platformy:** `deploy/` compose stack (Caddy s automatickým
HTTPS, Gitea, PostgreSQL, CI runner) na jedné VM je legitimní reálné nasazení
pro kurz/malou firmu; ve větším měřítku běží platforma na tomtéž Kubernetes.

**Zařazení do kódu.** Kubernetes je **další `kubernetes` target kind** za
stávajícím rozhraním `DeploymentProvider` (`deploy` / `teardown` / `logs` /
`verify`) — implementace mluví s K8s API (client-go/kubernetes-client) místo
s Docker démonem či SSH. Model targetů (ADR-018) tím zůstává beze změny; jde o
čistě doplněný provider. V tomto kroku je Kubernetes **navržený rozšiřitelný
bod**, ne implementace — Docker/SSH/SFTP zůstávají funkční pro demo a legacy.

**Kompromisy / hardening pro tvrdý multi-tenant prod (patří do Diskuze).**
- API dnes staví/pouští kontejnery přes **host Docker socket** (root-equiv).
  Pro důvěryhodného admina OK; zpevněný prod by build **izoloval** (rootless
  BuildKit nebo build výhradně v CI) a deploy směřoval **do K8s**, ne na lokální
  démon.
- Klíč na šifrování secretů z env → v produkci ideálně **KMS/Vault**.
- Platforma je dnes single-instance (api/web) — pro velký provoz **HA/škálování**
  (a runnery jako pool).
- Auth: platforma je vlastní OIDC provider; ve firmě lze **federovat na firemní
  IdP** (OIDC/SAML).

**Důsledky.** Rámování se mění z „prototyp" na „funkční platforma se dvěma
režimy": simulace pro ukázku, reálné cíle (až po Kubernetes) pro provoz.

---

## ADR-021 — CI běží v odděleném rootless Docker daemonu

**Kontext.** Gitea Actions spouští kód vygenerovaných projektů. Připojení
runneru na hostitelský `/var/run/docker.sock` by libovolnému CI jobu dalo
prakticky root oprávnění nad celým strojem včetně databáze, Gitey a platformy.
Read-only mount socketu tuto pravomoc neomezuje, protože Docker API samo umí
vytvářet privilegované kontejnery a zapisovat na hostitele.

**Možnosti.** (a) Sdílet host Docker socket. (b) Samostatný Docker-in-Docker
daemon. (c) Externí ephemeral runner/BuildKit/Kubernetes.

**Rozhodnutí.** Pro self-contained instalaci (b): `act_runner` mluví jen se
samostatným `docker:*-dind-rootless` daemonem na izolované `ci-control` síti.
Runner nemá host socket ani přístup do platformní datové sítě; CI kontejnery
dostávají pouze explicitní host aliases pro Giteu, registry a deploy webhook.
Image se mezi CI a platformou předává registry, ne sdíleným daemonem.

**Proč.** Zachovává instalaci jedním příkazem a současně odděluje nedůvěryhodný
projektový build od řídicí vrstvy platformy. Zároveň věrněji simuluje firmu,
kde runner a deployment target neběží na stejném daemonu.

**Kompromisy.** Vnější DinD služba stále potřebuje `privileged`; jde o menší,
explicitní trust boundary, ne o absolutní sandbox. Pro nedůvěryhodný
multi-tenant provoz je cílem (c): jednorázové runnery/BuildKit nebo Kubernetes
s network policies, kvótami a omezenými service accounts.

---

## ADR-022 — Deployment je persistentní operace, ne fire-and-forget promise

**Kontext.** Stav `Environment.status` popisuje výsledek, ale nestačí pro řízení
probíhající práce. Dva souběžné promote/redeploy požadavky mohly závodit,
po restartu API nebylo poznat, která operace zůstala nedokončená, a starší
promise mohla přepsat stav novějšího deploye.

**Rozhodnutí.** Každý deploy, promote, redeploy a teardown vytváří záznam
`DeploymentOperation` s typem, fází, požadovanou verzí, výsledkem, chybou a
časovými údaji. Databáze atomicky povolí nejvýše jednu aktivní operaci na
prostředí. Provider před drahými kroky kontroluje požadavek na zrušení a zápis
výsledku je podmíněný identitou operace, takže zastaralý worker nepřepíše novější
stav. Při startu API se osiřelé operace označí jako přerušené a prostředí se
vrátí do konzistentního stavu.

**Proč.** Databáze se stává auditovatelným zdrojem pravdy o tom, co platforma
dělá. Stejný model podporuje UI progress, Activity feed, bezpečné retry i budoucí
přesun práce do fronty bez změny doménového API.

**Kompromisy.** Samotná DB operace ještě není distribuovaná job queue. Pro HA
více API instancí bude dalším krokem durable worker/queue s leases a heartbeatem;
datový model je na to připravený.

---

## ADR-023 — Oddělená autentizace uživatele, CI projektu a SCM webhooku

**Kontext.** Jeden globální CI token dával kompromitovanému repozitáři právo
spouštět deploye jiných projektů. SCM webhook používal token v URL a veřejná
registrace neměla jasný lifecycle ani ochranu proti brute force. Tyto toky mají
jiné aktéry, oprávnění i možnosti rotace a nesmějí sdílet credential.

**Rozhodnutí.** Každý projekt dostane kryptograficky náhodný `deployToken`, který
je uložen jako Gitea Actions secret a autorizuje jen dané repo. Gitea systémový
webhook používá oddělený secret a HMAC podpis nad přesným raw request body;
porovnání tokenů i podpisů je constant-time. Uživatelský login má rate limit,
silnější minimální heslo, bezpečnou session cookie a přesnou allow-list OIDC
redirectů. Registrace má explicitní režimy `first-user`, `open`, `closed`;
čerstvá instalace tedy dovolí bootstrap prvního správce, ale nemusí zůstat
trvale otevřená. Samostatná registrace v Giteji je vypnutá.

**Proč.** Princip least privilege a samostatná rotace: únik CI secretu jednoho
projektu neotevře ostatní projekty ani SCM administraci. Identita zůstává v
jednom směru podle ADR-001/005/016.

**Důsledky.** Starý globální CI secret není autoritativní. V produkci se mají
secrety přesunout z `.env`/DB do Vault/KMS a přidat administrační správu rolí;
pro single-admin prototyp je současný model uzavřený a konzistentní.

---

## ADR-024 — Databázi mění pouze verzované migrace a upgrade selhává bezpečně

**Kontext.** `prisma db push` synchronizuje aktuální model, ale nevytváří
auditovatelnou historii a neumí bezpečně rozhodnout, jak převést starší data.
Existující instalace InitPadu navíc vznikly právě přes `db push`, takže neměly
záznamy v tabulce Prisma migrací.

**Rozhodnutí.** Nové změny schématu jsou výhradně verzované Prisma migrace a
start kontejneru používá `prisma migrate deploy`. Upgrade helper nejprve porovná
legacy databázi s přesně známým výchozím schématem; pouze při shodě staré migrace
bezpečně označí jako aplikované a následně spustí nové. Neznámá nebo částečně
změněná databáze vede k zastavení s návodem, ne k destruktivnímu odhadu.

**Provozní doplněk.** Záloha kombinuje logický PostgreSQL dump s read-only
archivy stavových volumes a kontrolními součty. Záloha obsahuje credentials,
proto musí být šifrovaná a pravidelně ověřená restore drillem.

**Proč.** Deterministické upgrady, reprodukovatelnost do diplomové práce a
možnost obnovy jsou důležitější než pohodlí automatického `db push`.

---

## ADR-025 — Golden-path šablona je verzovaný, testovaný a reprodukovatelný produkt

**Kontext.** Šablona není jen ukázková složka; její chyby se násobí do každého
nového projektu. Dynamické `create-project`, plovoucí závislosti, `npm install`
bez lockfile a CI bez reálných testů vytvářely nereprodukovatelné projekty a
falešný pocit kvality.

**Rozhodnutí.** Každá podporovaná šablona obsahuje skutečný minimální zdroj,
test, multi-stage Dockerfile s explicitním `test` targetem a CI pipeline, která
test target opravdu sestaví. Node šablony používají commitnutý `package-lock`
a `npm ci`; PHP šablony (Laravel, Nette, Symfony) `composer.lock` a PHPUnit;
Python šablony HTTP testy. Runtime image běží bez roota, kde to framework dovolí.
Externí CI action je připnutá na konkrétní commit SHA.

**Proč.** „Golden path" musí být bezpečnější a spolehlivější než ručně založený
projekt. Verze, testy a lockfiles umožňují dokázat, co přesně platforma
vygenerovala a že to v okamžiku vydání fungovalo.

**Kompromisy.** Katalog dvanácti šablon znamená průběžnou údržbu a pravidelné
dependency refresh testy. Nová šablona se nepovažuje za podporovanou, dokud
neprojde renderem, test buildem a dependency auditem.

---

## ADR-026 — Produktové vymezení: opinionated IDP pro malé týmy, výuku a on-prem

**Kontext.** Obecný developer portal typu Backstage řeší široký katalog služeb,
pluginy a dokumentaci. Pokus kopírovat celý tento ekosystém by diplomovou práci
rozmělnil a nepřinesl důvod, proč zvolit InitPad.

**Rozhodnutí.** InitPad se profiluje jako self-contained **golden path**, který
nejen ukáže službu v katalogu, ale skutečně založí repo, dodá testovanou šablonu,
spustí CI a nasadí tentýž artefakt přes dev → test → prod. Primární segment je
výuka DevOps, školní laboratoře, malé vývojové týmy a organizace požadující
jednoduchý on-prem demonstrátor. Enterprise vlastnosti (RBAC, Vault/KMS,
observabilita, HA, policy engine, Kubernetes provider) se v UI nepředstírají;
jsou explicitní roadmapa a hranice nasazení.

**Proč.** Hloubka jednoho ověřitelného end-to-end toku je pro uživatele i
obhajobu hodnotnější než široký, ale povrchní katalog integrací. Vymezení zároveň
umožňuje měřit přínos: čas do prvního běžícího deploye, počet ručních kroků,
úspěšnost golden path a srozumitelnost pro vývojáře bez DevOps zkušenosti.

**Důsledky.** Backstage je referenční konkurent a možný budoucí integrační
frontend, ne produkt, který má InitPad funkčně napodobit. Prioritu mají
spolehlivost provisioningu, bezpečná izolace a měřitelná developer experience.

---

## ADR-027 — Veřejný control plane, školní target pool a infrastruktura uživatele

**Kontext.** Self-contained instalace dobře demonstruje celý DevOps tok, ale
každý tým by musel provozovat vlastní kopii InitPadu. Pro reálné použití ve
škole chceme jednu veřejně dostupnou platformu, do které se přihlásí studenti,
zatímco aplikace a jejich data zůstávají na infrastruktuře školy nebo uživatele.
Současně nechceme vyžadovat, aby si každý student kupoval vlastní VPS.

**Možnosti.** (a) Jedna kompletní instalace InitPadu na tým. (b) Veřejný control
plane, který se na všechny servery připojuje přímo přes SSH. (c) Veřejný control
plane + kombinace školních target pools, přímého SFTP pro ESO a odchozích agentů
pro Docker/VM cíle.

**Rozhodnutí.** (c), přičemž self-contained režim zůstává podporovaný jako demo,
offline laboratoř a referenční implementace. Veřejný control plane spravuje
identity, workspaces, projekty, CI metadata, schválení a deployment
operace. Samotné workloady neběží v control plane:

- škola registruje fyzické servery a publikuje je jako omezený **target pool**;
- učitel přidělí týmu logické target allocations pro dev/test/prod;
- ESO je přímý SFTP/PHP target, protože je veřejně dosažitelný a neumožňuje
  instalaci agenta;
- Docker server, VM nebo počítač za NATem používá **InitPad Agent**, který
  navazuje pouze odchozí HTTPS/WSS spojení a přebírá podepsané deployment jobs;
- běžný veřejný uživatel může místo školního poolu připojit vlastní server.

Fyzický target a přidělení prostředí jsou různé pojmy. Jeden ESO server může
hostovat test i prod, ale každé přidělení má vlastní `remotePath`, `publicUrl`,
kvótu a oprávnění. Stejně tak jeden školní Docker host obslouží více týmů,
aniž by studenti získali credentials k hostiteli.

**Tok ve škole.** Správce založí týmový workspace a target pool → studenti
se zaregistrují jako běžní uživatelé a owner je přidá jako existující účty do
workspace → založí
projekt ze šablony nebo importují repo → CI
postaví a otestuje artefakt → dev se nasadí automaticky na školní Docker pool →
tentýž artefakt jde po promotion do testu a po schválení učitelem do produkce na
ESO či jiný přidělený cíl.

**Kompatibilita.** ESO není univerzální runtime. SFTP/PHP target přijímá PHP a
statické artefakty; Node/Python/server-side Next.js vyžadují Docker, SSH VM nebo
budoucí Kubernetes target. Schopnosti se ověřují přes existující target
capabilities, nikoli názvem prostředí.

**Bezpečnostní důsledky.** Veřejný režim je multi-tenant a nesmí zdědit trust
assumptions single-node profilu. Před jeho vystavením jsou povinné workspaces a
RBAC, tenant-scoped dotazy, bezpečný identity onboarding, audit log, kvóty,
ochrana proti zneužití, externalizované secrety a odstranění host Docker socketu
z control plane. Agent dostává pouze krátkodobé job credentials a omezení svého
target allocation; nemá globální přístup k ostatním týmům.

**Rozsah diplomky.** Implementační MVP zahrnuje jeden veřejný control plane,
workspaces/role a přidávání existujících účtů, import existujícího repozitáře,
target pool, jednoho Docker agenta a ověřený dev → test → prod scénář s ESO.
Billing, plná HA, Kubernetes, marketplace, mobilní agent, globální build cloud a
enterprise federation zůstávají návrhem po obhajobě.

---

## ADR-028 — Workspace je tenant a jediná autorizační hranice

**Kontext.** `Project.ownerId` a `Target.ownerId` původně znamenaly zároveň SCM
identitu i oprávnění. To znemožňovalo týmové projekty: spolupracovník mohl být
vidět v UI, ale nebyl vlastníkem řádku ani privátního repozitáře.

**Rozhodnutí.** Viditelnost a oprávnění se odvozují výhradně z `Workspace` a
`WorkspaceMember`. Aktivní workspace posílá klient v `X-Workspace-Id`; backend
hlavičce nevěří a pokaždé ověří membership. Role jsou owner/admin/maintainer/
member/viewer; viewer pouze čte, ostatní mohou pracovat s projekty, owner/admin
spravují členství. `ownerId` zatím zůstává jako SCM/credential identita, takže
migrace nepřejmenovává repozitáře, registry images ani deployment slugy.

Každý existující uživatel dostane deterministický osobní workspace a jeho data
se backfillují. Osiřelý projekt migraci zastaví místo náhodného přiřazení.
Přidání/změna/odebrání člena současně synchronizuje oprávnění collaboratorů do
privátních Gitea repozitářů (viewer=read, member/maintainer=write, admin=admin).

**Důsledky.** API používá centrální workspace policy místo rozptýleného
`assertOwner`. Aktivní workspace je UX filtr, zatímco přímý projektový odkaz je
povolen každému skutečnému členovi jeho workspace. Osobní workspaces nelze
smazat; týmový lze odstranit jen prázdný a pouze ownerem.

---

## ADR-029 — Agent MVP používá HTTPS polling a omezený job protokol

**Kontext.** Veřejný control plane se nesmí připojovat inbound SSH na školní či
zákaznické Docker servery ani posílat obecné shell příkazy. Potřebujeme přitom
odolné doručování práce přes NAT a srozumitelný rozsah diplomky.

**Rozhodnutí.** První agent používá odchozí HTTPS polling/long polling. Jeden
agent reprezentuje jeden Linux Docker target. Jednorázový enrollment token se
vymění za rotovatelnou identitu svázanou s tenantem a targetem. Agent přijímá
jen verzované strukturované operace pro lifecycle služby, logy, health check a
rollback; obecný shell není součástí protokolu.

Job má lease, heartbeat, correlation ID a idempotency key. Opakované doručení
stejného deploymentu nesmí vytvořit další síť či kontejner. Agent reportuje
verzi, capabilities, poslední kontakt a omezené resource telemetry. Secret
hodnoty mohou zůstat pouze lokálně; control plane zná jen reference a stav.

**Kompromisy.** Polling má vyšší latenci a počet HTTP požadavků než WebSocket,
ale jednodušší reconnect, proxy a testování. WebSocket/message broker je pozdější
optimalizace. Agent s Docker socketem je root-equivalent na svém cílovém serveru,
proto musí vynucovat target allocation a nikdy nesmí přijímat cizí job.

---

## ADR-030 — GitHub je výchozí cloudový SCM, Gitea zůstává self-contained cestou

**Kontext.** Veřejný InitPad nemá důvod provozovat vlastní Git server pro každého
uživatele, pokud většina cílových týmů už pracuje na GitHubu. Úplné odstranění
Gitey by ale zrušilo offline/reprodukovatelný profil diplomky, školní laboratoř
bez externího účtu a možnost organizace držet kód on-premise. Přihlášení uživatele
a oprávnění automatizace k repozitářům jsou navíc dvě různé bezpečnostní vazby.

**Rozhodnutí.** Hosted profil nabídne GitHub jako výchozí SCM, CI a registry
provider; self-contained profil si ponechá Giteu. Projektová doména nebude znát
konkrétní API, ale rozhraní `ScmProvider`. GitHub integraci zajistí jedna GitHub
App, nikoli široce oprávněný klasický OAuth App:

- OAuth user authorization GitHub App slouží pro `Sign in with GitHub` a
  explicitní propojení existujícího InitPad účtu;
- instalace GitHub App do osobního účtu/organizace určuje konkrétní repozitáře,
  webhooky a oprávnění automatizace;
- automatizace používá krátkodobé installation tokeny a neukládá je trvale;
- externí identita se ukládá jako provider + neměnné GitHub user ID. Shodný
  e-mail sám nikdy nesmí účty sloučit;
- vytvoření/import GitHub projektu vyžaduje propojenou identitu a platnou
  instalaci pro zvoleného ownera/repo. Uživatel se ale může přihlásit, být přidán
  do workspace nebo pracovat s Gitea projektem i bez instalace GitHub App;
- workspace RBAC zůstává autorizačním zdrojem InitPadu. GitHub collaborator/team
  přístupy se synchronizují jako externí efekt a musí mít reconciliation/audit.

Minimální oprávnění se volí pro každou operaci zvlášť: běžné čtení dostane jen
metadata/contents read; zápis obsahu, commit statuses, secrets, packages a
administration se přidají pouze operaci, která je potřebuje. Široký univerzální
installation token se nerazí. Konkrétní App permissions musí být uživateli
vysvětlené při nasazení. Oficiální dokumentace doporučuje GitHub Apps kvůli jemnějším
oprávněním, výběru repozitářů, krátkodobým tokenům a vestavěným webhookům:
https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps

**Důsledky.** Cloudový onboarding má dvě viditelné fáze `Continue with GitHub`
a `Install/Configure GitHub App`; UI je nesmí vydávat za jediný souhlas. Stav
`connected`, `installation missing`, `repository not granted` a `revoked` je
součástí preflightu. GitHub výpadek nesmí zablokovat přihlášení jiným providerem
ani již běžící workloady. Gitea E2E zůstává povinný pro obhajobu; GitHub E2E je
samostatný cloudový acceptance test.

---

## ADR-031 — CI runner registrujeme adresou dosažitelnou i z izolovaných jobů

**Kontext.** `act_runner` ukládá adresu Gitey při registraci a checkout action
ji později použije uvnitř kontejneru jobu. Interní Compose jméno `gitea:3000`
je dostupné control-plane kontejnerům, ale z bezpečnostně odděleného rootless
DinD jobu se nepřekládá.

**Rozhodnutí.** Runner má explicitní `INITPAD_GITEA_RUNNER_URL`. Lokálně je
to `host.docker.internal`, mapované v runneru, jobu i nested daemonu na host
gateway; serverová instalace použije veřejné DNS/TLS. Browser-facing
`gitea.localhost` se do CI nepřenáší, protože glibc v Ubuntu runner image
rezervované `*.localhost` překládá na IPv6 `::1` i přes Docker IPv4 mapping.
Ze stejného důvodu mají CI registry a callback samostatnou gateway adresu;
Gitea secrets existujících repozitářů API při startu reconciliuje. Installer
při změně uložené adresy
jednorázově odstraní původní záznam se zastavenou Giteou, smaže lokální
stav a runner zaregistruje znovu.

**Důsledky.** Checkout i registry používají jeden hostname dosažitelný ve
všech síťových kontextech. Rotace zároveň zneplatní starý dlouhodobý runner
token; pouhé přepsání `/data/.runner` je zakázané, protože by staré
credentials zůstaly platné.

Lokální Gitea registry na host gateway používá HTTP. Nested daemon proto
označuje jako insecure **jen** přesný interní alias
`host.docker.internal:<gitea-port>`; veřejná registry doména na serveru na
allow-listu není a nadále vyžaduje ověřené TLS.
Gitea registry vrací token realm ze svého kanonického `ROOT_URL`, proto má
daemon mapování i pro lokální `gitea.localhost`; job samotný ho pro checkout
ani callback nepoužívá. Protože obecné Docker `host-gateway` může ukazovat na
nesouvisející výchozí bridge (`172.17.0.1`), oba aliasy v izolovaném daemonu
explicitně používají gateway jeho fixní `ci-control` sítě (`172.31.250.1`).
Hostitelský daemon naopak používá explicitní IPv4 loopback
`127.0.0.1:<gitea-port>`; tím se vyhne platformně závislé preferenci `::1` pro
`*.localhost` a zůstává v automaticky lokálním HTTP registry rozsahu Dockeru.

CI notifikační job se spouští přes `if: always()` a předává výsledek
image-producing jobu. Neúspěšný build/test/docker tak uzavře deployment jako
`failed` namísto nekonečného `deploying`. Detail projektu navíc reconciliuje
terminální neúspěch ze SCM statusů jako kompatibilní pojistku pro repozitáře
vytvořené ještě se starým workflow.

---

## ADR-032 — „Run again“ bez prázdných commitů přes dočasný CI tag

**Kontext.** Po zrušení prvního dev nasazení zůstalo prostředí prázdné a
UI nemělo cestu zpět. Gitea 1.22 současně nemá REST API pro rerun workflow;
webový endpoint vyžaduje uživatelskou session a CSRF token. Vytvořit prázdný
commit by sice vyvolalo `push`, ale znečišťovalo by historii projektu.

**Rozhodnutí.** Když už existuje otestovaný image z neúspěšného/zrušeného
deploye, InitPad opakuje jen deployment. Jinak vytvoří dočasný tag
`initpad-retry-*` na posledním SHA, čímž spustí stejné CI bez změny commit
historie. Retry je v DB vedené jako aktivní `ci-retry` operace; callback smí
nasadit jen tehdy, když tato operace stále běží. Cancel ji ukončí, takže
pozdní callback nic nenasadí. Tag se po callbacku odstraní a staré retry tagy
se uklízejí před dalším pokusem.

**Důsledky.** Uživatel dostane `Run again` přímo v menu prázdného/selhaného
dev prostředí. Zdrojový strom i SHA zůstávají stejné, audit operace je v
platformě a opakování respektuje `build once, deploy many`, pokud image už
existuje.

---

## ADR-033 — Runtime image musí ověřit bootstrap, ne jen Composer závislosti

**Kontext.** Nette production stage generoval authoritative Composer classmap
dříve, než do image zkopíroval `app/`. CI test stage používal běžné PSR-4 a
prošel, zatímco runtime nenašel `App\Bootstrap`. PHP built-in server navíc u
nezachycené chyby vrátil tělo Fatal error s HTTP 200, takže prostý status health
check dal falešně zelený výsledek.

**Rozhodnutí.** Production dependencies dostanou `app/` před authoritative
`composer dump-autoload` a runtime build explicitně ověří
`class_exists(App\Bootstrap)`. Front controller zachytí `Throwable`, zaloguje
detail pouze server-side a klientovi vrátí HTTP 500 s obecným JSON.

**Důsledky.** Chybný runtime autoload zastaví už CI build. Pokud selže pozdější
bootstrap/configurace, deployment health check uvidí 500 a prostředí se
neoznačí za zdravé.

---

## ADR-034 — Smazání projektu je ověřený cleanup plán, ne odstranění jednoho řádku

**Kontext.** Projekt může mít kontejnery, procesy nebo soubory na dev/test/prod
targetech, image v registry, CI credentials a zdrojový repozitář. Původní dialog
všechny dopady skryl do jedné věty a backend po SFTP `rm -rf` nekontroloval
návratový kód. Control-plane záznam tak mohl zmizet, i když externí workload
nebo adresář zůstal bez vlastníka.

**Rozhodnutí.** Skutečné smazání projektu vždy uklidí všechna nasazení,
protože ponechat běžící prod bez řídicího záznamu není podporovaný stav.
Aktivní, zastavený nebo neúspěšný prod vyžaduje vedle opsání názvu
samostatné potvrzení v UI i API. Zdrojový repozitář se maže jen po
explicitním opt-in; jinak se zachová kód, odstraní InitPad Actions secrets a
Actions se vypnou. Vygenerované artefakty a project record se uklidí vždy.
Deployment target reprezentuje sdílený server, a proto se nikdy nemaže spolu
s projektem.

Teardown každého prostředí musí prokazatelně uspět. Po dílčím úspěchu se
prostředí označí jako prázdné; při pozdější chybě zůstane projekt i chybový
stav v databázi a uživatel může cleanup zopakovat. Repo a project record se
odstraní až po úspěchu všech targetů.

**Důsledky.** Delete dialog funguje jako přehled dopadu, ne jako falešně
jednoduché tlačítko. Uživatel nemůže omylem vytvořit neřízený produkční
workload a výpadek nebo `Permission denied` na externím serveru je viditelný a
retryable. Pozdější funkce Archive bude samostatný nedestruktivní lifecycle
stav, nikoli varianta neúplného delete.

---

## ADR-035 — SFTP runtime adresáře zachovávají přístup deploy identity

**Kontext.** PHP aplikaci nahraje na sdílený hosting SFTP uživatel, ale Nette,
Laravel nebo Symfony může za běhu vytvářet cache a logy pod jinou identitou
PHP-FPM/Apache. Samotné `chmod 0777` kořenového `temp` nestačí: nový podadresář
se řídí umask web procesu a deploy uživatel pak nemusí umět release odstranit.
Jde o riziko různých konfigurací hostingu, nikoli o tvrzení, že dřívější
ruční ESO workflow selhával. Doložený workflow používal pro SFTP i SSH stejný
`${ESO_USERNAME}` a v praxi šel opakovaně nasadit i smazat; ESO tedy nejspíše
spouštělo PHP pod kompatibilní identitou nebo právy. Jeho plošné `chmod 0777`
bylo funkční, ale zbytečně široké bezpečnostní oprávnění.

**Rozhodnutí.** SFTP provider na targetu se shell přístupem vedle kompatibilních
práv nastaví na runtime adresáře defaultní POSIX ACL pro aktuální deploy UID.
Nové cache podadresáře tak zdědí právo deploy identity. Targety bez `setfacl`
zachovají kompatibilní chmod fallback, ale SFTP odstranění nově propaguje
permission/I/O chyby a shell teardown kontroluje exit code. Vzdálené cesty se
v příkazech shellově quoteují.

**Důsledky.** Nové deploymenty na ACL-capable hostingu lze redeployovat a
odstranit, i když PHP běží pod jiným Unix uživatelem. Již existující cizí
soubory ACL zpětně neopraví; jednorázově je musí odstranit jejich vlastník
nebo správce serveru. PHP hosting bez shellu provider odmítne, protože bezpečné
oddělení runtime dat a opakovatelný teardown nedokáže garantovat.

---

## ADR-036 — SFTP publikuje pouze CI artefakt a chráněný webroot

**Kontext.** Statické React/Vue šablony původně spouštěly `npm ci` a build až
uvnitř API kontejneru. Kromě nereprodukovatelného výsledku to znamenalo spuštění
projektového kódu v control plane, který má platformní secrets a přístup k Docker
socketu. U PHP frameworků se naopak celá aplikace nahrála pod veřejný adresář a
URL obsahovala `/www/` nebo `/public/`; kořen vracel Apache `403` a chybná
konfigurace mohla zpřístupnit Composer metadata, konfiguraci nebo zdrojové soubory.
Runtime cache uvnitř releasu navíc bránila jeho výměně, pokud ji vytvořil jiný
Unix uživatel.

**Rozhodnutí.** Všechny SFTP-kompatibilní šablony deklarují absolutní
`buildArtifactPath` a provider extrahuje přesně tento strom z OCI image, který
už prošel CI. Control plane nikdy nespouští `buildCommand` z projektu. U statické
aplikace se publikuje hotový nginx document root; u Nette/Laravel/Symfony se
obsah `www`/`public` publikuje do čistého kořene `<slug>/` a kompletní testovaná
aplikace zůstává pod HTTP-zakázaným `<slug>/.initpad-app/`. Malý kořenový wrapper
načítá původní front controller v jeho nezměněném umístění.

Po health checku provider provede negativní bezpečnostní test: soukromý
`composer.json` a runtime probe nesmějí vrátit HTTP 2xx. Pokud ochranu
`.htaccess` nelze prokázat, deployment se označí za neúspěšný a odstraní.
Zapisovatelné adresáře leží stabilně v neveřejném
`<root>/.initpad-data/<slug>/` a immutable aplikace na ně odkazuje symlinky.
Jejich obsah tak přežije výměnu releasu a webserverem vytvořená cache ji
neblokuje. PHP deployment s runtime adresáři vyžaduje vedle SFTP také omezený
shell přístup; čistý SFTP fallback zůstává podporovaný pro statické artefakty.

**Migrace a důsledky.** Pokud první publish nedokáže starý release kvůli cizímu
vlastnictví odstranit, přesune jeho zbytek do neveřejného adresáře
`.initpad-quarantine` s právy `0700` a pokračuje novým layoutem. Cesta je zalogovaná
a správce hostingu ji musí jednorázově smazat. Nové deploye jsou build-once/
deploy-many, mají čistou URL a opakovaný deploy nemaže PHP runtime data. Target
musí podporovat Apache `.htaccess`, symlinky a shell operace; pozdější target
preflight má tyto schopnosti zobrazit ještě před prvním deploymentem.

---

## ADR-037 — Částečný teardown rozlišuje veřejný workload a cleanup dluh

**Kontext.** Mazání na externím serveru není databázová transakce. Na ESO se
veřejný adresář projektu odstranil, ale následující `rm -rf` skončil chybou na
skryté Nette cache vlastněné PHP runnerem. Jeden nenulový exit code způsobil, že
InitPad označil celý teardown za neúspěšný, ponechal starou URL/verzi a blokoval
smazání projektu, přestože aplikace už nebyla veřejná.

**Rozhodnutí.** SFTP teardown maže veřejný deployment a runtime data odděleně.
Pokud cizí vlastnictví zabrání odstranění runtime stromu, celý jeho kořen se
přesune do HTTP-nepřístupné `.initpad-quarantine`. Provider vrátí strukturované
varování místo obecné chyby. Prostředí přejde na `empty`, ztratí URL a verzi,
ale uchová `Cleanup pending` s přesnými cestami. Menu nabídne `Retry cleanup`,
které po zásahu správce ověří, že dluh zmizel.

Smazání projektu cleanup dluh ve výchozím stavu blokuje. Uživatel má
samostatný serverem vynucený opt-in, který dovolí odstranit záznam InitPadu i
s chráněnými zbytky. Dialog vypíše jejich cesty a vysvětlí, že po odstranění
project record už InitPad retry neprovede. Tato volba je transparentní
`forget/detach`, nikoli tvrzení, že server byl kompletně vyčištěn.

Stejné pravidlo platí pro starý layout, který měl runtime cache přímo uvnitř
veřejného adresáře. Pokud rekurzivní odstranění skončí na cizím vlastnictví,
zbytek celého legacy stromu se přesune pod unikátní jméno v karanténě.
Smazání project record je dovoleno pouze po úspěšném odstranění nebo přesunu
kanonické cesty `<slug>` i pomocných staging/archive cest. Selhání přesunu
zůstává tvrdou chybou, protože v takovém případě nelze bezpečně slíbit, že
nový projekt smí stejné jméno použít.

Po prvním pokusu o smazání UI znovu načte projekt a bez ručního refresh zobrazí
nově vzniklý cleanup dluh a druhé potvrzení. Smazání InitPad záznamu uvolní
jméno pouze ve workspace; pro založení zcela nového projektu se stejným jménem
musí uživatel zároveň smazat zdrojový repozitář. Zachovaný repozitář jeho
jméno v SCM záměrně dál rezervuje pro budoucí „Add existing project“.

**Důsledky.** UI a ESO ukazují stejnou realitu: odstraněná aplikace není
`failed` ani `running`. Skrytá data nikdy neblokují odstranění veřejného
workloadu, ale nejsou potichu zapomenuta. Plně automatický cleanup bez
karantény vyžaduje, aby hosting poskytl společnou Unix identitu, POSIX ACL nebo
InitPad Agenta s oprávněním spravovat runtime soubory.

---

## ADR-038 — Vestavěný SFTP webroot má explicitního vlastníka a write probe

**Kontext.** Pojmenovaný Docker volume připojený do nginx může být při prvním
vytvoření naplněn obsahem image pod `root:root`. SFTP proces se přitom správně
přihlašoval jako neprivilegovaný uživatel `deploy`, který existující `/www`
viděl, ale kvůli právům `0755` v něm nemohl vytvořit projektový release.
Původní ověření targetu volalo pouze `mkdirp` nad existujícím webrootem, a proto
falešně hlásilo zapisovatelný cíl.

**Rozhodnutí.** Compose stack obsahuje jednorázovou inicializační službu, která
před startem SFTP nastaví sdílený volume na UID/GID uživatele `deploy`; oprava
je idempotentní a napraví i již existující volume. SFTP preflight v kořeni
vytvoří a opět odstraní náhodně pojmenovaný probe adresář. Samotná existence
nebo čitelnost cesty se za důkaz zápisu nepovažuje.

**Důsledky.** Čerstvá i upgradovaná instalace umí na vestavěný statický hosting
nasadit React/Vue release. Chybná práva u vlastního SFTP targetu se odhalí už
při `Verify`, nikoli až po CI a pokusu o produkční deploy. Inicializace se týká
jen simulačního volume InitPadu; na uživatelském serveru vlastnictví neměníme.

---

## ADR-039 — Obecné workspaces nahrazují Course doménu; SCM se liší podle edice

**Kontext.** První návrh onboardingu zavedl `Course`, `Join course`, instruktory a
studentské týmy přímo do identity modelu. InitPad ale není pouze školní systém:
stejný produkt musí fungovat pro jednotlivce, malé firmy i self-hosted instalace.
Speciální kurzová registrace duplikovala členství a tlačila jeden use case do
globální navigace.

**Rozhodnutí.** Jedinou organizační a autorizační hranicí zůstává `Workspace`
a `WorkspaceMember`. Účet vzniká podle edice a owner/admin následně přidává
existující účet do týmu; škola je jen způsob použití téhož modelu. `Course` tabulky,
API, navigace a enrollment kód se odstraňují reverzní migrací.

Public SaaS používá GitHub pro identitu/propojení a GitHub App pro SCM, Actions
a GHCR. Self-hosted edice používá vestavěnou Giteu a její správce volí onboarding
policy: otevřená registrace nebo administrátorem provisionované účty.
Dočasné přihlašovací údaje se zobrazí pouze jednou a musí vynutit
změnu hesla. GitHub instalace nikdy není podmínkou samotného vytvoření účtu;
je podmínkou až pro create/import GitHub repozitáře.

**Důsledky.** Produktový model je použitelný beze změny pro firmu i školu.
Správa uživatelů, členství, ověření e-mailu a GitHub adapter jsou samostatné
navazující podkroky. Konkrétní implementaci identity onboardingu popisují
ADR-040 a jeho zjednodušení ADR-042; stav GitHub adapteru zpřesňuje ADR-043.

---

## ADR-040 — Identity a workspace onboarding: registrační politika, správa účtů, pozvánky a obnova hesla

**Stav.** Historické rozhodnutí; body 1 a 4 i související důsledky nahrazuje
ADR-042. Aktuální produkt nemá `WorkspaceInvitation` ani `invite-only` režim.

**Kontext.** ADR-039 zavedl jediný organizační model (workspaces) a vědomě odložil
správu uživatelů, pozvánky, ověření e-mailu a bezpečný reset hesla jako navazující
podkroky. Veřejný multi-tenant control plane (ADR-027) je ale nesmí postrádat:
self-hosted správce potřebuje řídit, kdo si smí založit účet, provisionovat a
deaktivovat účty, a uživatelé potřebují bezpečné pozvánky i obnovu přístupu bez
sdílení hesel v plaintextu.

**Rozhodnutí.**

1. **Edition-aware registrační politika.** `INITPAD_REGISTRATION_MODE` má tři
   kanonické hodnoty: `open` (běžná registrace), `invite-only` (jen držitel platné
   workspace pozvánky) a `admin-provisioned` (účty zakládá pouze správce instance).
   Bez ohledu na politiku smí úplně první účet bootstrapnout administrátora
   instance, takže čistá instalace se nikdy nezamkne. Legacy `first-user`/`closed`
   fungují dál jako aliasy `admin-provisioned`. `INITPAD_EDITION`
   (`self-hosted`|`saas`) odděluje edici; SaaS registrace přes GitHub přijde s
   adapterem (ADR-030).

2. **Životní cyklus účtu a stavové session.** `User` má `active`,
   `mustChangePassword`, `tokenVersion` a `emailVerifiedAt`. Session JWT nese
   generaci (`ver`); guard při každém požadavku načte účet, odmítne deaktivovaný a
   session se starou generací (chybějící `ver` = generace 0, aby deploy nikoho
   neodhlásil). Vynucená změna hesla blokuje všechny endpointy kromě explicitně
   povolených (`me`, `change-password`). Změna i reset hesla a deaktivace posouvají
   generaci, čímž zneplatní existující session.

3. **Platform-admin správa uživatelů.** Chráněná rolí administrátora instance:
   seznam, vytvoření, deaktivace/reaktivace a reset. Vytvoření i reset vrátí náhodné
   dočasné heslo pouze jednou; ukládá se jen jeho scrypt hash a účet musí heslo
   změnit před jakoukoli další operací. Provisioning sdílí cestu s registrací a při
   chybě rolluje Gitea účet zpět; deaktivace nejdřív zakáže Gitea účet (konzistence
   se SCM) a poté zneplatní session. Poslední aktivní administrátor a sebe-deaktivace
   jsou chráněny.

4. **Reálné workspace pozvánky.** `WorkspaceInvitation` nese hashovaný jednorázový
   token, expiraci, roli a auditní stopu (kdo pozval, kdo přijal, stav). Owner/admin
   pozve existující i dosud neregistrovaný e-mail; bez SMTP se odkaz zobrazí ownerovi
   jednou. Přijetí je vázané na e-mail: přihlášený uživatel přijme jen shodou e-mailu,
   nový uživatel se zaregistruje účtem svázaným s pozvaným e-mailem a je přijat v
   jednom kroku (to je cesta registrace pro `invite-only`). Přijetí přidá člena a
   synchronizuje Gitea collaboratora se stejným rollbackem jako přímé přidání.

5. **Ověření e-mailu, reset hesla, rate limiting.** `AuthToken` (kind
   `email_verify`/`password_reset`) je jednorázový, hashovaný a expirující; ukládá se
   jen SHA-256 hash a nový token zneplatní starší nepoužité téhož druhu. Reset
   neenumeruje účty (vždy vrací ok; odkaz se bez SMTP loguje) a posune generaci
   session. Ověření e-mailu vydá odkaz pro vlastní adresu přihlášeného uživatele.
   Všechny veřejné auth endpointy jdou přes existující rate limiter.

**Důsledky.** Self-hosted edice má úplný identity onboarding bez druhé autorizační
domény. Všechny tokeny (session, pozvánky, verifikace, reset) jsou konzistentně
jednorázové nebo řízené generací a nikdy nejsou v DB v plaintextu. Migrace jsou
aditivní (nové sloupce s defaulty, nové tabulky `WorkspaceInvitation` a `AuthToken`),
takže běží na existující DB bez ztráty dat. GitHub adapter (ADR-030/039) zůstává
samostatným navazujícím krokem a tuto vrstvu nemění.

**Uživatelské testování.** Viz PRODUCT_ROADMAP milník 4. Scénáře: normální
registrace; admin-provisioned účet s vynucenou změnou dočasného hesla; pozvání dvou
účtů (existující i nový e-mail) do týmu a ověření role v privátním SCM; reset hesla
zneplatní staré session; deaktivace odepře přihlášení i použití session.

---

## ADR-041 — ScmProvider šev, externí identita a GitHub installation tokeny

**Stav.** Implementační základ; aktuální bezpečnostní hranice a chybějící
repository contract zpřesňuje ADR-043.

**Kontext.** ADR-030/039 rozhodly, že projektová doména bude znát jen rozhraní
`ScmProvider` a že hosted edice použije GitHub App. Tento krok zavádí konkrétní
základ: abstrakci nad SCM, ukládání externí identity podle immutable ID a ražení
krátkodobých installation tokenů — bez blokování hlavního (Gitea) scénáře.

**Rozhodnutí.**

1. **Rozhraní `ScmProvider`.** Repository-doménové operace (provision, delete/detach,
   collaborators, commits, statuses, secrets, archive, retry tag, packages, clone
   token) tvoří rozhraní `ScmProvider` s DI tokenem `SCM_PROVIDER`. Gitea je jeho
   self-contained adapter; hosted build napojí GitHub adapter za stejný token.
   Projektová doména (projects, workspaces, git-access) injektuje rozhraní, ne
   konkrétní třídu. Provisioning účtů (createUser/token, setUserActive) zůstává mimo
   `ScmProvider`, protože je to edition-specific identita (managed Gitea účty vs.
   GitHub OAuth).

2. **Externí identita podle immutable ID.** `ExternalIdentity` váže InitPad uživatele
   na (provider, providerUserId) — neměnné ID poskytovatele. Unikáty zajišťují, že
   jeden poskytovatelský účet patří max. jednomu InitPad uživateli a jeden uživatel má
   max. jednu identitu na providera. Shoda e-mailu nikdy neslučuje účty; „Sign in with
   GitHub" hledá výhradně podle immutable ID.

3. **GitHub App a installation tokeny.** `GitHubAppService` podepíše App JWT (RS256,
   `iat` −60 s, `exp` ≤ 10 min) a vymění ho za krátkodobý installation access token s
   podmnožinou oprávnění vyžádanou konkrétní operací a volitelně omezený na
   konkrétní repozitáře. Výchozí token má pouze metadata/contents read; write
   oprávnění se nepřenášejí mezi nesouvisejícími operacemi. Tokeny se neukládají.
   Bez `INITPAD_GITHUB_APP_ID`/`PRIVATE_KEY` je adapter inertní.

**Důsledky.** Vznikl šev pro druhý SCM adapter, OAuth sign-in/link a část
`GitHubScmProvider`. Šev však není dokončené přepínání provideru: projekt nemá
provider/repository ID a `ScmRegistry` není zapojený do projektové domény. Přesný
zbývající kontrakt popisuje ADR-043 a nesmí blokovat Gitea E2E (ADR-030).

**Uživatelské testování.** Šev a identita jsou ověřeny API unit testy a typecheckem;
chování Gitea zůstává beze změny (regresní testy zelené). GitHub část je bez
nakonfigurované App inertní a ověří se samostatným cloud acceptance testem po dodání
OAuth flow a adapteru.

---

## ADR-042 — Zjednodušení onboardingu: dva režimy, aktivační odkazy, členství jen pro existující účty

**Kontext.** ADR-040 zavedl tři registrační režimy (`open`, `invite-only`,
`admin-provisioned`) a tokenové workspace pozvánky schopné založit nový účet z
pozvaného e-mailu. V praxi se ale `invite-only` a `admin-provisioned` chovaly
stejně (oba jen vypnou veřejnou registraci; pozvánky i admin-create fungují ve
všech režimech), takže třetí režim přidával jen jiný text. Tokenové pozvánky
zakládající nové účty navíc duplikovaly přímé přidání člena (`addMember`) a
rozostřovaly, kdo účty vytváří.

**Rozhodnutí.**

1. **Dva registrační režimy self-hosted edice.** Jen `open` (samoobslužná
   registrace) a `admin-provisioned` (soukromé, účty zakládá správce).
   `invite-only` (a legacy `first-user`/`closed`) zůstávají jako tiché aliasy
   `admin-provisioned`. První účet dál bootstrapuje administrátora. SaaS tuto
   managed-password politiku nepoužívá; účet vzniká pouze z externí identity.

2. **Aktivační odkazy.** Účet založený adminem má vedle jednorázového dočasného
   hesla i **aktivační odkaz**: jednorázový token (`AuthToken` kind `activation`),
   přes který si uživatel nastaví vlastní heslo a je rovnou přihlášen. To je
   preferovaná cesta onboardingu v soukromém režimu.

3. **Členství v týmu jen pro existující účty.** Přidání do týmu probíhá výhradně
   přímým přidáním existujícího uživatele podle username/e-mailu (`addMember`).
   Tokenový systém `WorkspaceInvitation` (včetně registrace přes pozvánku a
   přijímací stránky) je odstraněn reverzní migrací; ruší jen čekající pozvánky,
   účty/workspaces/členství zůstávají.

**Důsledky.** Model je jednodušší a bez redundance: self-hosted účty vznikají
buď samoobsluhou, nebo je zakládá admin; do týmů se přiřazují už existující
účty. Nahrazuje body 1 a 4 ADR-040; body 2, 3 a 5 (životní cyklus
účtu, správa uživatelů, ověření e-mailu/reset) platí dál.

**Uživatelské testování.** Self-hosted `open`: samoobslužná registrace.
Self-hosted `admin-provisioned`: admin vytvoří účet → aktivační odkaz → uživatel
si nastaví heslo a je přihlášen (nebo dočasné heslo s vynucenou změnou). Tým:
majitel přidá existujícího uživatele podle e-mailu; přidání neexistujícího účtu
selže. SaaS onboarding se ověřuje samostatně přes GitHub podle ADR-043.

---

## ADR-043 — Edice jsou bezpečnostní hranice a GitHub vyžaduje explicitní repository contract

**Kontext.** Revize implementace převzaté po handoffu odhalila, že některé
hotové stavební bloky byly v dokumentaci zaměněné za dokončený SaaS tok.
`ScmRegistry` existoval, ale nikdo jej nepoužíval; `Project` ukládal jen URL a
název a GitHub installation jen mutable login. Zároveň SaaS stále zpřístupňoval
native registraci/password login, první OAuth účet mohl získat platform-admin
roli a OAuth-only účet mohl odpojit poslední identitu. Auth tokeny byly nejdřív
načtené a až potom označené jako použité, takže dva souběžné requesty mohly
projít stejným jednorázovým odkazem.

**Rozhodnutí.**

1. **Edition boundary se vynucuje v backendu.** SaaS nepovoluje managed
   registraci, password login ani self-hosted platform-admin správu. První GitHub
   uživatel je běžný uživatel; SaaS administrace dostane později explicitní
   bootstrap, nikoli pravidlo „první návštěvník“. UI pouze odráží serverovou
   politiku a není její bezpečnostní náhradou.

2. **Každý účet musí zachovat použitelný login.** Poslední externí identitu nelze
   odpojit, pokud nemá účet jinou identitu nebo v self-hosted edici platné lokální
   heslo. Pouhá existence password hashe v SaaS není fallback, protože SaaS
   password login nepovoluje. Externí identita se dál páruje jen immutable ID;
   GitHub e-mail se označí ověřený pouze podle ověřeného záznamu `/user/emails`;
   neověřený profilový e-mail se do SaaS účtu neuloží. Dokud není připojený
   skutečný e-mail provider, SaaS nevydává samoobslužný verifikační odkaz.

3. **Platformní a Gitea heslo nejsou stejný credential.** Managed účet použije
   zadané/dočasné heslo jen k vytvoření Gitea účtu a PAT; potom Gitea dostane
   náhodné neznámé lokální heslo. Při self-hosted startu se stejný hardening
   best-effort aplikuje na legacy managed účty. Reset nebo deaktivaci InitPadu
   proto nelze obejít přímým přihlášením stejným heslem do Gitey; běžný SCM login
   vede přes OIDC a Git používá PAT. OIDC authorize/token/userinfo znovu ověřují
   aktivní účet, session generation a `mustChangePassword`; `email_verified`
   odráží skutečný `emailVerifiedAt`, nikoli konstantu.

4. **Jednorázové tokeny a webhooky musí mít atomickou/retry sémantiku.** Claim
   auth tokenu je podmíněný atomický update `unused && unexpired`; uspěje právě
   jeden request. Chyba persistence installation webhooku se nevrací jako 202,
   ale jako 5xx, aby ji GitHub mohl opakovat. Chyba čtení souboru 403/5xx není
   maskovaná jako „soubor chybí“.

5. **Installation token je operation-specific.** Výchozí GitHub token je read-only.
   Contents, statuses, administration, secrets a packages write se žádají pouze
   tam, kde je konkrétní endpoint potřebuje. Tokeny se neukládají. Toto rozhodnutí
   neurčuje finální konfiguraci GitHub App; tu musí potvrdit živý integrační test.

6. **GitHub projekty se nezapojí bez explicitní SCM identity.** Před použitím
   `ScmRegistry` se do datového modelu doplní provider, immutable repository ID,
   owner/full name, default branch a installation binding. GitHub installation
   musí ukládat immutable account ID, rozlišit user/organization, přežít rename a
   mít autorizovanou vazbu na uživatele/workspace. Všechny projektové operace
   následně používají tento locator; odvozování `actor.username + project.name`
   je pouze legacy Gitea kompatibilita.

7. **„Hotovo“ znamená dosažitelný a otestovaný tok.** GitHub adapter není hotový,
   dokud create/import, secrets, archive, CI callback, reconcile a delete používají
   provider projektu a neprojdou živým App E2E. `ProvisioningOperation` musí před
   označením za úplnou orchestraci evidovat kroky create i importu a kompenzovat
   nebo přiznat každý externí efekt.

**Důsledky.** Self-hosted Gitea cesta zůstává funkční a cloudový kód je bezpečnější,
ale public SaaS se zatím nesmí prezentovat jako produkčně hotový profil. Nejbližší
implementační krok není přidání dalšího GitHub endpointu, nýbrž migrace stabilní
identity repozitáře/instalace; až na ní lze bezpečně postavit organizace, import a
stejnojmenná repa.

**Implementace repository contractu (2026-07-17).** `Project` nyní ukládá
`scmProvider`, providerem přidělené `scmRepositoryId`, owner/name/full name,
default branch a volitelnou FK vazbu na interní záznam `GitHubInstallation`.
Kanonický `ScmRepositoryRef` se předává do CI, commitů, collaborators,
archive, deploy/registry názvů, reconcile i delete/detach. URL zůstává pouze
klikací/display hodnota a už se z ní neparsuje owner. Import/preflight posílá
opaque repository ID, takže stejné názvy repozitářů nejsou identita.

Migrační SQL existující řádky označí jako Gitea a bezpečně doplní
souřadnice; immutable ID si nevymýšlí a nechá jej `NULL`, dokud jej startup
reconciliation nenajde u provideru. Následné starty podle uloženého ID obnovují
mutable owner/name/full name/default branch po rename. Repository-delete webhook
preferuje ID a full-name fallback dovoluje jen legacy řádku bez ID. GitHub
operace s již navázaným projektem mintují token přes uložený installation
záznam, ne nový lookup mutable owner loginu.

Tím je dokončen datový základ bodu 6, nikoli celý GitHub tok. Bezpečnou
autorizaci instalace doplňuje ADR-044; projektová doména ale zatím nevybírá
adapter přes `ScmRegistry`.

**Uživatelské testování.** Self-hosted: registrace/admin activation, forced change,
reset/deaktivace a Gitea OIDC/PAT cesta. SaaS se živou OAuth konfigurací: nezobrazí
se password forma, první GitHub účet není admin a poslední identitu nelze odpojit.
Datový základ se regresně ověří migrací existující DB a kompletním
Gitea create/import/deploy/delete tokem bez změny URL. Cloud create/import
zůstává netestovatelný do dokončení bodu 7; potom se ověří
osobní i organizační repo, rename ownera, dvě stejně pojmenovaná repa, odvolání
instalace a retry webhooku.

## ADR-044 — GitHub App instalace je explicitní workspace grant, ne globální webhook stav

**Kontext.** GitHub installation webhook je autentická informace o tom, že App
existuje, ale nedokazuje, který InitPad workspace ji smí použít. Původní model
navíc dohledával instalaci podle měnitelného `account.login`, vedl uživatele
přímo na GitHub bez callback state a při uninstallu záznam fyzicky odstranil.
To je křehké pro rename, organizace, více workspace i audit incidentu.

**Rozhodnutí.** GitHub installation authorization má tyto oddělené vrstvy:

1. `GitHubInstallation.installationId` identifikuje instalaci a `accountId`
   neměnný GitHub user/organization účet. `accountLogin` je pouze měnitelná
   display hodnota. `accountId` je nullable jen pro staré řádky, dokud jej
   nedoplní ověřený webhook nebo setup callback; nový kód jej neodhaduje.
2. Podepsaný webhook instalaci synchronizuje, ale nevytváří oprávnění pro
   workspace. Uninstall nastaví `deletedAt`; záznam, projektová vazba a auditní
   stopa se nemažou a mint tokenu je odmítnut.
3. Owner/admin aktivního workspace zahájí `POST /scm/github/setup`. Server
   vytvoří 256bit náhodný stav, do DB uloží jen SHA-256 hash, naváže jej na
   user + workspace a po deseti minutách jej považuje za neplatný.
4. Veřejný setup callback nejprve najde platný stav, potom ověří
   `installation_id` server-to-server dotazem autentizovaným App JWT. Znovu
   zkontroluje propojenou GitHub identitu a aktuální owner/admin roli a stav
   atomicky spotřebuje právě jednou.
5. U osobní instalace se immutable GitHub account ID musí shodovat s propojenou
   identitou uživatele. U organizace setup callback spustí ještě GitHub user OAuth;
   server porovná vlastníka krátkodobého tokenu s immutable propojenou identitou
   a přes `GET /user/installations` ověří, že právě tento user má k instalaci
   přístup. Token se neukládá ani neloguje. Teprve potom vznikne
   `GitHubInstallationAccess` pro konkrétní workspace. Jedna organizace tak může
   být explicitně přidána do více workspace a jeden workspace může mít více
   instalací bez lookupu podle loginu.

**Důsledky.** Nastavení ukazuje instalace aktivního workspace a tlačítko setupu
jen ownerovi/adminovi s propojeným GitHub účtem. Přímý statický install link byl
odstraněn, protože obcházel vazbu state/workspace. V GitHub App musí být Setup URL
`https://<initpad>/api/scm/github/setup/callback`, OAuth callback
`/api/auth/github/callback` a webhook `/api/scm/github/webhook`. Propojení identity
a instalace spuštěné z již přihlášených Settings se otevírají v izolovaném
popup okně; původní InitPad zůstává na místě a po návratu fokusu znovu načte
identity i workspace instalace. Login `Continue with GitHub` zůstává ve stejném
okně, protože teprve vytváří session.

Pokud GitHub instalaci dokončí, ale kvůli chybějící nebo chybné Setup URL
nevrátí callback, může InitPad obnovit pouze **osobní** instalaci: musí
existovat dosud platný, nespotřebovaný setup state pro stejného usera a
workspace, user musí být stále owner/admin a account ID aktivní instalace se
musí přesně shodovat s immutable ID propojené GitHub identity. State se při
obnově spotřebuje atomicky. Tento fallback se nikdy nepoužije pro organizaci,
protože osobní GitHub identita sama nedokazuje oprávnění za organizaci.

Tento krok dokončuje autorizaci instalace, nikoli GitHub create/import. Starý
owner-login lookup zůstává dočasně jen pro dosud nezapojenou legacy cestu;
nový cloudový tok musí vybírat instalace přes explicitní workspace grant a
projekt ukládat s jejím interním ID.

**Uživatelské testování.** Bez živé GitHub App lze ověřit migraci a regresi
Gitea projektů. Se živou App: propojit GitHub, v osobním workspace nainstalovat
App a ověřit zobrazení instalace; v týmovém workspace zopakovat jako owner pro
organizaci; member tlačítko nesmí vidět. Potom přejmenovat GitHub login,
zkontrolovat aktualizovaný název bez ztráty vazby, suspend/uninstall a ověřit,
že token/repository access selže, ale auditní řádek zůstane. Callback URL se
nesmí podařit použít podruhé ani po expiraci.

**Bezpečnostní doplnění (2026-07-20).** GitHub dokumentace výslovně považuje
`installation_id` v Setup URL za nedůvěryhodný. Současné ověření přes App JWT
prokáže, že instalace patří této App, a u osobního účtu navíc porovnává
immutable user ID. Organizační grant proto nově používá krátkodobý GitHub
App user access token a serverové ověření `/user` + `/user/installations`; token
po callbacku zanikne v paměti procesu. Tím je tato bezpečnostní hranice
implementačně dokončená; stále vyžaduje živý organization acceptance test.
Viz [GitHub — About the setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).

## ADR-045 — GitHub operace rozlišují installation a user token; osobní create vyžaduje rotovatelný credential

**Kontext.** GitHub App installation token je ideální pro automatizaci nad již
existujícími repozitáři a umí založit repozitář organizace. Oficiální endpoint
`POST /user/repos` pro osobní účet ale installation token nepřijímá; vyžaduje
GitHub App user access token. Původní roadmapa proto nesprávně slučovala
osobní a organizační provision do jedného typu credentialu.

**Rozhodnutí.** Běžné repository operace, Actions secrets, archiv a
organizational create používají krátkodobý installation token svázaný s
workspace grantem. Osobní create bude používat GitHub App user access token s
expirací; jeho refresh token bude uložen šifrovaně, rotován atomicky a smazán
při unlink/revocation. User token se nikdy neposílá do CI. GitHub Actions
použijí vlastní krátkodobý `GITHUB_TOKEN` pro GHCR.

Provider mezitím dokončuje operace, které user credential nepotřebují:
stránkovaný seznam repozitářů, přesný tarball refu, lokální scaffold commit,
user/org GHCR cleanup a Actions secrets pomocí auditovaného
`libsodium-wrappers` sealed boxu. Vlastní kryptografický protokol se
neimplementuje.

**Důsledky.** Další migrace rozšíří externí GitHub identitu o šifrovaný,
expirující credential a metadata expirace. Výběr vlastníka repozitáře musí
vycházet z explicitní workspace installation vazby, ne z InitPad username.
Pokud refresh token expiruje nebo je odvolán, UI vyžádá novou autorizaci a
nevytvoří částečný projekt.

**Implementace token vaultu (2026-07-20).** `ExternalIdentity` obsahuje pouze
šifrovaný access/refresh token, jejich expirace, monotonickou verzi a krátký
database refresh lease. Access a refresh hodnota jsou šifrované samostatně pomocí
existujícího AES-256-GCM secret storage; identity API je nikdy nevrací. Minutu
před expirací server token pair obnoví a atomicky nahradí; lease zamezuje tomu,
aby dvě API instance současně spotřebovaly stejný jednorázový refresh token.
Expirace nebo nečitelný secret credential bezpečně vymaže a vyžádá novou
autorizaci. `github_app_authorization: revoked` webhook maže credential podle
immutable `sender.id`, ale zachová identitu jako přihlašovací vazbu; nový OAuth
login/link vault znovu naplní. Organization setup OAuth zůstává striktně
tranzientní a do vaultu se neukládá.

**Implementace GitHub provision adapteru (2026-07-20).** Create vyžaduje
explicitní interní ID instalace autorizované pro workspace; mutable login se
nikdy nepoužije k výběru instalace. Organizace zakládá soukromé repo pomocí
operation-scoped installation tokenu (`Administration: write`), osobní účet
použije rotovatelný user token pouze pro `POST /user/repos`. Secrets se nastaví
před prvním pushem, potom se scaffold pošle installation tokenem s
`Contents + Workflows: write`; token není v argv, remote URL ani `.git/config`.
Při chybě secrets/push adapter nově vytvořené repo kompenzačně smaže.

Sdílené šablony se před GitHub commitem převedou z `.gitea/workflows` do
`.github/workflows`. Registry push uvnitř workflow nepoužívá uložené heslo, ale
automatický krátkodobý `GITHUB_TOKEN` s workflow `contents: read` a
`packages: write`.
GitHub App proto potřebuje repository permissions Administration, Contents,
Workflows, Secrets a Packages na write; Organization ani Account permissions
aktuální tok nepotřebuje. Režim selected repositories zůstává podporovaný,
protože GitHub App automaticky zpřístupní repozitáře, které sama vytvoří.

**Nahrazeno pro nové workflow (2026-07-20).** GHCR publication a požadavek
`Packages: write` nahrazuje artifact handoff v ADR-049. `Packages: write`
zůstává pouze volitelnou cleanup kompatibilitou pro starší repozitáře; nová App
potřebuje `Actions: read`, aby mohla ověřit a stáhnout immutable build.

**Uživatelské testování.** Aktuální adapterový mezikrok je testovatelný
automatizovaně, ale ještě nepřidává nový UI tok. Po dokončení token vaultu a
registry zapojení owner vybere osobní nebo organizační instalaci, vytvoří
soukromé repo, uvidí první Actions run a import zobrazí všechny stránky rep.
Odvolaný/expirující token musí skončit výzvou k reautorizaci bez osiřelého repa.
Samotný vault a provision adapter se nyní ověřují automatizovaně; GitHub
link/login i organization installation setup musí dál projít regresně. Přímý
uživatelský create/rotace/revokace bude dostupný po zapojení `ScmRegistry` do
projektové domény v následujícím podkroku.

Reference: [Create a repository for the authenticated user](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user),
[Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens),
[Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app),
[Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party).

## ADR-046 — Edice určuje SCM; workspace grant určuje GitHub destinaci

**Kontext.** Po dokončení GitHub adapteru projektová doména stále injektovala
globální `SCM_PROVIDER` svázaný s Gitea. Pouhé přepnutí globálního bindingu by
nefungovalo pro existující projekty, migrace, rename ani souběh více GitHub
instalací. Provider selector v UI by navíc porušil produktové rozdělení:
self-hosted má být soběstačný s Gitea, veřejný SaaS používá GitHub.

**Rozhodnutí.** Create/import provider není uživatelská preference. Určuje jej
edice (`self-hosted → gitea`, `saas → github`). U SaaS create uživatel vybírá
pouze cílový osobní/organizační GitHub účet z aktivních instalací explicitně
autorizovaných pro aktuální workspace. Server vždy ověří složenou vazbu
`installation + workspace`, suspend/deleted stav a nikdy nedůvěřuje ID z DTO.
Osobní instalaci smí pro create použít jen InitPad user se shodným immutable
GitHub user ID; organizační instalace je sdílená podle workspace role.
Následné operace vybírají adapter podle `Project.scmProvider` a používají uložený
immutable repository/installation binding.

Společný `WorkspaceScmService` soustřeďuje edition routing, actor identity,
workspace granty a mapování InitPad člena na provider username. Provider-only
`GitHubCoreModule` neimportuje Projects ani Workspaces, takže registry může být
sdílena bez Nest modulárního cyklu. CI callback nebere provider od nedůvěryhodného
runneru: kandidáta podle full name vybere teprve shoda per-project deploy secretu.

Import repozitář nemění, a proto nemůže sám doplnit chybějící pipeline. Preflight
i samotný import serverově vyžadují non-empty repo, platný název, Dockerfile pro
non-static runtime a provider-specific workflow s InitPad callback secrets.
GitHub Actions stav se čte z Check Runs (`Checks: read`) s fallbackem na classic
commit statuses. Starý link, chybějící instalace, suspend a osobní OAuth
credential bez použitelné rotace blokují create ještě v UI i API.

**Důsledky.** Gitea regrese zůstává beze změny a SaaS umí založit/importovat
GitHub projekt. Workspace role se propisuje přes provider identitu; člen bez
propojeného GitHub účtu nemůže dostat neúplný SCM grant. Create kompenzačně
smaže nově vytvořené repo a vždy odstraní lokální scaffold. Původně chybějící
effect journal a recovery importu byly následně doplněny v ADR-047/048.

Samostatně byla odhalena artifact hranice: repository-scoped `GITHUB_TOKEN` je
dostupný pouze uvnitř Actions workflow. InitPad control plane jej nemá a GitHub
Container registry pro CLI pull dokumentuje PAT classic nebo `GITHUB_TOKEN`, ne
GitHub App installation token. Ukládat dlouhodobý uživatelský PAT classic by
zhoršilo bezpečnost i onboarding, proto se nepřidává. Produkční SaaS musí před
živým deploy E2E rozhodnout mezi managed OCI registry s krátkodobými/project-
scoped credentials a agent-mediated artifact transportem. GitHub SCM create,
workflow a Check Runs lze testovat už nyní; privátní GHCR deploy zatím není
prohlášen za produkčně hotový.

**Uživatelské testování.** Self-hosted: zopakovat create/import/commits/retry/
detach/delete na Gitea. SaaS: v New project vybrat osobní instalaci a organizaci,
ověřit private repo, první Actions run a Check Runs; importovat pouze repo s
Dockerfile a `.github/workflows/ci.yml`. Member nesmí instalaci autorizovat,
ale podle workspace role smí použít existující grant. Pokus poslat ID instalace
z jiného workspace musí skončit 400. Suspend/uninstall musí zabránit dalším
operacím bez ztráty auditního project bindingu.

Reference: [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry),
[About permissions for GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages),
[Permissions for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

## ADR-047 — Provisioning používá write-ahead effect journal a kompenzační rollback

**Kontext.** Databázovou transakci nelze atomicky spojit s Gitea/GitHub API.
Dosavadní import nejprve vytvořil `Project`, potom postupně zapsal Actions
secrets a collaborator role; při chybě smazal jen databázový záznam. V cizím
repozitáři tak mohly zůstat částečné credentials nebo změněná oprávnění a
platforma současně ztratila objekt, přes který by šel stav opravit.

**Rozhodnutí.** Každý ne-transakční krok create/import má samostatný
`ProvisioningEffect` s unikátním klíčem a stavem `planned → applying → applied`.
Záměr i přechod do `applying` se musí trvale zapsat před voláním externího API;
bez funkčního journalu mutace nezačne. Chyba vede k reverzní kompenzaci a
stavům `compensated` nebo `compensation_failed`. Metadata obsahují pouze
identifikátory a původní provider-native roli, nikdy token nebo secret hodnotu.

Import rozlišuje přímé collaborator oprávnění od role zděděné přes GitHub
team/organizaci. Rollback proto obnoví původní přímou roli, nebo odebere jen
nově vzniklý přímý grant; zděděný přístup nepřevádí na širší direct grant.
Hodnoty Actions secrets provider z bezpečnostních důvodů neumí přečíst, proto
InitPad spravuje vyhrazené názvy a při částečném selhání je odstraní.

Databázový `Project` se smaže pouze tehdy, když uspěly všechny externí
kompenzace. Pokud cleanup selže, zůstane v dashboardu a detail zobrazí jednotlivé
efekty včetně `cleanup required`; odstranění/detach projektu tak zůstává
dostupnou recovery cestou. Toto je saga/compensation model, nikoli falešná
distribuovaná transakce.

**Důsledky.** In-process částečná chyba je nyní dohledatelná a kompenzovaná.
Stav `applying` je záměrně důkaz nejasného výsledku po tvrdém pádu procesu;
nesmí se automaticky prohlásit za úspěch ani slepě zopakovat. Následující
podkrok doplní startup reconciliation, workspace seznam operací a idempotentní
retry/cleanup. V okamžiku tohoto rozhodnutí nebyl neúspěšný create před vznikem
`Project` v project UI dostupný.

**Navazující implementace.** Recovery, workspace seznam a omezený retry jsou
dokončeny v ADR-048; otevřené body tohoto odstavce tím byly uzavřeny.

**Uživatelské testování.** Běžný create/import musí skončit beze změny UX.
Failure test se provede dočasným odebráním `Secrets: write` GitHub App nebo
simulovanou chybou provideru po prvním zápisu. Pokud cleanup uspěje, projekt ani
InitPad secrets nezůstanou a původní direct role se obnoví. Pokud se během
cleanupu provider odpojí, projekt zůstane v dashboardu a detail ukáže `cleanup
required`; po obnovení provideru lze použít Delete project se zachováním repa
a import zopakovat. Automatizované testy pokrývají obě větve bez manipulace se
živou App.

## ADR-048 — Retry je povolen až po prokázané kompenzaci; recovery používá lease

**Kontext.** Samotný effect journal zachytí částečnou chybu v běžícím
procesu, ale po `kill -9`, restartu nebo ztracené odpovědi mohl zůstat stav
`running/applying`. Slepé opakování by mohlo založit druhé repo, přepsat secret
nebo změnit již existující collaborator roli. Operace bez `Project` navíc nebyla
z projektového detailu dohledatelná.

**Rozhodnutí.** `ProvisioningOperation` ukládá validovaný request bez
credentials, iniciátora, číslo pokusu a odkaz na předchozí pokus. Běžící
create/import i cleanup vlastní process-scoped lease. Po jeho expiraci se
operace atomicky změní na `interrupted` a každý `applying` efekt na
`reconciliation_required`; jiná API instance proto živou operaci nepřeruší.
Dashboard seznam bere z workspace audit logu, takže zobrazí i create, který
selhal před vznikem databázového projektu.

`Retry setup` dostane pouze původní iniciátor s aktuálním workspace write
oprávněním, nejvýše do pěti pokusů. Server jej povolí jen tehdy, když jsou
všechny efekty `planned` nebo `compensated`. Claim původní operace, vznik
dalšího pokusu a označení předchůdce `retried` používají compare-and-set a
jednu databázovou transakci, takže dvojklik ani dva API procesy nevytvoří dvě
legitimní retry větve.

`Retry cleanup` vyžaduje workspace `maintain`. Cleanup sám má CAS stav
`cleaning` a lease. U importu idempotentně odstraní InitPad secret names,
obnoví uložené direct role a až potom smaže Project. U create odstraní
repozitář podle immutable identity z Projectu nebo journal metadata; provider
DELETE toleruje `404`. Smazaný Project se z operace odpojí, takže UI nenabízí
mrtvý odkaz. Selhání libovolné kompenzace projekt zachová a retry neodemkne.

**Důsledky.** Retry je bezpečná explicitní nová operace, ne změna historie.
Staré auditní řádky bez uloženého requestu zůstávají čitelné, ale nelze je
automaticky opakovat. Tvrdý pád se projeví nejpozději po pětiminutové expiraci
lease; Dashboard stav obnovuje po 15 sekundách. Automatický cleanup bez znalosti
provider identity se odmítne a vyžaduje ruční odstranění v SCM.

**Uživatelské testování.** Vyvolat chybu importu po vytvoření Projectu a
ověřit dvě větve. Po úplné automatické kompenzaci Dashboard ukáže neúspěšnou
operaci bez mrtvého project odkazu a s `Retry setup`. Při odpojeném provideru
ukáže `Retry cleanup`, projekt zůstane a setup retry je skrytý; po obnovení
provideru cleanup změní efekty na `compensated` a odemkne retry pouze
iniciátorovi. Viewer/member cleanup tlačítko nevidí a přímé API volání vrátí
403. Failure-injection test navíc simuluje expirovaný lease a ověří
`reconciliation_required`; souběžný druhý claim musí skončit 409.

## ADR-049 — GitHub Actions artifact je ověřený handoff; platforma jej musí převzít

**Kontext.** GitHub Actions umí privátní image publikovat do GHCR pomocí
repository-scoped `GITHUB_TOKEN`, ale tento token správně neopouští workflow.
GitHub dokumentace pro externí private-GHCR pull nenabízí ekvivalentní
krátkodobý GitHub App installation credential. Ukládání uživatelského PAT
classic by rozšířilo oprávnění, zhoršilo revokaci i onboarding. Současně nelze
znovu buildit zdroj až při deployi, protože by se nasazoval jiný výsledek než
ten, který prošel testy.

**Rozhodnutí.** GitHub varianta sdíleného workflow po testech provede jeden
`docker build`, uloží přesně tuto tagovanou image pomocí `docker save` a nahraje
soubor `initpad-image.tar` jako immutable GitHub Actions artifact. Používá
commitově pinovaný `actions/upload-artifact` v7, přímý single-file upload,
jednodenní retention a callback obsahující `artifact-id` i `artifact-digest`.
Gitea workflow se nemění a dál používá privátní registry self-hosted instalace.

CI bearer token nejprve vybere konkrétní Project. GitHub App installation token
s pouze `Actions: read` potom načte autoritativní artifact metadata. InitPad
kontroluje artifact ID, immutable repository ID, workflow run ID, přesný commit
SHA, jméno, expiraci, velikost a shodu callback digestu s GitHub digestem.
Stažení je streamované do privátního dočasného souboru, omezené deklarovanou
velikostí a znovu ověřené SHA-256 nad skutečnými bajty. `BuildArtifact` uchovává
provider/run/commit/digest/lifecycle; opakovaný callback je idempotentní.

Lokální prototyp po ověření zkontroluje Docker archive ještě před importem:
manifest smí obsahovat právě jednu image a právě očekávaný immutable tag. Image
se načte do lokálního Docker daemonu a dev/test/prod používají stejný tag bez
nového buildu. Tag obsahuje commit i GitHub workflow run ID; Environment a
DeploymentOperation mají explicitní vazbu na BuildArtifact, protože samotný
commit SHA není jednoznačný build. UI zobrazuje zkrácený digest a za synchronní
považuje dvě prostředí jen při shodě stejného artifact ID. Callback nečeká na velký download; ingestion a deploy běží jako
sledovaná background deployment operation. Restart změní nedokončenou ingestion
na `failed`; Run again použije lokální ověřenou image pouze pokud skutečně
existuje, jinak spustí nový CI retry místo nekonečného neúspěšného GHCR pullu.

**Důsledky.** Uživatelský PAT ani veřejný registry nejsou potřeba a GitHub App
nemá package read/write kvůli novým buildům. Existující GitHub repozitář se
starým callbackem se nepovažuje za importovatelný, dokud workflow nepřidá
artifact ID/digest handoff. GitHub artifact je jen krátkodobý zdroj přenosu,
nikoli produkční dlouhodobé úložiště: smazání runu/repa nebo expirace jej smaže.
Pro multi-instance veřejný SaaS proto zůstává další krok — okamžité uložení
ověřených bajtů do platformního object storage a výdej agentovi přes krátkodobý
job-scoped download. `storageKind/storageRef` a provider-neutral kontrakt jsou
pro tuto výměnu připravené; `docker-daemon` je pouze prototypová implementace.

GitHub App nastavení pro nový tok: repository `Actions: read`; dále zůstávají
`Administration: write`, `Contents: write`, `Workflows: write`, `Secrets: write`
a `Checks: read` pro již implementované create/config/status operace.
Organization ani Account permissions nejsou potřeba. Po změně oprávnění musí
vlastník přijmout update instalace na GitHubu.

**Uživatelské testování.** V nastavení GitHub App přidat `Actions: Read-only`,
uložit změnu a u instalace přijmout nová oprávnění. Vytvořit nový SaaS projekt
(staré již vytvořené workflow automaticky nepřepisujeme). V GitHub Actions musí
docker job vytvořit `initpad-image.tar`, upload krok zobrazit artifact ID/digest
a deploy callback skončit úspěšně. V InitPadu má dev postupně ukázat
`Downloading and verifying tested image` a `running`; následná promotion do
test musí ukázat stejné artifact ID/digest i 40znakový commit SHA. Negativně změnit artifact ID,
digest nebo SHA v ručním callbacku — API musí vrátit 400 a nespustit deploy.
Import starého GitHub workflow musí zobrazit varování `legacy callback`.

Reference: [GitHub REST API — Actions artifacts](https://docs.github.com/en/rest/actions/artifacts),
[actions/upload-artifact v7](https://github.com/actions/upload-artifact),
[GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations).

## ADR-050 — PHP produkce preferuje deklarovaný SFTP/PHP target; capability změny jsou směrové

**Kontext.** Nette, Laravel a Symfony již byly technicky SFTP-kompatibilní,
ale nový SFTP target se ve formuláři nenápadně uložil pouze s capability
`static`. V jiném workspace mohl existovat starší PHP-capable target, ale
tenant isolation jej správně skryla. Uživatel pak v produkčním selectu viděl jen
Docker bez vysvětlení. Navíc backend blokoval jakoukoli změnu capabilities u
používaného targetu, přestože přidání `php` nemůže zneplatnit existující
statické deploymenty.

**Rozhodnutí.** Capability je nadále pravdivé tvrzení o serveru, nikoli
vlastnost odvozená ze jména „ESO“. Nový SFTP formulář ale jako nejčastější
shared-hosting profil předvolí `static + php`, výslovně vysvětlí požadavek
shell přístupu a dovolí zvolit jen `static`. Přidání capability je povolené i
u targetu v provozu; odebrání capability nebo změna provider kind zůstává
blokovaná, dokud se prostředí nepřesunou. Každá změna capabilities zruší
starý verification timestamp a vyžaduje nový connection test.

Pro PHP framework se při založení projektu preferuje kompatibilní vestavěný
target, potom ověřený workspace SFTP/PHP target a teprve při jejich absenci
Docker. Plain PHP zůstává na Dockeru, protože jeho manifest SFTP nepovoluje.
UI skrytý kompatibilní provider vypíše jménem a uvede chybějící runtime s
odkazem na Infrastructure. Inline textové odkazy používají jednotný zelený
`text-link` affordance; ikony dědí tutéž barvu.

**Důsledky.** Tenant isolation se neobchází a platforma PHP podporu serveru
potichu nevymýšlí. Zároveň uživatel rozliší „chybí PHP capability“ od
„šablona SFTP neumí“ a sdílený target lze bezpečně rozšířit bez odstávky
existující statické aplikace.

**Uživatelské testování.** V týmovém workspace ponechat ESO target jen jako
`static`, otevřít New project a vybrat Nette: ESO se v produkčním selectu
nenabídne, ale žluté vysvětlení uvede jeho jméno a chybějící `php`. Zelený
odkaz otevře Infrastructure. V Edit target zapnout PHP, uložit, znovu provést
Test connection a vrátit se do formuláře: ESO je automaticky vybrané pro prod.
Stejně ověřit Laravel a Symfony. Pokud target již hostí statickou aplikaci,
přidání PHP projde; pokus odebrat `static` zůstane zablokovaný. Odkazy
„Import an existing repository instead“ a opačný tok jsou zelené včetně ikon.

## ADR-051 — GitHub callback je veřejné HTTPS API; SaaS nemá falešné lokální targety

**Kontext.** První živý GitHub create odhalil dvě odlišné chyby. Web každé
repository URL bez ohledu na provider přepisoval na Gitea-only cestu
`/user/login?redirect_to=...`, takže odkaz na privátní GitHub repo skončil na
neexistující GitHub route. Workflow současně dostal
`INITPAD_PLATFORM_URL=http://localhost:8080`. `localhost` uvnitř GitHub-hosted
runneru označuje runner, nikoli notebook s InitPadem, a callback proto nemohl
navázat spojení. Stejný problém ukázal, že veřejný SaaS nesmí nabízet
vestavěný Docker/SSH/SFTP z lokálního self-hosted Compose jako skutečnou
infrastrukturu zákazníka.

**Rozhodnutí.** Odkazy se skládají podle uloženého `scm.provider`. Pouze Gitea
používá svůj login redirect; GitHub repository, commit, Actions run a job URL
zůstávají beze změny. Text pod privátním repem rozlišuje Gitea SSO od
GitHub credential manageru/SSH/`gh auth login`.

Interní Gitea callback (`config.ci.platformUrl`) zůstává oddělený od
`config.ci.publicUrl`. GitHub Actions secret dostane pouze explicitní
`INITPAD_PLATFORM_PUBLIC_URL` (v Compose odvozený z `INITPAD_PUBLIC_URL`). SaaS
create/import se ještě před vytvořením repozitáře odmítne, pokud URL není
veřejné HTTPS nebo je localhost/private address. GitHub status tuto chybu
zobrazí v Settings i create/import UI. Provider kontrolu opakuje před zápisem
secretu. Startup opraví runtime secret existujících repozitářů, až když je
URL platná; potom lze použít Run again.

SaaS seznam targetů obsahuje pouze targety aktivního workspace. New project i
Import vyžadují explicitní ověřený target zvlášť pro `dev`, `test` a `prod`;
stejný server lze vybrat opakovaně, protože deployment cesty zahrnují environment.
Self-hosted ponechá předvolené built-ins, ale i tam lze změnit každé prostředí.
Soukromý/lokální Docker server se do veřejného SaaS připojí odchozím
InitPad Agentem; do jeho implementace se Docker-only šablona bez kompatibilního
workspace targetu pravdivě nedá založit.

**Důsledky.** Lokální vývoj SaaS integrace potřebuje dočasný veřejný HTTPS
tunnel nebo skutečné nasazení. GitHub App OAuth callback, Setup URL a Webhook
URL musejí ukazovat na tutéž veřejnou instanci. Platforma už nevytvoří repo s
předem nefunkční pipeline a neslibuje uživateli control-plane-local dev.

**Uživatelské testování.** S `INITPAD_PUBLIC_URL=http://localhost:8080`
otevřít Settings/New project: UI zobrazí blokující chybu a Create je disabled;
přímé API volání nesmí vytvořit GitHub repo. Nastavit veřejnou HTTPS URL,
upravit tři GitHub App callbacky a restartovat. Odkaz Open repo musí být přímo
`https://github.com/<owner>/<repo>`; nepřihlášený/neoprávněný GitHub uživatel
může u privátního repa nadále legitimně vidět 404. V New project zvolit
ověřený target pro každé prostředí, vytvořit projekt a ověřit úspěšný
callback. U dříve vytvořeného projektu po restartu kliknout Run again.

Reference: [GitHub Docs — private networking with GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/private-networking).

## ADR-052 — GitHub Actions Jobs jsou autorita pro stages; změna targetu vytváří deployment intent

**Kontext.** GitHub workflow reálně běžel, ale Commits skládal stages primárně
z Check Runs. Instalace App bez `Checks: read` proto spadla na classic statuses,
které pro Actions joby nemusejí existovat; stages zůstaly pending a bez URL.
Po změně dev targetu se navíc zobrazovalo obecné `Run again`. To zaměňovalo
GitHub build za deployment na původní server a po teardownu se ztratil odkaz na
již ověřený artifact. Projects stránka mezitím renderovala prázdný stav dříve,
než dokončila první fetch.

**Rozhodnutí.** GitHub provider s již povinným `Actions: read` vybere nejnovější
run workflow `ci.yml` pro konkrétní `head_sha` a načte jeho jobs. `status`,
`conclusion` a `html_url` mapuje na provider-neutral stage; Check Runs a classic
statuses zůstávají jen kompatibilní fallback. Každý dostupný stage odkaz je v UI
zelený a vede přímo na konkrétní GitHub job.

Environment persistuje `deploymentRequired`. Změna targetu nejprve bezpečně
odstraní starý workload, ale zachová poslední version a BuildArtifact jako
releasable build. UI potom nabídne `Deploy`, nikoli `Run again`; úspěšné
publikování flag zruší. Když artifact ještě neexistuje, Deploy vyvolá CI a stav
výslovně vypíše budoucí deployment target. Operace rozběhnuté během migrace
se označí jako deployment intent, aby restart nevrátil matoucí legacy akci.
Projects před dokončením projektů i templates zobrazuje skeleton a prázdný stav
až po autoritativní prázdné odpovědi; změna workspace spustí nový loading stav.

**Důsledky.** `Checks: read` už není podmínkou normálního SaaS status toku;
`Actions: read` současně pokrývá artifact handoff i observability. Změna serveru
nenutí rebuild již ověřeného artefaktu a UI rozlišuje build u GitHubu od deploye
na ESO/SSH/SFTP/Docker target.

**Uživatelské testování.** Otevřít commit během Actions runu: build/test/docker
build/deploy se musí nejpozději po pollingu 2,5 s shodovat s GitHubem a každý již
vytvořený job je klikací. U running dev změnit Docker na ESO: starý workload se
odstraní, karta ukáže `Target changed`, menu `Deploy` a zachovaný build digest.
Deploy musí použít ESO; po úspěchu varování zmizí. U projektu bez artefaktu
musí stav říct `Waiting for CI build; deployment target: ESO school server`.
Při prvním otevření Projects je vidět skeleton, nikdy krátké `No projects yet`.

Reference: [GitHub REST API — workflow runs](https://docs.github.com/en/rest/actions/workflow-runs),
[GitHub REST API — workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).

## ADR-053 — Ruční Deploy nejdřív obnoví hotový GitHub Actions artifact

**Kontext.** Změna deployment targetu na ESO byla v databázi správně, ale
projekt vznikl s `INITPAD_PLATFORM_URL=http://localhost:8080`. Tato hodnota
neurčuje cílový server; je to zpětný callback GitHub-hosted runneru do
control plane. Runner proto mohl dokončit testy a upload artefaktu, ale poslední
`curl` se na notebook uživatele nedostal. Protože InitPad artefakt callbackem
nezaregistroval, dosavadní ruční Deploy vytvořil retry tag a znovu spustil
stejný workflow se stejným nefunkčným callbackem.

**Rozhodnutí.** Ruční Deploy GitHub projektu bez lokálně dostupného buildu
nejprve přes App token s `Actions: read` vyhledá nejnovější neexpirovaný
`initpad-image.tar` pro přesný HEAD commit. Kandidáta znovu ověří stejným
provider-neutral kontraktem jako callback: artifact ID, immutable repository ID,
workflow run, commit SHA, název, digest, expirace a velikost. Následné stažení
znovu ověří digest skutečných bajtů. Teprve potom jej InitPad ingestuje a
nasadí na aktuálně uložený target, například ESO; nový CI run nevznikne.

Pokud vhodný artifact neexistuje, před vytvořením retry tagu se znovu ověří
veřejná HTTPS callback URL. `localhost`, privátní adresa nebo HTTP vyvolá
konkrétní 400 odpověď a nevytvoří další předem nefunkční workflow. Změna
targetu nikdy nepřepisuje callback na target URL, protože ESO hostuje aplikaci,
zatímco callback musí směřovat na InitPad API.

**Důsledky.** Již zaplacený a otestovaný GitHub build lze zachránit po chybě
callbacku a nasadit na nově zvolený server. Recovery je omezená retenční dobou
GitHub artifactu; po expiraci je pro nový build stále nutná veřejná HTTPS URL.
Toto nenahrazuje production SaaS doménu ani Agent delivery.

**Uživatelské testování.** U projektu, jehož Actions run skončil chybou pouze
v posledním callback kroku, nastavit dev target na ESO a kliknout `Deploy`.
GitHub nesmí vytvořit nový run; InitPad zobrazí `Recovering tested GitHub
build`, potom stažení/ověření a nasazení na ESO. Po smazání nebo expiraci
artifactu zopakovat Deploy s `INITPAD_PUBLIC_URL=http://localhost:8080`: UI má
zobrazit vysvětlující chybu a GitHub nesmí dostat retry tag. Po nastavení
veřejné HTTPS URL může nový retry proběhnout a callback se vrátí do InitPadu.

Reference: [GitHub REST API — Actions artifacts](https://docs.github.com/en/rest/actions/artifacts).

## ADR-054 — Pipeline je vázaná na nasazený run; status vede přímo do SCM logu

**Kontext.** Jeden commit může mít více GitHub Actions runs, například po
retry tagu. Commit detail dosud automaticky vybral nejnovější run pro SHA,
který ale nemusel být runem artefaktu skutečně nasazeného na ESO. Při obnově
hotového artefaktu navíc poslední GitHub callback job zůstal historicky
neúspěšný, i když navazující publication v InitPadu proběhla úspěšně.
Kliknutí na environment status současně otevíralo modal se stdout běžící
aplikace; uživatel ale hledal build/deploy log runneru.

**Rozhodnutí.** `BuildArtifact.providerRunId` je autoritativní vazba mezi
nasazenými bajty a GitHub Actions runem. Commit stages proto pro nasazený
artifact čtou joby přímo z `/actions/runs/{run_id}/jobs`, nikoli z libovolného
nejnovějšího runu stejného SHA. Build, test a docker build zůstávají stavy
GitHubu. Finální deploy stage kombinuje job URL tohoto runu s autoritativním
stavem dev prostředí/DeploymentOperation: po změně targetu je pending, při
publication running a po úspěšné recovery success.

Environment status a chybový důvod jsou odkazy otevírané v novém panelu
přímo na konkrétní deploy job GitHub/Gitea Actions. Když job URL ještě
neexistuje, status není falešně klikací. Modal aplikačních logů, jeho polling
a endpoint `GET /projects/:id/logs/:env` se odstraňují. Budoucí aplikační
observabilita bude samostatná doména, ne tlačítko označené deployment logs.

**Důsledky.** UI ukazuje stages artefaktu, který opravdu běží, i když pro
stejný commit existují pozdější retry runs. Uživatel jedním kliknutím otevře
provider-native auditní log a InitPad nemusí proxyovat ani uchovávat logy
runneru. Při recovery může odkazovaný callback job pravdivě obsahovat původní
chybu, zatímco stage je success podle následného prokazatelně dokončeného
deploymentu v InitPadu.

**Uživatelské testování.** U projektu s více runs stejného commitu otevřít
Commits: odkazy stages musí patřit runu uloženému u dev artifactu. Po změně
targetu má deploy stage přejít na pending, během Deploy na running a po
publikaci na success bez nového Actions runu. Kliknutí na status `running`,
`failed` nebo `deploying` musí otevřít konkrétní Actions job v novém panelu;
nesmí se otevřít InitPad modal ani zobrazit stdout kontejneru.

Reference: [GitHub REST API — workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).

## ADR-055 — CI runner log a deployment activity jsou dvě odlišné auditní stopy

**Kontext.** Po úspěšném ručním redeployi ověřeného GitHub artifactu
uživatel správně neviděl nový GitHub Actions run: žádný totiž nevznikl.
InitPad dodržuje build once/deploy many a stejné bajty publikuje na nový target
bez opakování buildu a testů. Odkaz na původní Actions job je audit CI
artifactu, ale nemůže zobrazovat aktuální SFTP upload/extract/publish kroky
probíhající v control plane. UI tyto dva zdroje dostatečně nerozlišovalo.

SFTP teardown současně pravdivě hlásil runtime cache přesunutou do chráněné
karantény. Text `Cleanup pending` ale nevysvětloval, že veřejná aplikace již
neexistuje a canonical path/název jsou volné; zbývá pouze diskový dluh, který
kvůli cizímu Unix vlastnictví odstraní správce targetu.

**Rozhodnutí.** Detail projektu má samostatnou inline `Deployment activity`.
Backend vrací poslední DeploymentOperation pro všechna prostředí, aktuální
nebo poslední krok, stav, dobu, verzi, artifact run a immutable snapshot
provideru/targetu pořízený při startu operace. Provider progress aktualizuje
Environment i operation message, takže existující 2,5s polling ukazuje např.
fetch/extract/upload/publish/verify bez modalu a bez aplikačního stdout.

GitHub/Gitea odkaz je výslovně `CI build log`; menu používá `Deploy verified
build`/`Redeploy verified build` a toast upozorňuje, že nový runner není
potřeba. Nový runner vzniká jen tehdy, když neexistuje použitelný ověřený
artifact a InitPad skutečně vyžádá nový CI build.

Karanténa je v UI popsaná jako archivovaný administrátorský cleanup, který
neblokuje reuse stejné URL cesty ani jména. Již přesunutá data InitPad
nepředstírá, že smí smazat bez oprávnění. Pro budoucí PHP deploymenty
chráněný wrapper nastavuje `umask(0000)`; společně s existujícím chmod/ACL
tím omezuje vznik nových vnořených Nette/Laravel/Symfony cache adresářů,
které deployment účet neumí odstranit.

**Důsledky.** GitHub zůstává autoritou pro build/test log, InitPad pro CD
průběh. Uživatel vidí aktuální deployment bez falešného runneru a historie
nezmění target zpětně po jeho rebindingu. `umask(0000)` je omezený na
izolované runtime adresáře chráněného shared-hosting layoutu, které už byly
záměrně world-writable; nepovoluje HTTP přístup do `.initpad-data`.

**Uživatelské testování.** Na běžícím dev zvolit `Redeploy verified
build`. Na GitHubu nesmí vzniknout nový run. V Deployment activity se do
2,5 s objeví running operace a postupně aktuální krok; po dokončení success,
target ESO, commit a doba. `CI build log` vede na původní artifact run. Potom
deployment odstranit: veřejná URL musí zmizet a hláška karantény musí říct,
že cesta/jméno jsou volné. Nový deploy stejného projektu musí projít; starou
karanténu lze fyzicky odstranit jen administrátorem ESO.

## ADR-056 — Detail projektu je náhled; historie odděluje build od deploymentu

**Kontext.** Detail projektu načítal a zobrazoval dlouhé seznamy commitů a
deploymentů. Každý deployment řádek navíc opakoval stejné GitHub Actions URL,
pokud více publikací záměrně použilo tentýž ověřený artifact. Data byla
technicky správná, ale UI vytvářelo dojem, že každá publikace má vlastní runner
log nebo že se seznam nesynchronizuje.

**Rozhodnutí.** Detail projektu zobrazuje čtyři nejnovější deployment operations
a pět commitů. Pokud existují další záznamy, zelené odkazy `Show all
deployments` a `Show all commits` otevřou samostatné route projektu. Historické
stránky načítají nejvýše 100 nejnovějších záznamů a během aktivní operace/CI se
obnovují častěji; neaktivní historie používá desetisekundový heartbeat.

Odkaz na GitHub Actions run se už neopakuje v každém deployment řádku. Je
deduplikovaný nad zobrazenými operations a označený jako `Source CI build`.
Samotný deployment řádek je autoritativní InitPad CD záznam: environment,
operation kind, immutable target snapshot, stav, message, verze a trvání.
Commit detail nadále vede na konkrétní joby přesného artifact runu.

Query `limit` na commits/deployments má serverový strop 100, aby UI nemohlo
jedním požadavkem bez omezení číst SCM a pro každý commit synchronizovat jobs.
Plná stránkovaná historie může později přidat cursor bez změny tohoto datového
významu.

**Důsledky.** Detail projektu je rychleji čitelný a dvě odlišné auditní stopy
se nezaměňují. Opakované deploymenty stejného artifactu pravdivě sdílejí jeden
source build, ale každý má vlastní deployment operation. Dedikované stránky
poskytují podstatně delší historii bez zahlcení hlavního pracovního toku.

**Uživatelské testování.** U projektu s alespoň šesti commity a pěti
deploymenty otevřít detail. Musí se zobrazit nejvýše pět commitů a čtyři
deploymenty. `Show all commits` a `Show all deployments` musí otevřít vlastní
stránky a Back to project se vrátit na detail. Pro dva redeploye stejného
artifactu smí být GitHub run uveden jednou jako source build, zatímco InitPad
musí ukázat dvě samostatné operations se svým stavem a dobou. Při běžícím CI
nebo deploymentu se historie aktualizuje bez ručního reloadu.

## ADR-057 — SCM handoff a InitPad publication nesmějí sdílet jeden stav

**Kontext.** ADR-054 promítal autoritativní stav InitPad publication do
poslední SCM stage `deploy`, ale ponechával jí URL původního Actions jobu.
Po obnově ověřeného artifactu tak zelená stage odkazovala na historicky
neúspěšný GitHub job. Uživatel viděl pouze `success`, po kliknutí však správně
otevřel failed job, a očekával nový runner. Jeden UI prvek tím nepravdivě
spojoval dvě samostatné události. Tato část ADR-054 je tímto rozhodnutím
nahrazena; vazba stages na přesný artifact run zůstává platná.

**Rozhodnutí.** Pipeline commitu zachová providerem oznámené stage včetně
jejich původního stavu a konkrétního job URL. InitPad přidá samostatnou stage
`publish` se zdrojem `platform`, jejíž stav vzniká pouze z Environment a
DeploymentOperation. Obnovený scénář proto pravdivě ukáže červený SCM
`deploy` a zelený InitPad `publish` současně.

Kliknutí na SCM stage otevírá její GitHub/Gitea job. Kliknutí na `publish`,
stav environmentu nebo jeho chybový důvod otevírá InitPad deployment historii.
UI u kombinace failed handoff + successful publication výslovně vysvětlí, že
InitPad později publikoval tentýž ověřený build. `Deploy verified build`
nespouští nový Actions job: build once/deploy many znovu používá stejné
ověřené bajty a nový runner by bez změny zdrojů pouze opakoval CI.

**Důsledky.** Žádný odkaz již nemá stav z jiného auditního systému. GitHub
zůstává autoritou nad runner jobem a InitPad nad target publication. Celkový
commit může zůstat failed kvůli původnímu handoffu, přestože je vedle něj
viditelné úspěšné publikování; to je přesnější než přepsat historii. Kdyby
uživatel chtěl znovu spustit celý CI run, musí jít o samostatnou explicitní
akci, nikoli implicitní vedlejší efekt redeploye hotového artifactu.

**Uživatelské testování.** Otevřít commit, jehož GitHub `deploy` job selhal,
ale následný `Deploy verified build` na ESO uspěl. Commit musí ukázat failed
`deploy` s odkazem na přesně tento failed job a vedle něj success `publish`.
Pod stages musí být vysvětlení, že další runner nevznikl. `publish` a status
environmentu musí vést na `/projects/:id/deployments`; GitHub stage musí vést
na `/actions/runs/:run_id/job/:job_id`. V GitHub Actions se po redeployi nemá
objevit nový run, zatímco InitPad deployment historie musí obsahovat novou
samostatnou successful operation.

## ADR-058 — Oprava failed handoffu je explicitní GitHub run attempt

**Kontext.** `Deploy verified build` správně neopakuje build/test a publikuje
již ověřené bajty. Po úspěšné recovery ale původní GitHub callback job zůstává
failed. Samotný refresh jej nesmí přebarvit: GitHub je autoritou a bez nového
attemptu se jeho historický výsledek nezmění. Uživatel současně potřebuje
opravit workflow poté, co administrátor zpřístupní veřejný InitPad callback.

**Rozhodnutí.** Tools menu dev prostředí nabídne `Re-run failed GitHub jobs`
jen tehdy, když přesný artifact-producing run obsahuje failed SCM stage a
InitPad `publish` stejného commitu již uspěl. Endpoint z DB přečte immutable
`BuildArtifact.providerRunId`, přes `jobs?filter=latest` ověří failed stav a
zavolá GitHub `POST /actions/runs/{run_id}/rerun-failed-jobs`. Klient po
potvrzení polluje po 2,5 s, takže stage a odkaz přejdou na nejnovější job
attempt bez ručního reloadu.

Před externí mutací InitPad vyžaduje veřejnou HTTPS callback URL a znovu zapíše
aktuální `INITPAD_PLATFORM_URL` do repository secrets. Tím se nereprodukuje
původní `localhost:8080` chyba. GitHub App rozšiřuje repository permission
`Actions` z read na read/write; operation-specific installation token žádá
write pouze pro explicitní rerun. Organization ani Account permission není
potřeba. Existující instalace musí změnu App permission schválit.

Rerun je oddělený od deploy/redeploy. Pokud publication ještě selhává, uživatel
nejprve použije `Deploy verified build`; GitHub rerun nesmí předstírat opravu
targetu. Úspěšný callback stejného již přijatého artifactu je idempotentní a
nový Actions attempt opraví SCM audit bez změny nasazených bajtů.

**Důsledky.** GitHub stav se mění pouze skutečným GitHub pokusem a InitPad
nadále dodržuje build once/deploy many. Rozšíření `Actions: write` umožňuje App
spouštět Actions reruns, proto je akce autorizovaná workspace write rolí,
explicitní a omezená na run uložený u projektu. GitHub dovoluje rerun jen v
časovém/attempt limitu poskytovatele; jeho odmítnutí se zobrazí beze změny
InitPad publication.

**Uživatelské testování.** V GitHub App nastavit repository `Actions: Read and
write`, Organization/Account ponechat prázdné a schválit update existující
instalace. InitPad musí být na veřejném HTTPS originu a
`INITPAD_PLATFORM_PUBLIC_URL` na něj musí ukazovat. U recovery projektu otevřít
dev Tools → `Re-run failed GitHub jobs`. GitHub run zachová stejné run ID, ale
vytvoří nový attempt; InitPad během několika sekund ukáže running a následně
success `deploy` s novým job URL. `publish` zůstane samostatně success a
Deployment activity nesmí vytvořit falešný nový deployment. Na localhostu se
akce musí zastavit před GitHub API s konkrétní výzvou k veřejné HTTPS URL.

Reference:
[GitHub REST API — Re-run failed jobs](https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run),
[GitHub — Re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

---

## ADR-059 — Ověřený build artifact patří do durable object storage, ne jen do lokálního Docker daemonu

**Kontext.** GitHub build handoff (ADR-049/053) dnes po ověření stáhne
`initpad-image.tar`, zkontroluje provider metadata, SHA-256 skutečných bajtů a
jediný očekávaný image tag a načte image do **lokálního Docker daemonu**
control-plane hostu (`storageKind=docker-daemon`, `storageRef=imageRef`).
Ověřené bajty tím nikde durably nežijí: po restartu hostu image zmizí a artifact
se zotaví jako `failed` s výzvou spustit CI znovu. To nejde pro multi-instance
SaaS (každá API instance má vlastní daemon) a je křehké i lokálně. GitHub
artifact má krátkou retenci a není dlouhodobé úložiště; uživatelský PAT classic
ani private-GHCR pull jsou zakázané (ADR-049).

**Rozhodnutí.**

1. **Provider-neutral `ArtifactStore`.** Projektová doména ukládá ověřené bajty
   přes rozhraní `ArtifactStore` (put/head/get/delete + presign). Produkční
   kontrakt je privátní S3-compatible object storage; lokální compose použije
   MinIO, cloud může použít S3 beze změny projektové domény. Doporučené balíčky
   `@aws-sdk/client-s3` a `@aws-sdk/s3-request-presigner`.
2. **Edition-aware config, žádný tichý fallback.** Config: endpoint, region,
   bucket, access/secret key, path-style, presign TTL, retention. V edici `saas`
   musí být storage nakonfigurovaná — jinak API selže hlasitě, nikdy nespadne na
   lokální filesystem ani na veřejný bucket. Secrety nikdy do Git historie ani logů.
3. **Tenant-scoped opaque klíč.** Object key je odvozený z immutable interních ID
   (tenant/project/artifact) a digestu, nikdy z uživatelské cesty. `storageRef`
   zůstává opaque key, ne veřejná URL. Cross-tenant izolace klíčů je vynucená a
   testovaná.
4. **Oddělená validace identity archivu.** Kontrola identity/integrity Docker
   archivu se vyčlení z `DockerProvider`, aby běžela i v control plane bez Docker
   socketu. Do object store se jako `available` smí označit jen artifact, který
   prošel provider metadata + SHA-256 skutečných bajtů + kontrolou jediného
   očekávaného image tagu.
5. **Atomický ingest.** Upload se streamuje ze soukromého temp souboru. Stav je
   atomický `accepted → ingesting → available`; `storageKind=object-store` a
   `storageRef` se nastaví až po úspěšném put + head ověření. Chyba odstraní
   částečný objekt a skončí `failed` s bezpečnou zprávou. Žádné celé image v RAM.
6. **Lokální Docker acceptance + rehydratace.** Po uložení do object store se ze
   stejného ověřeného souboru image dál načte do lokálního daemonu pro okamžitý
   deploy. Když daemon po restartu image nemá, Run again/redeploy ji
   **rehydratuje z object store**, znovu ověří digest/manifest a teprve pak
   nasadí. `storageRef` (opaque key) se nikdy nezaměňuje s Docker image ref;
   image ref se odvozuje samostatně.
7. **Retention/GC a idempotentní delete.** Mazání/retention/GC nesmí odstranit
   artifact stále referencovaný Environmentem nebo aktivní DeploymentOperation.
   Project delete má idempotentní externí cleanup; selhání storage se nesmí
   vydávat za úspěšné smazání.
8. **Job-scoped presigned GET pro budoucího Agenta.** Krátkodobý job-scoped
   presigned GET kontrakt. Žádný obecný browser download endpoint; presigned URL
   se neukládají do DB.

**Alternativy.** (a) Ponechat jen lokální Docker daemon — nefunguje pro
multi-instance a je křehké po restartu. (b) Push image do privátního GHCR a pull
— ADR-049 zakazuje private-GHCR pull i uživatelský PAT a váže dodání na GitHub
dostupnost. (c) Sdílený síťový filesystem — horší tenant izolace, provozní model
i chybějící presigned GET pro Agenta. Object storage je nejblíž produkčnímu SaaS
a je zároveň lokálně spustitelné (MinIO).

**Bezpečnost.** Bucket je privátní; přístup jen přes krátkodobé presigned URL
nebo serverové API s konfigurovaným klíčem. Klíč odvozený z interních ID
znemožňuje uhodnout či přejít cizí tenant. Ověření identity archivu (metadata +
SHA-256 + jediný tag) běží před označením `available`, i bez Docker socketu.
Rehydratace znovu ověří digest/manifest, takže poškozený/zaměněný objekt nikdy
nenasadíme.

**Důsledky.** Ověřený artifact přežije restart i více API instancí; lokální
deploy zůstává rychlý (image je i v daemonu), ale zdrojem pravdy je durable
object. Vzniká čistý kontrakt pro budoucího Agenta (presigned GET). GHCR/PAT se
nepřidává. Multi-instance object storage je předpoklad reálného SaaS profilu
i Agenta (Fáze 5).

**Uživatelské testování.** Nový GitHub build se uloží jako `object-store`, dev
běží; lokální Docker image se odstraní bez smazání objektu a `Redeploy verified
build` ji obnoví. Dev → test zachová stejné BuildArtifact ID/digest. Po restartu
API je artifact stále dostupný a nasaditelný. Neověřovat jen existencí DB řádku
— prokázat stažení a reálný deploy. Automatické testy: fake store, upload
failure + partial cleanup, checksum/manifest mismatch, rehydratace po chybějícím
lokálním image, idempotent duplicate callback, GC reference protection, krátké
presign TTL a cross-tenant izolace.

Reference:
[AWS SDK for JavaScript v3 — S3 client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/),
[AWS SDK — S3 request presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/),
[MinIO — S3-compatible object storage](https://min.io/docs/minio/container/index.html).

## ADR-060 — Environment běží přes workspace-scoped TargetAllocation, ne přímo přes fyzický Target

**Kontext.** Dnes se `Environment` váže přímo na `Target` (`targetId`).
`Target` míchá dvě různé věci: fyzickou infrastrukturu s **credentials**
(host/port/user/secret/remotePath) a její **použití** konkrétním workspace
(namespace, public URL, kvóty, stav). Built-in targety jsou sdílené
(`workspaceId=null`), uživatelské patří workspace. Pro reálný multi-tenant model
(a pro budoucího Agenta, který musí být allocation-scoped) potřebujeme oddělit
„co to je" od „kdo a jak to smí používat", aniž bychom rozbili existující
projekty, jejich URL a ESO SFTP cesty. Credentials nikdy nesmí být viditelné
napříč workspace.

**Rozhodnutí.**

1. **Aditivní `TargetAllocation`.** Nová entita váže fyzický `Target` na
   `Workspace` a nese *použití*: `namespace`/`rootPath` (prefix jmen kontejnerů
   nebo SFTP releases root), `publicUrl`, `capabilities` (podmnožina schopností
   Targetu, kterou workspace smí využít), `status` (`active`/`disabled`) a
   základní kvóty (`maxEnvironments`, volitelně CPU/memory strop). **Credentials
   zůstávají výhradně na fyzickém `Target`** — allocation je nikdy nekopíruje ani
   nevystavuje.
2. **Environment používá allocation.** Přidá se `Environment.allocationId`
   (nullable během migrace). Deploy/teardown řeší cíl přes allocation → target;
   `provider`/`targetId` zůstávají denormalizované jen pro čtecí cesty a zpětnou
   kompatibilitu, dokud nebude backfill kompletní. Provider dostává
   neprivilegovaný allocation overlay: Docker používá namespace v síti i jménu
   kontejneru, SSH/SFTP používají allocation root a public URL, ale credentials
   vždy bere z fyzického targetu.
3. **Migrace bez ztráty.** Aditivní migrace založí pro každý existující
   `(workspace, target)` pár, který nějaký Environment používá, jednu allocation
   s dosavadní `publicUrl` a odvozeným namespace/rootPath tak, aby **stávající
   URL a ESO SFTP cesty zůstaly beze změny**. Backfill je idempotentní a
   spustitelný za běhu (startup reconcile), legacy řádky bez allocationId se
   dorovnají. Docker stop/start/teardown během přechodu rozpozná i původní
   nenamespacované jméno a první redeploy starý kontejner odstraní.
4. **Autorizace podle role.** Owner/admin workspace allocation vytváří, upravuje
   a mažou; member ji smí *použít* (vytvořit v ní environment/deploy); viewer ji
   jen čte. Přístup k allocation cizího workspace vrací 404 (nikdy 403 s
   detailem), aby se neprozradila existence cizích zdrojů; uvnitř workspace je
   nedostatečná role 403.
5. **Sdílené built-in targety.** Built-in simulovaná infrastruktura
   (docker/ssh/sftp) je nadále sdílená, ale každý workspace k ní má **vlastní
   allocation** s vlastním namespace → dva workspace nikdy nesdílí jména
   kontejnerů, Docker sítě ani SFTP release cesty. Namespace je neměnný, globálně
   unikátní workspace slug; u nové built-in allocation se přidá také do rootPath
   a public URL. Workspace-owned target se znovu neprefixuje.
6. **Kvóty se vynucují při create/deploy.** Vytvoření environmentu nad rámec
   `maxEnvironments` allocation je odmítnuto s jasnou chybou; `disabled`
   allocation nedovolí nový deploy, ale nezničí běžící (ty spravuje teardown).
   Create i import vyřeší všechny tři allocations a jejich policy ještě před
   vytvořením externího repozitáře/project recordu; změna targetu a každý deploy
   kontrolu opakují.
7. **Žádný Agent před zeleným tenant isolation.** Fáze 5 (Agent) se nezačne,
   dokud neprojde uživatelský test dvou workspaceů: cizí allocation je
   neviditelná, namespace se neprolíná a role owner/member/viewer se chovají
   podle bodu 4.

**Alternativy.** (a) Rozšířit `Target` o workspace-usage pole — míchá
credentials s použitím, znemožňuje sdílený built-in target s per-workspace
namespace a komplikuje tenant izolaci. (b) Odvozovat namespace ad hoc při deploy
bez perzistentní entity — není kam uložit kvóty, stav ani auditovatelné
přiřazení a rozbíjí to stabilitu URL/cest. Perzistentní allocation je nejblíž
reálnému multi-tenant modelu a je aditivní.

**Bezpečnost.** Credentials zůstávají jen na fyzickém targetu a nikdy neopouští
server; allocation nese jen neprivilegovaná usage data. Neměnný globálně
unikátní workspace slug a providerová sanitizace vylučují kolizi mezi tenanty.
Cizí allocation je 404. Kvóty limitují spotřebu jednoho workspace.

**Důsledky.** Vzniká čistý tenant-scoped cíl nasazení, na který se v Fázi 5
naváže Agent (job je allocation-scoped). Existující projekty, URL a ESO cesty
zůstávají beze změny. Fyzický target a jeho credentials se dají spravovat
nezávisle na tom, které workspace ho využívají.

**Uživatelské testování.** Dva workspace nasadí na stejný built-in target →
každý má vlastní namespace, běží současně bez kolize, navzájem na sebe nevidí.
Owner vytvoří/zakáže allocation; member v ní nasadí; viewer jen čte; cizí
workspace dostane 404. Migrace zachová URL a ESO cesty tří legacy projektů.
Automatické testy: backfill idempotence, kvóta při create/deploy, role matrix,
cross-workspace 404, namespace izolace.

Reference:
[Kubernetes — Namespaces (koncept izolace)](https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/),
[The Twelve-Factor App — III. Config](https://12factor.net/config).

## ADR-061 — Per-environment konfigurace a secrety nasazovaných aplikací

**Kontext.** Nasazená aplikace obvykle potřebuje běhovou konfiguraci a secrety
(`DATABASE_URL`, API klíče, feature flags). Dnes InitPad nemá kam je zadat —
appka běží jen s tím, co je zapečené v image/šabloně. To láme příslib „vývojář
řeší jen kód": jakmile appka potřebuje secret, nejde ji reálně provozovat. Sklad
buildů (ADR-059) drží model „build once, deploy many", takže konfigurace musí být
**vstup při deploy**, ne součást image (jinak by stejný ověřený artifact nešlo
pustit v dev i prod s jinou konfigurací a secrety by skončily v image).

**Rozhodnutí.**

1. **Per-(projekt, prostředí) config vary.** Dvojice `KLÍČ=HODNOTA` navázané na
   konkrétní `Environment` (dev/test/prod nezávisle). Klíč odpovídá konvenci
   `^[A-Z_][A-Z0-9_]*$` a má omezenou délku.
2. **Secret flag.** `isSecret=true` → hodnota je **šifrovaná at-rest** stejným
   mechanismem jako credentials targetů (`INITPAD_ENCRYPTION_KEY`,
   `encryptSecret`). API **nikdy nevrací plaintext secretu** (maskuje, vrací jen
   `hasValue`); ne-secret hodnoty vrací pro editaci. Secrety se nikdy nelogují.
3. **Injektáž při deploy, build-once zachován.** Platforma vary vloží do běžící
   aplikace až při deploy (Docker container `Env`; SSH do běhového prostředí
   start příkazu; SFTP statické cíle je nemají). Stejný ověřený image tak běží ve
   všech prostředích s jinou konfigurací; secrety nejsou v image ani v registru.
4. **Změna se projeví až redeployem.** Vary se aplikují při deploy; úprava
   nezmění běžící kontejner, dokud se prostředí znovu nenasadí. UI to signalizuje.
5. **Autorizace.** Správu (zápis/mazání) smí člen s project-write rolí; viewer
   jen čte (se zamaskovanými secrety). Přístup mimo workspace se řídí existujícím
   projektovým pravidlem.
6. **Rezervované klíče.** Platformou řízené proměnné (např. `PORT`, pokud se
   používá) nejdou přepsat, aby uživatel nerozbil běhový kontrakt.

**Alternativy.** (a) Zapéct konfiguraci do image — rozbíjí build-once a dostává
secrety do image/registru. (b) Nechat jen na šabloně — neflexibilní, žádné
secrety. (c) Externí secret manager (Vault apod.) — těžší, lze integrovat později
za stejným rozhraním; pro školní/self-hosted MVP je vestavěné šifrované úložiště
dostatečné a bez závislostí.

**Bezpečnost.** Secrety šifrované at-rest, v API maskované, nikdy nelogované;
dešifrují se jen v paměti při deploy a injektují pouze do cílového prostředí.
Ne-secret a secret vary jsou oddělené, takže se secret omylem nevypíše.

**Důsledky.** Reálné aplikace (s DB, API klíči) jsou nasaditelné → dokončuje se
příběh „vývojář jen píše kód". Stejný ověřený artifact běží v dev/test/prod s
odlišnou konfigurací. Vzniká základ pro budoucí sdílené vary na úrovni
workspace/allocation a pro auto-provisioning backing služeb, které connection
string vloží jako var automaticky (mimo rozsah tohoto řezu).

**Uživatelské testování.** Nastav `GREETING`/`DATABASE_URL` pro dev, nasaď, appka
je vidí; secret je v UI zamaskovaný; změna hodnoty + redeploy se projeví; test má
nezávislou sadu od dev. Automatické testy: CRUD + role, šifrování a maskování
secretů, validace klíče, sestavení injektážní mapy s dešifrovanými secrety a
přítomnost varů v Docker `Env`.

Reference:
[The Twelve-Factor App — III. Config](https://12factor.net/config),
[OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).

## ADR-062 — Provozní zajištění self-hosted nasazení (zálohy, obnova, interní HTTPS, úklid)

**Kontext.** Self-hosted edice běží jako jeden Docker Compose stack na jednom
hostu. Pro reálné použití ve škole nebo malé firmě chybí provozní zajištění:
automatické zálohy a ověřená obnova, HTTPS i na vnitřní síti bez veřejného
Let's Encrypt, hygiena disku a provozní runbook. Bez toho hrozí ztráta dat
(repozitáře, DB), plný disk a neudržovatelný provoz. HA/škálování je mimo rozsah
jednoho hostu (řeší roadmapa: Agent, managed DB/S3).

**Rozhodnutí.**

1. **Automatické zálohy jako společný checkpoint.** Platformní zapisovatelé
   (API, Gitea, MinIO, runner, SFTP/static target a Caddy) se po dobu snapshotu
   krátce zastaví. Platformní DB se potom zálohuje logicky přes `pg_dump`,
   datové volumes `gitea-data` (repozitáře + SQLite), `minio-data` (artefakty)
   a `api-data` (workspace + OIDC klíč) jako tar snapshoty. Tím DB, repozitáře
   a artifact metadata pocházejí ze stejného klidového bodu; po dokončení i po
   chybě se znovu spustí pouze služby, které běžely před zálohou. Zálohy jsou
   časově razítkované, rotované (ponech N) a řízené **host cronem** volajícím
   `deploy/backup.sh` — transparentní, bez dalšího privilegovaného sidecaru.
   Cílový adresář je konfigurovatelný; doporučena je offsite kopie a šifrování
   (záloha obsahuje `.env` se secrety). Checkpoint se nejprve sestaví do
   unikátního dočasného adresáře a pod finálním názvem se atomicky zveřejní
   až po vytvoření manifestu kontrolních součtů. Existující cíl se nikdy
   nepřepisuje, aby se nesmíchaly soubory dvou snapshotů. Aktivní vnořený CI
   kontejner backup odmítne; rozpracovaný workflow se nesmí přerušit uprostřed
   buildu, jeho transientní DinD cache není součástí durable dat.
2. **Ověřená obnova.** `deploy/restore.sh` je explicitní, destruktivní a
   potvrzovaný: zastaví celý stack včetně volitelných profilů, obnoví
   zálohovaný `.env` (a vedle ponechá chráněnou kopii předchozího), dorovná
   heslo databázové role, obnoví DB (drop+create+load) a neaktivní volumes a
   teprve potom nastartuje základní stack, runner a případně HTTPS profil.
   Bez původního šifrovacího klíče a dalších secretů by obnovená data nebyla
   použitelná, proto je konfigurace součástí atomu obnovy.
   Před destruktivním potvrzením se vyžaduje kompletní sada archivů,
   kontroluje jejich manifest i čitelnost PostgreSQL dumpu. Dokončení se
   ohlásí teprve po health checku Gitey, API, DinD a běhu runneru.
   Běžící workloady nejsou součástí control-plane snapshotu a po jeho pořízení
   se mohly změnit. Restore proto odstraní pouze lokální kontejnery s explicitním
   `com.initpad.managed=true` a všechna obnovená aktivní prostředí označí jako
   vyžadující ověření/redeploy; verze a artifact binding zachová. U vzdáleného
   targetu nic destruktivně nemaže, pouze přestane tvrdit neověřený stav.
   „Zdokumentovaná obnova = otestovaná obnova."
3. **Interní-CA HTTPS (volitelně).** Caddy umí `tls internal` (vlastní lokální
   CA) přes proměnnou `INITPAD_TLS_DIRECTIVE`, pro LAN/školu bez veřejné
   dostupnosti pro Let's Encrypt. Klienti musí důvěřovat Caddy root CA (nebo
   přijmout výzvu). Veřejné nasazení dál používá automatický Let's Encrypt.
4. **Hygiena disku.** `deploy/cleanup.sh` bezpečně uklidí **dangling images a
   build cache**; nikdy nesahá na pojmenované datové volumes ani běžící
   deploye. Retention ověřených buildů v object store řeší ADR-059.
5. **Provozní runbook** `deploy/OPERATIONS.md` — start/stop, health, zálohy/
   obnova, úklid, aktualizace, ochrana secretů, kapacita a troubleshooting.

**Alternativy.** (a) Raw tar Postgres volume — nekonzistentní při běhu; proto
DB přes `pg_dump` a ostatní volumes přes tar až po zastavení zapisovatelů.
(b) Backup sidecar kontejner — víc pohyblivých částí a oprávnění než host cron.
(c) Managed DB/S3/HA — mimo rozsah jednoho hostu, patří do scale fáze.

**Bezpečnost.** Zálohy obsahují data i secrety → ukládat s omezenými právy a
offsite šifrovat; `.env` chránit. Interní CA root se musí distribuovat obezřetně.
Úklid je záměrně konzervativní, aby nikdy nesmazal potřebná data ani image.

**Důsledky.** Jednohostový self-hosted se stává provozovatelným pro školu i malou
firmu: data přežijí a jsou obnovitelná, HTTPS funguje i na LAN a disk zůstává
zdravý. Záloha má krátké servisní okno úměrné velikosti volumes; je to vědomý
kompromis za konzistenci bez filesystem snapshotů a distribuované koordinace.
Skutečná HA a víc‑hostové škálování zůstávají na roadmapě.

**Uživatelské testování.** `backup.sh` vytvoří kompletní zálohu; simulovaná
ztráta a `restore.sh` obnoví projekty i repozitáře; interní HTTPS podává platný
(lokálně důvěryhodný) certifikát; `cleanup.sh` uvolní místo bez rozbití běžících
prostředí.

Reference:
[PostgreSQL — pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[Caddy — automatic HTTPS / internal issuer](https://caddyserver.com/docs/automatic-https),
[Docker — system prune](https://docs.docker.com/engine/manage-resources/pruning/).

## ADR-063 — Aktuální built-in URL a životní cyklus lokálních Docker zdrojů

**Kontext.** URL built-in Docker deploymentu se dosud ukládala včetně LAN IP
hostitele. Po restartu VM nebo změně síťového adaptéru zůstal na kartě starý
host, i když dynamicky přidělený port byl správný. Opakovaný deploy navíc
stahuje image každého CI buildu a změna allocation mohla ponechat kontejner pod
starým jménem. Dlouhodobě se tak plnil disk self-hosted stroje.

**Rozhodnutí.**

1. U built-in targetu je hostname prezentační údaj platformy. API při čtení
   nahradí host uložené deployment URL hostnamem aktuálního
   `INITPAD_PUBLIC_URL`, ale zachová protokol, přidělený port, cestu, query i
   fragment. Tím pro běžnou LAN instalaci existuje jediný zdroj pravdy.
   Neobvyklá topologie, kde built-in aplikace záměrně používají jiný host,
   nastaví explicitní `INITPAD_DEPLOY_PUBLIC_HOST`. Původní
   `INITPAD_PUBLIC_HOST` je pouze kompatibilní fallback bez nakonfigurované
   public URL. URL workspace-owned SFTP/SSH/Docker targetu se nikdy nepřepisuje.
2. Každý nový kontejner nese stabilní label projektu a prostředí. Před
   redeployem se odstraní původní i legacy kontejner a všechny označené
   instance stejného projektu/prostředí, takže po úspěchu zůstane jedna.
3. Když nový kontejner neprojde health checkem, platforma jej ihned odstraní.
   Neúspěšný deploy proto nezanechá skrytý workload.
4. Po zdravém redeployi se z lokálního Docker daemonu odstraní starší
   nepoužívané tagy stejného repozitáře. Při teardownu se odstraní přesný
   image artifactu i po SFTP/SSH deploymentu. Mazání není `force`: image,
   který používá běžící nebo zastavené dev/test/prod prostředí, zůstane.
5. Vzdálený registry/object store je trvalý zdroj ověřených buildů pro
   promotion, rollback a audit. Automatický redeploy čistí jen lokální runtime
   cache; úplné smazání projektu má samostatný package cleanup.

**Důsledky.** Změna IP VM vyžaduje pouze aktualizaci `INITPAD_PUBLIC_URL` v
`.env` a restart stacku,
nikoli redeploy aplikací. Běžný deploy/remove udržuje jeden kontejner na
projekt/prostředí a omezenou lokální image cache, aniž rozbije sdílení
stejného artifactu mezi prostředími nebo dohledatelnost buildů.

**Uživatelské testování.** Změň `INITPAD_PUBLIC_URL`, spusť `install.sh` a
ověř nový host na staré built-in kartě se zachovaným portem. Dvakrát redeployuj
stejné prostředí: `docker ps -a` ukáže jediný označený kontejner a nepoužívaný
starší lokální tag zmizí. Po Remove deployment nezůstane jeho kontejner ani
nepoužívaný přesný lokální image; stejný artifact použitý v test/prod a
vzdálený registry zůstanou.

## ADR-064 — Fronta CI je explicitní a kapacita runneru je omezená

**Kontext.** Bundled `act_runner` měl kapacitu jednoho jobu. Při založení dvou
projektů rychle po sobě proto druhé workflow správně čekalo, ale Gitea 1.22
publikuje pro čekající i vykonávaný job stejný commit stav `pending`. InitPad
jej mapoval na `running`, takže oba projekty vypadaly rozběhnutě a systém působil
zaseknutě. Pouhé zvýšení kapacity by tuto nepravdu neodstranilo a na malé VM by
mohlo neřízeně spustit několik paměťově náročných Docker buildů.

**Rozhodnutí.**

1. Nový projekt ukládá dev prostředí jako `deploying` s explicitním důvodem
   `Waiting for an available CI runner`. Dokud se tento důvod nezmění, UI
   interpretuje SCM `pending` jako frontu (`awaiting CI`), nikoli jako běh.
2. První krok každé dodávané workflow po skutečném přidělení runneru volá
   autentizované `POST /api/ci/start`. Per-project secret vybere projekt i tam,
   kde dva SCM provideři použijí stejné `owner/name`; update se týká pouze
   prvního dev deploymentu bez verze a aktivní publikační operace. Opožděný
   callback proto nepřepíše novější stav. Progress callback je best-effort a
   jeho nedostupnost sama nerozbije build; koncový callback zůstá autoritativní.
   Protože první push může o okamžik předběhnout commit projektového záznamu,
   neznámý projekt vrací ne-2xx a workflow progress callback omezeně opakuje.
3. `INITPAD_RUNNER_CAPACITY` povoluje 1–8 slotů. Výchozí hodnota 1 chrání malý
   self-hosted stroj. Instalátor a restore z kontrolovaného baseline vygenerují
   necommitovaný runtime YAML, proto se konfigurace neduplikuje a ruční
   nevalidní hodnota runner nespustí.
4. Projektové záznamy, SCM secrets, allocation a Docker namespace zůstávají
   oddělené; vyšší runner capacity mění pouze propustnost, nikoli tenant model.

**Důsledky.** Fronta je viditelná a konečná: s jedním slotem druhý projekt
čeká, po uvolnění runner jobu se automaticky rozběhne (jednotlivé joby více
workflow se mohou prokládat). Výkonnější instalace může zvolit dva
nebo více slotů bez změny image. Workflow vytvořená před ADR-064 nemají start
callback a jejich první běh proto může mít starší neurčité zobrazení; nové
projekty a nově vygenerované workflow jsou jednoznačné.

**Uživatelské testování.** Při kapacitě 1 založ bez čekání dva projekty:
první ukáže `running`, druhý `awaiting CI`; po uvolnění slotu druhý
automaticky přejde na `running` a oba nasadí vlastní SHA i kontejner. Potom lze
na dostatečně silném hostu nastavit kapacitu 2 a ověřit dva souběžné buildy.

Reference: [Gitea Actions runner configuration](https://docs.gitea.com/usage/actions/act-runner),
[Gitea Actions design](https://docs.gitea.com/usage/actions/design).

## ADR-065 — CI a externí SCM nesmí blokovat control plane

**Kontext.** Založení více projektů rychle po sobě správně vytvořilo frontu,
ale jeden Docker build mohl bez cgroup limitu využít téměř celý host. UI navíc
při každém načtení seznamu/detailu čekalo na externí SCM kontroly a pravidelný
poll historie opakovaně načítal statusy mnoha commitů. Pomalá Gitea/GitHub nebo
náročný Composer/npm build proto zpomalily i navigaci a API.

**Rozhodnutí.**

1. Rootless DinD kontejner dostává konfigurovatelný souhrnný cgroup limit pro
   všechny vnořené buildy: ve výchozím stavu 1536 MB RAM, 1 CPU a 512 procesů.
   `INITPAD_RUNNER_CAPACITY` dál určuje počet jobů; resource envelope určuje
   jejich společný maximální dopad. Orchestrátor `act_runner` má malý vlastní
   limit a host socket ani filesystem stále nejsou workflow dostupné.
2. Seznam a detail projektů nikdy synchronně nečekají na SCM údržbu. Webhook je
   okamžitá cesta; throttlovaná kontrola na pozadí pouze opravuje zmeškané
   eventy a používá nejvýše čtyři souběžné externí dotazy.
3. Aktivní projektová obrazovka polluje jen nejnovější commit a sloučí jej do
   existující historie. Po dokončení zpomalí interval a na skryté kartě se
   polling zastaví. Celá historie se načte pouze při explicitním otevření.

**Důsledky.** Build může na malé VM trvat o něco déle, ale přihlášení,
navigace a stavové API zůstanou použitelné. Větší instalace mohou limity i
kapacitu zvýšit bez změny image. Zmeškané smazání repozitáře se může v UI
projevit až po krátkém background cyklu; konzistence je eventual, nikoli ztracená.

**Uživatelské testování.** Na VM s výchozí kapacitou 1 založ dva projekty
bez čekání. Jeden staví, druhý ukazuje `awaiting CI`, oba se postupně dokončí
a během buildu lze bez dlouhého čekání otevřít seznam, detail i Settings.
`docker inspect initpad-runner-docker-1` potvrdí memory/CPU/PID envelope; skrytá
karta nevytváří periodické commit requesty.

## ADR-066 — Agent trust bootstrap patří fyzickému Targetu

**Kontext.** Agent zavádí dlouhodobou strojovou identitu s oprávněním ovládat
Docker server. Nesmí vzniknout druhá autorizační doména vedle workspace-scoped
`TargetAllocation`, nesmí se ukládat znovu použitelný instalační secret a dva
souběžné procesy nesmí redeemnout stejný token.

**Rozhodnutí.**

1. Jeden `Agent` je svázán 1:1 s jedním fyzickým `Target`. Workspace a jeho
   namespace se do identity Agenta nekopírují; pro každý job je autoritativní
   existující vazba target → allocation → workspace.
2. Enrollment smí vydat jen owner/admin workspace-owned Docker targetu. Cizí
   target vrací 404 a member 403. Built-in target se touto cestou nepřebírá.
3. Enrollment token má 256 bitů entropie, platí patnáct minut a plaintext se
   vrátí pouze jednou. Databáze ukládá SHA-256 hash. Redeem proběhne
   atomickým compare-and-set nad hashem, expirací a disabled stavem.
4. Redeem vydá oddělený dlouhodobý credential; i z něj se ukládá pouze hash
   a monotónní generace. Nový enrollment nezruší dosavadní credential dřív,
   než jej Agent úspěšně vymění. Deaktivace credential i pending enrollment
   zneplatní, ale fyzický target ani jeho běžící workload automaticky nemaže.
5. Protokol má od prvního requestu explicitní integer `protocolVersion`.
   Enrollment eviduje také verzi programu; capabilities a `lastSeenAt` doplní
   autentizovaný heartbeat, nikoli uživatelský browser.

**Důsledky.** Ukradený databázový dump neobsahuje credential použitelný k
ovládání serveru. Zkopírovaný enrollment příkaz lze použít jen jednou a
krátce; souběh má jednoho vítěze. Target lze bezpečně revoke/re-enroll bez
změny allocation a bez automatického zásahu do aplikací. Samotný credential
je bearer secret a Agent jej proto musí později uložit do root-only souboru;
transport mimo lokální vývoj vyžaduje HTTPS.

**Testování.** Automatizované testy ověřují role a tenant hiding, absenci
plaintextů v DB writech, expiraci, single-use compare-and-set, generaci
credentialu a deaktivaci. Uživatelský test začne až instalačním UI a skutečným
Agent procesem; samotný trust bootstrap není užitečné testovat ručním `curl`.

## ADR-067 — Agent target je outbound-only a před delivery zůstává nepoužitelný

**Kontext.** Trust bootstrap sám o sobě nestačí k bezpečnému nasazování. Pokud
by se workspace-owned Docker target choval jako dnešní built-in Docker ještě
před dokončením job protokolu, mohl by control plane omylem spustit workload na
svém vlastním Docker daemonu. Instalační UX zároveň nesmí vracet zpět SSH
hesla ani vložit jednorázový enrollment do shell historie.

**Rozhodnutí.**

1. Workspace-owned Docker target je explicitně Agent-backed. Ukládá jméno,
   runtime capabilities a browser-reachable aplikační base URL, ale žádný host,
   port, účet, heslo, privátní klíč ani remote path. Typ existujícího targetu je
   neměnný; změna protokolu znamená založit nový target.
2. Enrollment spravuje pouze owner/admin. UI ukáže plaintext token právě v
   odpovědi na jeho vydání a zahodí jej po zavření dialogu, po úspěšném redeem
   nebo po expiraci. Kopírovaný příkaz obsahuje jen URL control plane; Agent si
   token vyžádá interaktivně, aby neskončil v shell historii.
3. Stav `online` není ručně zapisovaný příznak. Control plane jej odvodí z
   autentizovaného heartbeatu mladšího než 90 sekund; starší enrolled Agent je
   `offline`. Stav bez credentialu je `not-enrolled`, revoke je `disabled`.
4. Dokud není hotový durable job a Agent delivery protokol, tento target není
   nabízen pro allocation a backend jej odmítne i při přímém API požadavku.
   Stejná pojistka je také na projektovém deploymentu, takže neexistuje fallback
   na Docker socket control plane.

**Důsledky.** Uživatel mohl bezpečně připravit fyzický server a enrollment už
před dodáním spustitelného Agenta. Dočasný zámek target pickeru byl odstraněn
až po splnění podmínek v ADR-072. SaaS nepotřebuje inbound přístup do
zákaznické sítě a InitPad neuchovává další serverové tajemství. Base URL je
konfigurační údaj pro odkazy na aplikace, nikoli management endpoint Agenta.

**Testování.** API testy odmítají inbound údaje i předčasnou allocation a
ověřují heartbeat-derived stav. Browser acceptance pokrývá založení targetu,
oddělený jednorázový token a bezpečný příkaz, zahození plaintextu po zavření,
redeem nebo expiraci, skrytí targetu v allocation formuláři a mobilní šířku
390 px. Připojení skutečného procesu a stav `online` patří do podkroku 3.

## ADR-068 — Agent heartbeat je minimální, odchozí a provozně obnovitelný

**Kontext.** Enrollment musí pokračovat skutečným procesem na cílovém Docker
serveru. Tento proces drží dlouhodobý bearer credential a přístup k Docker API,
proto nesmí přidat obecný vzdálený shell, poslouchající management port ani
neomezenou telemetrii hostitele. Krátký výpadek control plane nebo startující
Docker daemon zároveň nesmí vyžadovat nový enrollment.

**Rozhodnutí.**

1. Agent je samostatný verzovaný workspace s minimálním kontejnerovým image a
   bez runtime npm závislostí. Vývojový acceptance používá oddělený DinD daemon,
   nikdy hostitelský Docker socket InitPadu. Podepsaný release image a produkční
   installer vzniknou v závěrečném Agent release gate; UI nyní ukazuje
   post-install enrollment příkaz.
2. Enrollment token se zadává skrytým interaktivním vstupem, nikoli argumentem
   procesu. Credential se atomicky ukládá do pravidelného souboru `0600` v
   adresáři `0700`; symlink a příliš široká práva jsou odmítnuta. Mimo loopback
   vyžaduje control-plane URL HTTPS, HTTP lze povolit jen explicitním lokálním
   testovacím přepínačem.
3. Heartbeat každých 30 sekund posílá jen verzi Agentu a protokolu a omezený
   výřez Docker capabilities: engine/API verzi, OS, architekturu, rootless stav,
   CPU a dostupnou paměť. Neodesílá hostname, seznamy image/kontejnerů ani data
   aplikací. Control plane payload validuje, credential vyhledává pouze přes
   jeho hash a revoke race uzavírá compare-and-set zápisem.
4. Agent ověřuje target ID i generaci credentialu vrácené serverem. Přechodné
   chyby Dockeru, sítě a `5xx` opakuje s exponenciálním intervalem 2–60 sekund;
   odmítnutý nebo deaktivovaný credential (`4xx`) je konečný stav a proces
   skončí. Serverem doporučený heartbeat interval je omezen na 10–300 sekund.
5. Verze 0.2.0 Docker API pouze četla `_ping`, `/version` a `/info`. Verze
   0.3.0 doplnila omezené write operace podle ADR-070; projektový deployment
   zůstává zablokovaný do napojení artifact delivery. Durable job endpoint
   popisuje ADR-069.

**Důsledky.** Restart hostitele nebo krátce nedostupný Docker daemon se zahojí
bez re-enrollmentu, ale odcizený credential stále představuje oprávnění k
jednomu fyzickému targetu a musí být možné jej okamžitě deaktivovat. Stav v UI
je eventual-consistent: heartbeat běží po 30 sekundách a po 90 sekundách bez
kontaktu se zobrazí `offline`. Agent zatím nelze zaměnit za hotovou delivery
cestu ani za produkčně publikovaný instalační artefakt.

**Testování.** Izolovaný lokální lab ověřil skutečný single-use enrollment,
práva `0700/0600`, Docker capability discovery, heartbeat a přechod
`online → offline → online` bez nového credentialu. Po restartu hostitele Agent
prošel retry sekvencí při startujícím DinD a sám obnovil heartbeat. API testy
navíc pokrývají neznámý, chybný a souběžně deaktivovaný credential; celý
produkční build, testy a dependency audit jsou zelené. Živý revoke navíc
okamžitě odmítl credential generace 1 odpovědí `401`, aniž by odstranil běžící
workload; nový single-use enrollment vytvořil generaci 2, obnovil heartbeat a
tentýž workload zůstal dostupný. UI po redeem odstraní spotřebovaný plaintext.

## ADR-069 — Agent job je durable target-scoped envelope s fencing lease

**Kontext.** Heartbeat dokazuje, že fyzický Docker target žije, ale nestačí pro
bezpečné předání práce přes výpadek sítě nebo restart Agenta. Opakovaný claim,
ztracená HTTP odpověď či dva souběžné procesy nesmí dovolit starému workeru
publikovat výsledek po převzetí jobu jiným pokusem. Technický transport zároveň
nemá suplovat uživatelskou historii deploymentu ani otevřít obecný vzdálený
shell.

**Rozhodnutí.**

1. `AgentJob` je samostatný target-scoped delivery envelope. Může odkazovat na
   allocation a právě jednu `DeploymentOperation`, ale uživatelská operace
   zůstává autoritativním auditem delivery toku. `dedupeKey` dělá vytvoření
   jobu idempotentní a `protocolVersion` odděluje evoluci wire protokolu.
2. Agent polluje pouze odchozím autentizovaným HTTPS requestem a smí claimnout
   jen kompatibilní job svého targetu. Claim používá compare-and-set nad stavem
   `queued` nebo expirovaným `leased`; vítěz zvýší `attempt` a dostane nový
   třicetisekundový fencing token.
3. Plaintext lease token se vrátí pouze vítěznému claimu. Databáze ukládá jen
   jeho SHA-256 hash. Renew, progress i completion vyžadují současný token,
   stejného Agenta, aktivní dlouhodobý credential a neexpirovaný lease. Starý
   pokus po reassignmentu dostane konflikt a nemůže měnit stav jobu.
4. Progress má monotónní sequence number a omezené stage, procento i zprávu.
   Opakovaný nebo opožděný progress stejného platného lease je bezpečně
   idempotentní. Identické zopakování completion po ztracené odpovědi vrátí již
   uložený výsledek; jiný výsledek nebo starý token je odmítnut.
5. Deaktivace Agenta atomicky zneplatní credential a zruší jeho čekající či
   pronajaté joby. Payload se nikdy nevyhodnocuje jako shell. Verze 0.2.0 umí
   jen validovaný 5–60sekundový `probe`; verze 0.3.0 přidává explicitní
   `lifecycle-test` podle ADR-070. Neznámý kind nebo verzi ukončí jako
   `unsupported_job` bez dotyku Docker daemonu.
6. Skutečné lifecycle handlery musí navíc před každou fyzickou změnou ověřit
   allocation a používat deterministické názvy podle jobu/workload identity.
   Lease brání stale publikaci, ale sám nemůže vrátit zpět externí side effect;
   idempotentní Docker operace jsou proto povinnou součástí podkroku 5.

**Důsledky.** Krátký výpadek control plane nebo ztracená progress/completion
odpověď nevyrobí nový logický job. Ztracená odpověď na claim může práci nejvýše
pozdržet do expirace lease; bezpečnost má přednost před paralelním provedením.
Fronta je nyní persistentní a restartovatelná. Diagnostika od ADR-070 smí
interně založit workspace allocation, ale Agent target ještě nelze vybrat pro
projektové prostředí ani použít ke skutečnému delivery.

**Testování.** API testy pokrývají target/protocol filtr, atomický claim,
reclaim expirovaného lease, renewal, monotónní progress, stale fencing token a
idempotentní completion po ztracené odpovědi. Agent testy simulují ztrátu
progress i completion odpovědi a ověřují, že neznámý shell-like payload není
spuštěn. V živém izolovaném labu se 35sekundový probe pronajal jako `attempt 1`;
po zastavení Agenta lease vypršel, tentýž job se převzal jako `attempt 2` a
dokončil `succeeded`. Databáze obsahovala pouze 64znakový hash lease tokenu.

## ADR-070 — Docker lifecycle Agenta je allocation-scoped allow-list

**Kontext.** Durable lease zaručuje vlastnictví pokusu, ale sám neurčuje, jaké
Docker operace jsou dovolené ani které objekty patří konkrétnímu workspace.
Obecný shell, caller-defined command nebo nekontrolovaný Docker API proxy by z
odcizeného jobu udělaly plný vzdálený přístup k targetu.

**Rozhodnutí.**

1. Agent 0.3.0 implementuje interní explicitní operace `pull`, `deploy`,
   `status`, `health`, omezené `logs`, `stop`, `start`, `remove` a `rollback`.
   Wire protokol v tomto podkroku zpřístupňuje pouze složený
   `lifecycle-test`; samostatné projektové joby zapojí artifact delivery.
2. Payload má přesný allow-list: allocation ID, namespace, project,
   environment, revision, immutable `image@sha256`, container port a relativní
   health path. Jakékoli další pole je chyba. Command, entrypoint, bind mount,
   privileged/host network ani secret nejsou součástí kontraktu.
3. API smí diagnostiku vytvořit pouze workspace owner/adminovi pro enrolled
   Docker target s Agentem alespoň 0.3.0. Založí nebo znovu použije skutečnou
   `TargetAllocation`; namespace tedy nevymýšlí klient ani Agent. Job je
   idempotentní podle request UUID a používá fixní multi-platform Nginx digest.
4. Kontejnery a sítě mají target, allocation, namespace, workload, environment
   a revision labels. Každá mutace ověří jejich vlastnictví; shoda jména s
   cizím objektem skončí chybou bez odstranění objektu. Názvy jsou
   deterministické a dlouhé identity dostanou hash suffix.
5. Workload dostane CPU/RAM/PID a log limity, `no-new-privileges`, `CapDrop=ALL`
   a minimální runtime sadu `CHOWN`, `DAC_OVERRIDE`, `SETGID`, `SETUID` a
   `NET_BIND_SERVICE`. Candidate má restart policy `no`; teprve po zdravém HTTP
   probe dostane `unless-stopped` a smí nahradit současnou revision.
6. Lifecycle i po opakování bezpečně naváže na existující stav. Při ztrátě
   lease se worker abortuje a nesmí uklízet náhradu novějšího pokusu. Běžná
   chyba diagnostiku uklidí; image existující před testem zachová a síť smaže
   jen pokud je vlastní a prázdná. Log tail je omezen na 32 KiB.

**Důsledky.** Control plane už nemusí mít inbound SSH ani přístup k Docker
socketu vzdáleného serveru a může ověřit fyzický lifecycle. Nejde ještě o
projektový deployment: job nemá vazbu na ověřený `BuildArtifact`, masked
environment config ani `DeploymentOperation`. Tyto vazby jsou povinným
podkrokem 6 a teprve poté se odemkne target picker.

**Testování.** Unit testy ověřují odmítnutí shell-like/unknown fields,
vlastnictví objektů, resource hardening, health-gated replacement, rollback,
stop/start, bounded logy, zachování předem existujícího image a cleanup. API
testy ověřují admin autorizaci, reálnou allocation, immutable digest a
odmítnutí starého Agenta. V izolovaném DinD labu job dokončil celý cyklus
jako `succeeded`; následná kontrola nenašla managed kontejner, testem stažený
image ani diagnostickou síť.

## ADR-071 — Agent delivery odděluje trvalý intent od lease-scoped materiálu

**Kontext.** Projektový Agent job musí odkázat na neměnný `BuildArtifact` a
současně předat runtime konfiguraci. Uložení plaintext secrets, registry
hesla nebo presigned bearer URL do durable `AgentJob.payload` by je zaneslo do
databáze, záloh a diagnostiky. Přímá S3/MinIO URL navíc nemusí být z Docker
serveru dosažitelná a v self-hosted instalaci by zbytečně zveřejnila další
management endpoint.

**Rozhodnutí.**

1. Durable payload obsahuje pouze nesenzitivní workload intent a interní
   identity. Teprve vítězný claim `deploy`/`rollback` jobu znovu ověří
   target, allocation, `DeploymentOperation` a dostupný object-store artifact.
2. Environment config se načte a secret hodnoty dešifrují pouze při tomto
   claimu. Vrátí se v transientní `delivery` části HTTPS odpovědi a neukládají
   se zpět do `AgentJob`, progressu ani logu.
3. Archiv se nestahuje přímým bucket credentialem ani presigned URL. Control
   plane poskytne job-scoped stream, který vyžaduje současně dlouhodobý Agent
   credential a plaintext fencing token aktuálního neexpirovaného lease.
   Token je v HTTP hlavičce, nikdy v URL.
4. Před otevřením streamu se kontroluje stav artefaktu, storage binding a
   velikost objektu. Claim nese očekávaný SHA-256 a velikost; Agent v dalším
   podkroku digest ověří při přenosu před publikací workloadu.
5. Cesta je relativní a přesně svázaná s ID jobu. Agent odmítne absolutní
   nebo jinou cestu, takže odpověď control plane nelze zneužít jako SSRF
   instrukci. Response zakazuje cache a bucket zůstá privátní.

**Důsledky.** Artifact storage zůstá interní implementační detail a stejný
transport funguje pro lokální MinIO i cloudové S3. Odcizený lease bez Agent
credentialu ani credential bez lease nestačí. Config existuje v plaintextu jen
v paměti control plane a Agenta po dobu aktivního pokusu. Kontrakt aktivoval
Agent 0.4 a projektové napojení podle ADR-072; target picker jej nabídne až po
splnění všech readiness podmínek.

**Testování.** API testy ověřují materializaci masked configu pouze po
platném claimu, absenci secrets v durable payloadu, shodu objektu a odmítnutí
starého lease. Agent test kontroluje bearer i lease hlavičku, prázdnou query
string a odmítnutí cizí/absolutní artifact URL. Artifact store má streamovací
round-trip regresi.

## ADR-072 — Projektová operace zůstává autoritou nad Agent jobem

**Kontext.** Po zavedení bezpečného artifact streamu bylo nutné napojit
vzdálený Docker server na stejné projektové akce jako built-in Docker. Technický
`AgentJob` ale nesmí vytvořit druhou uživatelskou historii, obejít approval tok
ani dovolit, aby změna targetu nebo configu nechala na serveru osiřelý workload.

**Rozhodnutí.**

1. `DeploymentOperation` zůstává autoritativním uživatelským auditem.
   `AgentJob` je pouze idempotentní transport svázaný s touto operací, fyzickým
   targetem a workspace `TargetAllocation`. Progress Agenta se zrcadlí do
   operace a environmentu; až validní strukturovaný terminální výsledek nastaví
   `running`, `stopped` nebo `empty`.
2. Agent-backed deploy nikdy nepoužije Docker socket control plane. Gitea OCI
   image se před zařazením uloží jako ověřený object-store archiv; GitHub
   použije stejný již ingestovaný artifact. Agent stream průběžně ověří
   velikost a SHA-256, načte archiv a ověří očekávaný image tag.
3. Deploy použije health-gated candidate replacement. Start, stop a remove
   jsou samostatné allow-listed joby se stejnou workload identitou. Remove
   odstraní vlastní base/candidate kontejnery, bezpečně se pokusí uvolnit
   image a smaže pouze vlastní prázdnou síť. Cizí label nebo sdílený image
   zůstane nedotčený.
4. Durable payload neobsahuje secrets. Obsahuje keyed HMAC fingerprint
   encrypted-at-rest config snapshotu; plaintext vznikne až při vítězném
   claimu. Config nejde běžným API měnit při aktivní operaci. Pokud se snapshot
   přesto liší, job bezpečně skončí `delivery_invalid` a uživatel spustí nový
   deployment.
5. Target picker a ruční allocation nabídnou workspace Docker target jen
   pokud má credential, není disabled, hlásí Agent 0.4.0+ a control plane má
   durable S3/MinIO store. Aktuální offline stav target nezakáže: job se smí
   trvale zařadit a po reconnectu dokončit. Inbound `verifiedAt` se na Agent
   nevztahuje.
6. Živý Agent deployment se musí nejprve explicitně odstranit, teprve potom
   lze environment přesunout na jiný target nebo smazat projekt. Přerušený
   rozpracovaný deploy lze zrušit a nahradit remove jobem, který uklidí
   případný candidate. Control plane nikdy nepředstírá lokální teardown
   vzdáleného Dockeru.

**Důsledky.** SaaS může bezpečně provozovat control plane bez Docker socketu
a bez inbound portu do zákaznické sítě. Self-hosted built-in Docker zůstává
kompatibilní. Offline target znamená zpoždění, ne ztrátu požadavku. Uživatel
vidí jednu konzistentní historii projektové operace a technické pokusy Agenta
zůstávají diagnostikou targetu.

**Testování.** API testy pokrývají durable artifact binding, starého/disabled
Agenta, cizí allocation, secrets mimo payload, config fingerprint, restartové
reconcile a strukturované deploy/start/stop/remove výsledky. Agent testy ověřují
stream/digest/tag, health-gated publikaci, explicitní lifecycle dispatch a
absenci secrets v progressu/completion. Produkční API import navíc musí
proběhnout bez decorator forward-reference chyby. Živý React deployment v
odděleném DinD targetu převzal 63,4 MB ověřený archiv, publikoval zdravý workload
a přes lab-only loopback bridge vrátil browser-reachable URL bez vystavení
Docker API. Jeho následný `Stop → Start → Remove` prošel přes tři samostatné
joby; prostředí skončilo `empty` a izolovaný daemon neobsahoval managed
kontejner, image projektu ani Agent síť. Postup offline, revoke a
multi-workspace gate je popsaný v `apps/agent/README.md`. Offline scénář
následně prošel: po grace period UI
ukázalo `offline`, nový deploy stejného historického artifactu nevyvolal SCM
run a zůstal `Waiting for Agent`; po reconnectu byl jediný job claimnutý a
dokončený jako `attempt 1` a daemon obsahoval právě jeden workload.
Revoke/re-enroll odmítl starou generaci `401`, zachoval běžící aplikaci a nový
credential obnovil heartbeat. Multi-workspace scénář použil dvě target identity
s oddělenými credential volumes nad stejným DinD daemonem. Současné workloady
měly namespaces `team-alpha` a `it000`; Stop a Remove `it000` neovlivnil první
kontejner, jeho síť ani HTTP `200` dostupnost.

## ADR-073 — Produkční Agent target používá spravovanou gateway a stabilní hostname

**Kontext.** Agent dnes publikuje workload na náhodném host portu a control
plane z explicitního `publicUrl` targetu sestaví browser URL. To je vhodné pro
lokální lab, vývojovou VM a jednoduchý interní server, ale není to produkční
aplikační ingress: URL se při novém deploymentu může změnit, provoz není
ukončený na standardních portech 80/443 a každý workload rozšiřuje veřejnou
plochu hostitele. Automatická detekce IP by navíc za proxy, NATem, VPN nebo na
serveru s více rozhraními mohla zveřejnit nesprávnou adresu.

**Rozhodnutí.** Agent Docker target dostane explicitní režim routování:

1. `direct-port` zachová dnešní chování pro local/lab a zpětnou kompatibilitu.
   Dynamický port je v labu vázaný jen na výslovně nastavené rozhraní;
   tento režim se nebude vydávat za stabilní veřejný ingress.
2. `managed-gateway` bude produkční režim. Administrátor potvrdí HTTPS
   `publicUrl` targetu, například `https://apps.example.cz`; jeho hostname je
   explicitní základ spravované DNS zóny, nikoli automaticky odhadnutá IP.
   Allocation může mít explicitní podzónu. Platforma z ní při prvním deployi
   **jednou alokuje a uloží** collision-safe hostname projektu/prostředí,
   například `shop-dev-a1b2.apps.example.cz`. Rename projektu ani redeploy URL
   nezmění; unikátní databázové omezení zabrání souběžné alokaci stejného jména.
3. DNS je odpovědností správce targetu: wildcard `A`/`AAAA` (nebo ekvivalent
   load balanceru) směruje zónu na gateway. `publicUrl` zůstává explicitní a
   administrátorem potvrzený zdroj pravdy. InitPad před aktivací provede
   read-only preflight DNS, dostupnosti gateway a TLS; nebude měnit DNS ani
   vybírat síťové rozhraní bez samostatné budoucí integrace.
4. Výchozí veřejné TLS používá automatické certifikáty pro jednotlivé uložené
   hostname. Volitelný wildcard certifikát je samostatný režim, protože vyžaduje
   ACME DNS challenge a úzce omezený credential DNS provideru. Interní síť může
   použít správcem zvolenou interní CA; klienti jí musí důvěřovat. Externí load
   balancer může TLS ukončovat mimo gateway, ale tento stav musí být explicitní.
5. Agent nadále spravuje jen allow-listed workload lifecycle. Jedna co-located
   gateway (první adapter Caddy) ukončuje TLS a routuje podle `Host`; nedostane
   Docker socket. Agent jí předává pouze validovaný deklarativní route snapshot
   přes permissioned Unix socket nebo izolovaný management endpoint. Admin API
   se nikdy nepublikuje do internetu a projektový payload nemůže dodat vlastní
   Caddy/Traefik konfiguraci, upstream ani hostname.
6. Workload nepublikuje náhodný veřejný host port. Zůstane v allocation-scoped
   Docker síti a trusted gateway se připojí pouze k sítím s aktivními routami.
   Workloady různých allocations nesdílejí jednu aplikační síť a samy se
   navzájem neadresují; gateway je vědomý, auditovaný trust boundary bez práva
   vytvářet či mazat kontejnery.
7. Deploy je health-gated i na úrovni routy: Agent připraví candidate, ověří
   jeho interní health, atomicky přepne deklarativní route, ověří veřejné HTTPS
   a teprve potom dokončí `DeploymentOperation`. Selhání gateway zachová
   předchozí funkční route/revision a candidate uklidí. Stop hostname rezervuje,
   start obnoví stejnou route a remove route odstraní; úplné smazání projektu
   ji uvolní až po potvrzeném teardownu.
8. Control plane uloží desired route intent a poslední Agentem potvrzený stav.
   Agent po reconnectu provede idempotentní reconcile, takže restart gateway,
   ztracená odpověď ani duplicitní job nevytvoří dvě routy a nepublikuje cizí
   allocation. Konkrétní gateway je za interním adapterem, aby později mohl být
   přidán Traefik, Kubernetes Ingress nebo cloud load balancer bez změny
   projektového delivery toku.

**Důsledky.** Produkční aplikace dostanou stabilní HTTPS adresy bez veřejného
portu pro každý kontejner a Agent zůstane jedinou komponentou s lokálním Docker
oprávněním. Provozovatel musí zajistit DNS, dosažitelnost 80/443 a zvolený TLS
model. Gateway se stává kritickou sdílenou komponentou, proto vyžaduje durable
konfiguraci, health/readiness, audit změn a bezpečný rollback. `direct-port`
zůstává užitečný pro vývoj a neblokuje instalaci bez domény.

**Pořadí implementace.** Nejdřív se uzavře bezpečnostní gate ADR-072. Potom se
přidá doménový model routy a migrace, gateway adapter a Agent protokol,
co-located Caddy bez Docker socketu, DNS/TLS preflight, UI konfigurace targetu a
nakonec živý rollback/izolační test. Produkční režim se neoznačí `ready`, dokud
neprojde výpadek gateway, kolize dvou současných deployů a izolace dvou
workspaces.

**Stav implementace — základ routování.** Target má explicitní, databázově
omezený `routingMode`. Migrace zachovává všechny existující targety v režimu
`direct-port`; `managed-gateway` přijímá pouze čistý HTTPS DNS origin bez IP,
credentials, cesty, query nebo fragmentu. UI oba režimy jasně rozlišuje.
Produkční režim záměrně zůstává `setup pending` a nejde alokovat ani použít pro
projekt, dokud neexistuje gateway preflight a idempotentní reconcile. Tím se
konfigurace, která jen vypadá produkčně, nemůže omylem označit jako připravená.

**Stav implementace — rezervace hostname.** `GatewayRoute` je samostatný
per-environment záznam s unikátním `environmentId`, `hostname` a `publicUrl`.
Čitelný DNS label doplňuje dvanáctiznakový SHA-256 suffix immutable environment
ID; unikátní databázové indexy jsou konečnou ochranou souběžných zápisů.
Rezervace je idempotentní, po rename vrací uloženou hodnotu a odmítne tiché
převázání na jiný target nebo allocation. Allocation smí použít jen target
zónu nebo její DNS podzónu. Model odděluje desired/observed stav a generation
pro Agent reconcile.

**Stav implementace — read-only preflight.** Agent 0.5 přijímá pouze
allow-listed `gateway-preflight` job s pevným adapterem `caddy` a validovaným
veřejným HTTPS originem. Pro reprezentativní hostname
`initpad-preflight.<zóna>` ověří wildcard DNS, na explicitním originu provede
důvěryhodný TLS handshake na portu 443 a read-only dotaz na Caddy admin API.
Adresu admin API nikdy neposílá control plane ani projekt: je lokální
konfigurací Agenta a musí se přeložit pouze na privátní nebo loopback adresy.
Lab proto provozuje Caddy bez Docker socketu a jeho management síť je interní
bez host portu. Výsledek je uložen na targetu přes job-id fence; retry starého
požadavku nemůže přepsat novější preflight. Změna zóny nebo routing mode
výsledek zneplatní. Preflight záměrně nemění Caddy konfiguraci a sám neodemkne
deployment.

**Stav implementace — deklarativní reconcile.** Agent 0.6 má samostatný
allow-listed `gateway-route` job. Durable payload obsahuje pouze route ID,
generation, desired state, uložený hostname a allocation/workload identitu;
neobsahuje admin URL, upstream ani volnou Caddy konfiguraci. Agent z identity
deterministicky odvodí jméno workload kontejneru a jedinou povolenou
reverse-proxy route. Caddy adapter přijímá jen privátní lokální admin origin,
načte dedikované pole serveru `initpad` s ETag, vlastní route přidá nebo odebere
jedním atomickým `PATCH` s `If-Match` a výsledek znovu ověří. Konflikt změny
retryuje bez ztráty cizích rout a kolizi vlastního route ID s jiným hostname
odmítne.

Control plane před zařazením vyžaduje úspěšný preflight, aktivní allocation a
enrolled Agent s podporovaným route kontraktem. Každý intent inkrementuje `GatewayRoute.generation`, ruší
ještě nezačaté starší joby a ukládá aktuální `reconcileJobId`. Terminal result
se promítne jen při shodě route ID, generation a job fence; failure zachová
poslední známý observed state/revision. Restart API přehrává pouze právě
referencované joby, ne neomezenou historii. Tento základ ještě není napojený
na project deploy/start/stop/remove a gateway zatím není připojována do
allocation sítě; to je následující samostatný krok před aktivací targetu.

**Stav implementace — síťová vazba gateway.** Agent 0.7 rozlišuje v lifecycle
payloadu zpětně kompatibilní `direct-port` a explicitní `managed-gateway`.
Produkční režim používá samostatnou síť odvozenou z allocation namespace,
projektu a prostředí; síť nese target/allocation/project/environment labels a
jakákoliv neshoda se považuje za kolizi bez mutace. Náhodný diagnostický port
se výchozím způsobem váže pouze na `127.0.0.1`, není zdrojem browser URL a lab
jej může explicitně omezit na svou privátní DinD management síť.

Gateway kontejner vybírá výhradně lokální konfigurace
`INITPAD_AGENT_GATEWAY_CONTAINER`; musí běžet a nést label
`com.initpad.gateway=true`. Projektový job nemůže dodat jeho jméno ani Docker
endpoint. Pro aktivní route Agent nejdřív připojí gateway k ověřené workload
síti a potom atomicky přidá Caddy route. Pro stopped/absent nejdřív route
odebere a až potom gateway odpojí. Operace jsou idempotentní a po každém Docker
connect/disconnect znovu ověří skutečné členství. Caddy nadále nemá Docker
socket. Agent route job proto nově vyžaduje verzi 0.7+.

Lokální Agent lab už nemá Caddy v odděleném outer Compose daemonu. Jednorázový,
označený bootstrap jej vytvoří uvnitř stejného izolovaného DinD daemonu jako
workloady; Agent a Caddy sdílejí pouze permissioned Unix admin socket a žádný
admin TCP port neexistuje. Na host je loopbackem publikován jen pevný
aplikační listener. To umožní v následujícím
kroku otestovat skutečné Docker DNS a gateway připojování bez zpřístupnění
Docker API nebo Caddy admin API hostiteli.

**Uživatelské testování.** Administrátor založí Agent target v režimu
`managed-gateway`, nastaví explicitní `https://apps.example.cz` a předem
nakonfiguruje DNS. Dva workspace současně nasadí stejně pojmenovaný projekt;
oba dostanou odlišné stabilní HTTPS URL a navzájem nevidí své workloady. Redeploy,
stop/start a rename URL nezmění. Nezdravý candidate ani nedostupná gateway
nepřepíše poslední funkční route. Remove vrátí 404/410 a úplný teardown nezanechá
kontejner, route ani allocation síť. Gateway admin endpoint a Docker API nejsou
z klientské sítě dostupné.

Reference:
[Caddy — API a ochrana admin endpointu](https://caddyserver.com/docs/api),
[Caddy — automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy — wildcard certificate pattern](https://caddyserver.com/docs/caddyfile/patterns),
[Caddy — reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
