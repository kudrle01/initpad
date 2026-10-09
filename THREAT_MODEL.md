# Model hrozeb InitPadu

## Rozsah a předpoklady důvěry

Implementovaný profil je self-hosted control plane s více uživateli vymezenými
workspace. Členům workspace se nedůvěřuje natolik, aby měli přístup k
metadatům, repozitářům nebo targetům jiného workspace. Členům s odpovídající
rolí se důvěřuje, že vytvářejí aplikační kód a registrují deployment targety.
Vygenerovaný CI kód se považuje za nedůvěryhodný. Nedůvěryhodné jsou veřejný
internet, obsah repozitářů, požadavky webhooků a endpointy targetů.

API záměrně ovládá lokální Docker daemon, aby vytvářelo aplikační kontejnery.
Přístup k Docker daemonu je ekvivalentní právům root na hostu, takže kontejner
API a jeho závislosti patří do důvěryhodné výpočetní základny. To je přijatelné
pro diplomovou práci a single-node profil, ale nejde o pevnou multi-tenant
hranici. Hostovaná multi-tenant edice musí místo socketu hostu použít vzdáleného
deployment agenta nebo Kubernetes API s omezeným service accountem. Workspace
RBAC je autorizační hranicí aplikace, nikoli výpočetní hranicí proti
nepřátelskému workloadu. Implementovaný Agent zajišťuje trust bootstrap,
omezené zjišťování Dockeru, heartbeat, odchozí job protokol s lease a allow-list
životního cyklu Dockeru omezený na allocation. Doručení projektu předává přes
job protokol chráněný fencingem pouze immutable ověřený artefakt a omezenou
konfiguraci v paměti.

## Aktiva

- token správce Gitey, osobní přístupové tokeny uživatelů, deploy tokeny
  jednotlivých repozitářů a secret webhooku;
- podpisové klíče JWT/OIDC a šifrovací klíč;
- zdrojové repozitáře, OCI images a přihlašovací údaje deployment targetů;
- enrollment tokeny Agentů, rotující credentialy jednotlivých targetů a
  krátkodobé lease tokeny jobů;
- stav projektů a identit v PostgreSQL a dostupnost hostu.

## Hlavní opatření

- Samoregistrace v Gitee je vypnutá. Zakládání účtů vlastní InitPad a správce
  instance si volí otevřenou registraci, nebo účty zakládané administrátorem,
  které jsou výchozí. První účet (administrátor) vyžaduje instalační token, takže
  čerstvou instanci nezabere ten, kdo se zaregistruje první (ADR-136).
  Autentizace, GitHub OAuth a setup i enrollment Agenta mají explicitní limity
  specifické pro danou operaci. Atomické čítače PostgreSQL sdílí každá replika
  API a kombinují důvěryhodnou IP klienta s HMAC subjektu účtu nebo tokenu.
  Databáze nikdy neukládá zdrojovou IP, uživatelské jméno, e-mail ani token v
  čitelné podobě.
- Projekty a uživatelské targety patří do workspace. Každý požadavek na serveru
  vyhodnotí autentizované členství. `X-Workspace-Id` je pouze selektor, nikdy
  důkaz oprávnění. Role viewer, member, maintainer, admin a owner oddělují čtení,
  doručení, destruktivní údržbu a správu členství.
- Osobní workspace nemohou přijímat další členy. Změny členství a rolí v týmu se
  synchronizují do oprávnění spolupracovníků v privátních repozitářích Gitey s
  kompenzačním rollbackem, pokud selže kterákoli strana.
- Sessions jsou HTTP-only, SameSite a pod HTTPS Secure s prefixem `__Host-`,
  takže je sousední subdoména nepodvrhne. Změny se session cookie API přijme
  jen jako `application/json` a odmítne je z jiného site podle
  `Sec-Fetch-Site`, takže formulář z aplikace na stejném hostu nebo subdoméně
  nic nezmění (ADR-137). Přesměrování OIDC používají přesnou validaci originu a
  cesty a autorizační kódy jsou jednorázové a expirují.
- Citlivé hodnoty v databázi používají AES-256-GCM. Callback tokeny CI jsou pro
  každý repozitář náhodné a InitPad ukládá pouze jejich hashe SHA-256.
- Gitea tokeny mají rozsah podle spotřebitele a pevný název, takže nové vydání
  předchozí kopii zneplatní (ADR-134). CI repozitáře dostává jen token
  `write:package` pro registry; Git token uživatele (`write:repository`) do
  secretů nikdy nevstupuje. Registry tokeny workspace se vymění, když člen
  ztratí právo zápisu, a reset hesla i deaktivace zruší Git token účtu.
- Webhooky Gitey používají podpis HMAC se zachovanou kompatibilitou s bearer
  tokenem a nikdy nevkládají secrety do URL.
