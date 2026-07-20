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
  (`gitea.localhost:3001`, v CI mapovanou na izolovanou gateway). Lokální registry je HTTP
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
před promote na prod. Laravel potřebuje per-environment `APP_KEY`; produkční
správa runtime konfigurace patří do budoucího secret-management rozšíření.

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
se zaregistrují jako běžní uživatelé a přijmou workspace pozvánku → založí
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
RBAC, tenant-scoped dotazy, invitation/e-mail onboarding, audit log, kvóty,
ochrana proti zneužití, externalizované secrety a odstranění host Docker socketu
z control plane. Agent dostává pouze krátkodobé job credentials a omezení svého
target allocation; nemá globální přístup k ostatním týmům.

**Rozsah diplomky.** Implementační MVP zahrnuje jeden veřejný control plane,
workspaces/role a pozvánky, import existujícího repozitáře,
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
daemon host-gateway mapování i pro lokální `gitea.localhost`; job samotný ho
pro checkout ani callback nepoužívá.

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

**Uživatelské testování.** Aktuální adapterový mezikrok je testovatelný
automatizovaně, ale ještě nepřidává nový UI tok. Po dokončení token vaultu a
registry zapojení owner vybere osobní nebo organizační instalaci, vytvoří
soukromé repo, uvidí první Actions run a import zobrazí všechny stránky rep.
Odvolaný/expirující token musí skončit výzvou k reautorizaci bez osiřelého repa.
Samotný vault se nyní uživatelsky ověří regresně: GitHub link/login i
organization installation setup musí dál projít. Přímý pozitivní test rotace a
revokace bude dostupný s osobním create tokem v následujícím podkroku.

Reference: [Create a repository for the authenticated user](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user),
[Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens).