- Runner Actions používá vyhrazený rootless DinD daemon. Nepřipojuje socket ani
  workspace hostu a nepovoluje žádné volumes definované workflow. Souběžnost je
  explicitně omezená, ve výchozím stavu na jeden job, a jeho řídicí síť je
  oddělená od PostgreSQL i od nasazovacích sítí.
- Validace DTO pomocí allow-listu, omezené délky, kontroly politik workspace a
  validace endpointu a cesty targetu snižují riziko injection, IDOR a vyčerpání
  zdrojů.
- Uživatelsky spravovaná spojení SFTP přes SSH připínají otisk SHA-256 hostitelského
  klíče serveru OpenSSH. Změněná nebo chybějící identita spojení zastaví, místo
  aby se tiše důvěřovalo náhradnímu hostu. Nová nasazení s přímými porty se vážou
  pouze na loopback, pokud je administrátor výslovně nezpřístupní.
- Enrollment Agenta smí provést pouze admin workspace, je krátkodobý a
  jednorázový. Databáze ukládá pouze hashe enrollmentu a credentialu a target
  ukládá svůj credential atomicky s oprávněním `0600`. Heartbeat je pouze
  odchozí a hlásí omezený objekt schopností Dockeru, nikoli inventář hostu nebo
  workloadů. Agent 0.10 a novější rotuje aktivní credential po 30 dnech
  dvoufázovým překryvem. Předchozí credential zůstává použitelný, dokud Agent
  atomicky neuloží a neprokáže držení další generace. Ztracená odpověď nebo
  restart proto nemůže odříznout jinak dosažitelný target. Nepotvrzený čekající
  materiál se po 24 hodinách vydá znovu a control plane jeho čitelnou podobu
  nikdy neukládá.
- Joby Agenta jsou omezeny na target, atomicky převzaty a chráněny fencingem
  krátkého lease, jehož token se v čitelné podobě nikdy neukládá ani nezapisuje
  do logů. Monotónní průběh, idempotency klíče a idempotentní dokončení činí
  ztrátu odpovědi a přeřazení lease bezpečnými. Neznámé druhy jobů selžou bez
  interpretace jejich payloadu jako příkazu. Payloady životního cyklu odmítají
  neznámá pole a neobsahují příkaz, entrypoint, mount ani secret. Mutace Dockeru
  vyžadují odpovídající labely targetu, allocation a workloadu a cizí kolize
  názvů zůstanou nedotčeny.
- Workloady Agenta používají immutable digesty image, limity zdrojů a logů,
  `no-new-privileges`, odebrané capabilities doplněné malým runtime allow-listem
  a výměnu řízenou health checkem. Neúspěšní kandidáti nevstupují do restart
  smyček a úklid diagnostiky zachovává images, které existovaly před jobem.
- Deployment operace atomicky zamykají jedno prostředí. Zrušení je uložený
  požadavek a zastaralá práce na pozadí nemůže publikovat přes novější stav.
- API zapisuje strukturované JSON logy s ID požadavku generovaným serverem.
  Deploymenty a joby Agenta sdílejí stabilní korelační ID a Agent ho přijímá
  pouze jako diagnostická metadata. Centralizovaný logger odstraňuje citlivé
  klíče, známé formáty tokenů a credentials v URL, zatímco HTTP access log
  neukládá query stringy ani těla požadavků.
- Aplikační kontejnery dostávají limity paměti, CPU, PID a logů, odebrané
  capabilities a `no-new-privileges`. Webové a API kontejnery platformy jsou,
  kde je to možné, pouze pro čtení.
- Závislosti a actions jsou uzamčeny, audity npm a Composeru jsou součástí
  kontrol releasu. Verzované databázové migrace nahrazují schema push.

## Zbytková rizika

- Vzdálené spuštění kódu v API se může přes řízení Dockeru změnit v kompromitaci
  hostu.
- Aplikační limiter pokrývá cílené a malé distribuované útoky napříč replikami
  API, ale záměrně nenahrazuje limity spojení na edge ani ochranu proti
  volumetrickému DDoS. `INITPAD_TRUST_PROXY_HOPS` musí odpovídat pevné cestě
  reverzní proxy. Důvěra ve více hopů, než skutečně existuje, umožní přímému
  klientovi zfalšovat adresu používanou dimenzí IP.
- GitHub OAuth state, interní OIDC authorization codes a access tokeny jsou
  krátkodobé, jednorázové a uložené v PostgreSQL pouze jako SHA-256 hashe.
  Aktivní tok proto může bezpečně dokončit jiná replika i po restartu procesu;
  plaintext browserové a bearer hodnoty se do databáze neukládají.
- Registrované hosty SFTP jsou mocnými odchozími cíli. Syntaxe hostu,
  rezervované lokální a link-local adresy i credentials v URL se odmítají,
  zatímco cíle RFC1918 zůstávají povolené pro zamýšlené použití v LAN školy nebo
  firmy. Tato výjimka platí pouze pro důvěryhodnou self-hosted edici. Hostovaná
  edice přeloží každý hostname SFTP řízený tenantem před konfigurací i znovu před
  každým socketem SSH, SFTP a HTTP, odmítne celou odpověď DNS, pokud některý
  záznam A nebo AAAA není globálně směrovatelný, a připojí se ke schválené IP
  bez druhého vyhledávání. HTTP probes si ponechávají ověření hostname v TLS a
  nikdy nenásledují přesměrování. Produkční síťový egress firewall zůstává
  požadován jako obrana do hloubky. Otisk SSH je nutné ověřit nezávislým
  administrátorským kanálem, protože přijetí prvního klíče útočníka by útok
  pouze připnulo.
- Rootless DinD stále vyžaduje privilegovaný vnější kontejner. Chrání host před
  běžným ovládáním Dockeru z workflow, ale není rovnocenný vyhrazené VM pro
  runner.
- Workspace RBAC izoluje aplikační data, ale všechna nasazení stále sdílejí
  přihlašovací údaje poskytovatele a hranici důvěry Dockeru self-hosted control
  plane. Tento profil nezpřístupňujte jako nepřátelský veřejný SaaS.
- Přístup Agenta k Docker daemonu je na daném targetu ekvivalentní právům root.
  Odcizený credential Agenta je omezen na target, lze jej odvolat a Agent 0.10 a
  novější jej automaticky rotuje. Starší zaregistrovaní Agenti si credential
  ponechají, dokud nebudou aktualizováni nebo explicitně znovu zaregistrováni.
  Jednotlivé claimy používají krátkodobé fencing tokeny. Existuje vynucování
  allocation, ověřená autorizace artefaktů, doručování konfigurace bezpečné vůči
  secretům a Docker allow-list bez shellu. Agent 0.13.0 má podepsaný veřejný
  multi-arch image, SBOM, provenance a immutable zkontrolovaný kanál releasů.
  Stále je nutná acceptance aktualizace a rollbacku na clean hostu a nezávislá
  bezpečnostní revize. Checksum instalátoru doručený ze stejného HTTPS originu
  control plane odhalí poškození a naváže UI na přesné bajty, ale nevytváří
  nezávislý kořen důvěry. Souborové systémy pouze pro čtení a odebrané
  capabilities nesnižují oprávnění, které předává připojený Docker socket.
  Enrollment přes HTTP je povolen pouze explicitním testovacím příznakem a
  nechrání před nepřátelskou LAN.
- Při provozu přes HTTP sdílejí vestavěné Docker aplikace host InitPadu a
  prohlížeč jim posílá session každého, kdo je otevře. Aplikace člena ji tak
  může zneužít. Ochranou je HTTPS nebo samostatný host aplikací
  (`INITPAD_DEPLOY_PUBLIC_HOST`); InitPad stav hlásí v logu a v Administraci.
- Container balíčky v Gitee patří účtu, nikoli repozitáři. Člen týmu, který
  přečte registry secret repozitáře, proto může přepsat image jiného projektu
  téhož vlastníka. Týmové repozitáře navíc leží v osobním prostoru autora, takže
  odebraný člen je dál vlastní. Obojí odstraní až Gitea organizace pro každý
  workspace.
- Synchronizace spolupracovníků v Gitee zahrnuje dva systémy, a proto používá
  kompenzaci místo distribuované transakce. Před hostovaným produkčním použitím
  je nutná rekonciliace a auditní log.
- Zálohy obsahují credentials. Musí být šifrované, uložené mimo host a testované
  pravidelnými cvičeními obnovy.
- Výstup JSON je pouze lokálním kontraktem stdout a stderr. Hostovaný provoz
  stále vyžaduje centrální collector s řízením přístupu, retenci, alerting,
  metriky a export OpenTelemetry. Korelační ID není autentizačním credentialem
  ani náhradou auditní stopy.

## Produkční gate

Než bude InitPad označen za hostovaný multi-tenant nebo enterprise-ready, je
nutné odebrat Docker socket hostu z control plane, doplnit produkční doručování
e-mailu, sladit oprávnění SCM, použít externí správce secretů, doplnit
centralizované auditní logy, metriky a traces, vynutit aplikační egress politiku
znovu na úrovni sítě a firewallu a otestovat obnovu po havárii. Kvóty přijímání
nových workspace, trvalé granty OIDC, produkční approvals, skenování image a
SBOM, podepsané artefakty a testy obnovy jsou implementovány, ale stále vyžadují
úplnou hostovanou stagingovou acceptance popsanou v roadmapě.
