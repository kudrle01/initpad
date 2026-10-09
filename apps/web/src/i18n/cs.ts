/**
 * Czech dictionary. The key is the English source text exactly as it appears in
 * the code (`t('…')`), so a missing entry is a compile-time error and a new or
 * reworded English string shows up here as a missing key.
 *
 * `{name}` placeholders and `<tag>…</tag>` markers must be kept; their order may
 * change freely. Grouped by the file where a message is first used.
 */
export const cs = {
  // components/molecules/CopyField.tsx
  'Copy to clipboard': 'Zkopírovat do schránky',
  copied: 'zkopírováno',
  copy: 'kopírovat',
  'Clipboard access is blocked. Select the text and press Ctrl+C (Cmd+C on macOS).':
    'Přístup ke schránce je zablokovaný. Označte text a stiskněte Ctrl+C (na macOS Cmd+C).',
  // components/molecules/InfoTip.tsx
  'More information': 'Více informací',
  // components/molecules/LanguageSwitch.tsx
  Language: 'Jazyk',
  // components/molecules/LoadErrorState.tsx
  'Could not load this content': 'Obsah se nepodařilo načíst',
  'Try again': 'Zkusit znovu',
  // components/molecules/PageHeader.tsx
  'About {title}': 'O sekci {title}',
  // components/molecules/RouteLoading.tsx
  'Loading page…': 'Načítání stránky…',
  // components/molecules/TargetUsageList.tsx
  'Move or remove these environments before removing workspace access or deleting the server.':
    'Než odeberete přístup workspace nebo smažete server, přesuňte nebo odstraňte tato prostředí.',
  // components/molecules/ThemeToggle.tsx
  Light: 'Světlý',
  Dark: 'Tmavý',
  System: 'Podle systému',
  Appearance: 'Vzhled',
  'Switch to dark theme': 'Přepnout na tmavý motiv',
  'Switch to light theme': 'Přepnout na světlý motiv',
  // components/organisms/admin/PlatformUpdateCard.tsx
  'Platform updates': 'Aktualizace platformy',
  'Signed releases with automatic backup, readiness checks and image rollback.':
    'Podepsaná vydání s automatickou zálohou, kontrolou připravenosti a návratem k předchozím image.',
  Refresh: 'Obnovit',
  'Checking platform updates': 'Kontrola aktualizací platformy',
  Installed: 'Nainstalováno',
  Unknown: 'Neznámá',
  'Latest verified': 'Poslední ověřená',
  Release: 'Vydání',
  'Candidate update channel · use only on a disposable acceptance server.':
    'Kanál kandidátních aktualizací · používejte jen na testovacím serveru, o který můžete přijít.',
  'Connection interrupted while InitPad restarts. Reconnecting…':
    'Spojení se přerušilo, InitPad se restartuje. Obnovuje se…',
  'InitPad {currentVersion} is current': 'InitPad {currentVersion} je aktuální',
  'Supervisor online · no newer verified release.':
    'Supervisor je online · novější ověřené vydání není k dispozici.',
  'Platform update progress': 'Průběh aktualizace platformy',
  'Installing…': 'Instaluje se…',
  'Install update': 'Nainstalovat aktualizaci',
  'Release information is stale; refresh before installing.':
    'Informace o vydání jsou zastaralé; před instalací je obnovte.',
  'Recent update history': 'Historie posledních aktualizací',
  // components/organisms/admin/WorkspaceCapacityCard.tsx
  'Workspace limits': 'Limity workspace',
  'Tenant-wide limits for control-plane work and artifact storage.':
    'Limity pro celý workspace: práce řídicí roviny a úložiště artefaktů.',
  'Loading workspace limits': 'Načítání limitů workspace',
  'No workspaces found.': 'Žádný workspace nenalezen.',
  'Put {workspaceName} over its new limit?':
    'Nastavit workspace {workspaceName} limit pod současné využití?',
  'Existing resources remain available, but new work in the affected category will be blocked.':
    'Stávající zdroje zůstanou dostupné, ale nová práce v dotčené kategorii bude blokována.',
  'Apply lower limit': 'Použít nižší limit',
  'Updated limits for {workspaceName}': 'Limity pro {workspaceName} byly upraveny',
  Projects: 'Projekty',
  Members: 'Členové',
  Servers: 'Servery',
  'Active operations': 'Aktivní operace',
  'Artifact GiB': 'Artefakty (GiB)',
  '({used} used)': '(využito {used})',
  'Save limits': 'Uložit limity',
  // components/organisms/agent-setup/AgentDiagnosticsPanel.tsx
  'Lease expired. Waiting for the Agent to reconnect and retry automatically.':
    'Platnost přidělení úlohy vypršela. Čeká se, až se Agent znovu připojí a úlohu automaticky zopakuje.',
  'The diagnostic image pull timed out. Docker may have cached partial layers; verify registry access and run Test Docker again.':
    'Stahování diagnostického image vypršelo. Docker si mohl uložit neúplné vrstvy; ověřte přístup k registru a spusťte Test Dockeru znovu.',
  'Durable job protocol': 'Protokol trvalých úloh',
  'About the Agent protocol test': 'O testu protokolu Agenta',
  Checks: 'Co se kontroluje',
  'Claim, progress reporting, lease renewal and completion over 35 seconds.':
    'Převzetí úlohy, hlášení průběhu, obnovení přidělení a dokončení během 35 sekund.',
  Impact: 'Dopad',
  'Does not run a shell command or create a workload. Offline jobs wait safely in the queue.':
    'Nespouští shellový příkaz ani nevytváří workload. Úlohy pro offline Agenta bezpečně čekají ve frontě.',
  'Checks Agent queue and lease handling without creating a workload.':
    'Ověří frontu úloh Agenta a práci s přidělením, aniž by vytvořil workload.',
  'Queue a protocol probe': 'Zařadit test protokolu do fronty',
  'The Agent must be enrolled': 'Agent musí být zaregistrovaný',
  'Test protocol': 'Otestovat protokol',
  'Restricted Docker lifecycle': 'Omezený životní cyklus Dockeru',
  'About the Docker lifecycle test': 'O testu životního cyklu Dockeru',
  'Deploy, health, bounded logs, replacement, rollback, stop and restart.':
    'Nasazení, stav, omezené logy, výměna, rollback, zastavení a restart.',
  Cleanup: 'Úklid',
  'Removes the temporary container, diagnostic image and empty network afterwards.':
    'Po testu odstraní dočasný kontejner, diagnostický image a prázdnou síť.',
  Restrictions: 'Omezení',
  'No shell command, host mount or deployment secret is sent to the Agent.':
    'Agentovi se neposílá žádný shellový příkaz, připojení hostitelského adresáře ani tajemství nasazení.',
  'Runs a temporary isolated workload and removes it after the test.':
    'Spustí dočasný izolovaný workload a po testu ho odstraní.',
  'Queue a Docker lifecycle test': 'Zařadit test životního cyklu Dockeru do fronty',
  'Agent 0.3.0 or newer must be enrolled': 'Musí být zaregistrovaný Agent 0.3.0 nebo novější',
  'Test Docker': 'Otestovat Docker',
  'Production gateway preflight': 'Předběžná kontrola produkční brány',
  'About the gateway preflight': 'O předběžné kontrole brány',
  'The configured DNS zone, trusted TLS on port 443 and the private Caddy adapter.':
    'Nastavená DNS zóna, důvěryhodné TLS na portu 443 a soukromý adaptér Caddy.',
  'Read-only: no route is created and gateway configuration is not changed.':
    'Pouze pro čtení: nevytváří se žádná routa a konfigurace brány se nemění.',
  'Checks DNS, TLS and the private gateway without changing routes.':
    'Ověří DNS, TLS a soukromou bránu beze změny rout.',
  'preflight {status}': 'kontrola brány: {status}',
  'Queue a read-only gateway preflight (Agent 0.5.0 or newer)':
    'Zařadit předběžnou kontrolu brány do fronty (pouze čtení, Agent 0.5.0 nebo novější)',
  'Test gateway': 'Otestovat bránu',
  'No protocol jobs yet.': 'Zatím žádné úlohy protokolu.',
  'Recent Agent tests · newest first': 'Poslední testy Agenta · od nejnovějších',
  '{kind} · attempt {attempt}': '{kind} · pokus {attempt}',
  '{kind} job progress': 'Průběh úlohy {kind}',
  // components/organisms/AgentSetupDialog.tsx
  'not enrolled': 'nezaregistrován',
  offline: 'offline',
  online: 'online',
  disabled: 'vypnuto',
  'Agent release information is unavailable': 'Informace o vydání Agenta nejsou dostupné',
  'Replace the pending enrollment token?': 'Nahradit čekající registrační token?',
  'Only one unused enrollment token can be valid for this target.':
    'Pro tento cíl může být platný jen jeden nepoužitý registrační token.',
  'Generate a new token': 'Vygenerovat nový token',
  'The previously generated token stops working immediately.':
    'Dříve vygenerovaný token okamžitě přestane fungovat.',
  'A currently enrolled Agent remains connected until the new token is redeemed.':
    'Aktuálně zaregistrovaný Agent zůstane připojený, dokud se nový token nepoužije.',
  'Disconnect the Agent for {name}?': 'Odpojit Agenta pro {name}?',
  'This revokes the server identity used to receive work from InitPad without stopping its workloads.':
    'Zruší se identita serveru, přes kterou přijímá práci z InitPadu. Jeho workloady se nezastaví.',
  'Disconnect Agent': 'Odpojit Agenta',
  'Queued work is cancelled and the server cannot receive further jobs.':
    'Práce ve frontě se zruší a server nebude moci přijímat další úlohy.',
  'Running applications stay untouched.': 'Běžící aplikace zůstanou nedotčené.',
  'Restoring the connection requires a new enrollment.':
    'Obnovení spojení vyžaduje novou registraci.',
  'Install Agent {nextVersion}?': 'Nainstalovat Agenta {nextVersion}?',
  'InitPad will send the signed release manifest to this Agent and replace only the Agent container.':
    'InitPad pošle tomuto Agentovi podepsaný manifest vydání a vymění pouze kontejner Agenta.',
  'Application workloads keep running while the Agent restarts.':
    'Aplikační workloady během restartu Agenta běží dál.',
  'New jobs wait briefly until the updated Agent reconnects.':
    'Nové úlohy krátce počkají, než se aktualizovaný Agent znovu připojí.',
  'If the new Agent cannot authenticate, the previous container is restored automatically.':
    'Pokud se nový Agent nedokáže ověřit, automaticky se obnoví předchozí kontejner.',
  'InitPad Agent': 'InitPad Agent',
  '{name} connects outbound to this control plane. InitPad never needs inbound SSH access or a public management port on the Docker server.':
    '{name} se připojuje odchozím spojením k této řídicí rovině. InitPad nikdy nepotřebuje příchozí SSH přístup ani veřejný port pro správu na Docker serveru.',
  'Agent status': 'Stav Agenta',
  'Version {version} · protocol {protocolVersion}': 'Verze {version} · protokol {protocolVersion}',
  'No Agent heartbeat received yet': 'Od Agenta zatím nepřišel žádný heartbeat',
  'Credential generation {generation} · active since {date}':
    'Generace přihlašovacích údajů {generation} · aktivní od {date}',
  'Credential generation {generation}': 'Generace přihlašovacích údajů {generation}',
  'Agent is offline': 'Agent je offline',
  'The control plane has not received a heartbeat for more than 90 seconds. Jobs remain safely queued and continue automatically after the Agent reconnects.':
    'Řídicí rovina nedostala heartbeat déle než 90 sekund. Úlohy bezpečně čekají ve frontě a po opětovném připojení Agenta budou automaticky pokračovat.',
  'Last contact: {date}': 'Poslední kontakt: {date}',
  'Credential rotation is waiting for Agent confirmation. The current credential remains valid, so reconnecting the Agent is safe.':
    'Rotace přihlašovacích údajů čeká na potvrzení Agentem. Stávající údaje zůstávají platné, takže opětovné připojení Agenta je bezpečné.',
  'Agent {latestVersion} is available': 'Je k dispozici Agent {latestVersion}',
  'This is the final manual, identity-preserving update. Agent 0.13 and newer can install later verified releases remotely.':
    'Toto je poslední ruční aktualizace se zachováním identity. Agent 0.13 a novější umí další ověřená vydání instalovat vzdáleně.',
  'The release manifest and immutable image identity were verified. Installation still requires your confirmation.':
    'Manifest vydání a identita neměnného image byly ověřeny. Instalaci je i tak nutné potvrdit.',
  'Candidate update channel · use only on an acceptance server.':
    'Kanál kandidátních aktualizací · používejte jen na akceptačním serveru.',
  'Install the verified update on this Agent': 'Nainstalovat ověřenou aktualizaci na tohoto Agenta',
  'The Agent must be online before it can update itself':
    'Aby se Agent mohl sám aktualizovat, musí být online',
  'Release details': 'Podrobnosti o vydání',
  'Showing the last verified check': 'Zobrazena je poslední ověřená kontrola',
  '{error} Agent management remains available.': '{error} Správa Agenta zůstává dostupná.',
  'Docker {engineVersion} · API {apiVersion}': 'Docker {engineVersion} · API {apiVersion}',
  rootless: 'rootless',
  '{cpus} CPU · {memoryBytes} available to Docker':
    '{cpus} CPU · {memoryBytes} dostupných pro Docker',
  'This token is shown once and expires at <b>{date}</b>. Closing this dialog discards the plaintext.':
    'Tento token se zobrazí jen jednou a jeho platnost skončí v <b>{date}</b>. Zavřením dialogu se čitelná podoba zahodí.',
  'Enrollment token': 'Registrační token',
  'Install and enroll on the Docker server': 'Instalace a registrace na Docker serveru',
  'Agent installer': 'Instalátor Agenta',
  'Downloads the script without running it': 'Stáhne skript, aniž by ho spustil',
  'Download script only': 'Jen stáhnout skript',
  'Copy and run this command in an interactive terminal on the Docker server.':
    'Zkopírujte tento příkaz a spusťte ho v interaktivním terminálu na Docker serveru.',
  'It verifies the checksum and immutable Agent {version} image, verifies that any saved identity belongs to this target, then starts and health-checks the Agent. A new server requests the token through a hidden prompt, so it never enters shell history.':
    'Ověří kontrolní součet a neměnný image Agenta {version}, zkontroluje, že případná uložená identita patří k tomuto cíli, a pak Agenta spustí a ověří jeho stav. Nový server si token vyžádá skrytou výzvou, takže se nedostane do historie shellu.',
  'Replace an invalid existing identity': 'Nahradit neplatnou stávající identitu',
  'Use this only if verification says the saved credential was rejected, or when reconnecting a server from a deleted or restored target. It replaces the old identity using the enrollment token above.':
    'Použijte jen tehdy, když ověření hlásí odmítnutí uložených údajů, nebo při opětovném připojení serveru ze smazaného či obnoveného cíle. Starou identitu nahradí pomocí registračního tokenu výše.',
  'HTTP enrollment is for a trusted local test only. Use HTTPS before exposing InitPad or this Agent connection outside an isolated network.':
    'Registrace přes HTTP je určená jen pro důvěryhodný místní test. Než InitPad nebo toto spojení Agenta zpřístupníte mimo izolovanou síť, použijte HTTPS.',
  'Agent installer is not configured': 'Instalátor Agenta není nastavený',
  'Loading Agent release information…': 'Načítání informací o vydání Agenta…',
  '{reason}. Ask the instance administrator to run <install>deploy/install.sh</install>. Source-build lab users can enroll with <enroll>deploy/agent-lab.sh enroll</enroll>.':
    '{reason}. Požádejte správce instance, aby spustil <install>deploy/install.sh</install>. Uživatelé laboratorního buildu ze zdrojů se mohou zaregistrovat příkazem <enroll>deploy/agent-lab.sh enroll</enroll>.',
  'Managed gateway installations also need the target-local Caddy socket, gateway container and optional private CA flags shown by the installer help.':
    'Instalace se spravovanou bránou potřebují navíc místní socket Caddy na cíli, kontejner brány a volitelné přepínače pro soukromou CA, které ukáže nápověda instalátoru.',
  'Agent {version} is current': 'Agent {version} je aktuální',
  'Connected to this target and ready to receive jobs. No action is required.':
    'Je připojený k tomuto cíli a připravený přijímat úlohy. Není potřeba nic dělat.',
  'Reconnect Agent {version}': 'Znovu připojit Agenta {version}',
  'Reconnect Agent': 'Znovu připojit Agenta',
  'Update Agent to {version}': 'Aktualizovat Agenta na {version}',
  'Update Agent': 'Aktualizovat Agenta',
  'Run the verified installer on the Docker server to restore this connection while preserving its identity.':
    'Spusťte na Docker serveru ověřený instalátor. Spojení se obnoví a identita zůstane zachována.',
  'The existing server identity is verified and preserved. No new enrollment token is required.':
    'Stávající identita serveru je ověřená a zůstane zachována. Nový registrační token není potřeba.',
  'The installer verifies the checksum, immutable image, target binding and saved credential before replacing the running container. If the new Agent cannot heartbeat, it restores the previous container.':
    'Instalátor před výměnou běžícího kontejneru ověří kontrolní součet, neměnný image, vazbu na cíl a uložené údaje. Pokud nový Agent neodešle heartbeat, obnoví předchozí kontejner.',
  'HTTP is suitable only for a trusted local test network. Use HTTPS in production.':
    'HTTP je vhodné jen pro důvěryhodnou místní testovací síť. V produkci použijte HTTPS.',
  'A safe reconnect image is not available':
    'Bezpečný image pro opětovné připojení není k dispozici',
  'The configured release is older than Agent {version}. Restart the existing <code>initpad-agent</code> container or ask the instance administrator to publish the current release; InitPad will not downgrade this server.':
    'Nastavené vydání je starší než Agent {version}. Restartujte stávající kontejner <code>initpad-agent</code>, nebo požádejte správce instance o zveřejnění aktuálního vydání; InitPad tento server na starší verzi nepřevede.',
  '{reason}. Ask the instance administrator to update the reviewed Agent release.':
    '{reason}. Požádejte správce instance o aktualizaci schváleného vydání Agenta.',
  'Generate a short-lived, single-use enrollment when you are ready at the Docker server. A new enrollment does not disconnect the current Agent until it is redeemed.':
    'Krátkodobou jednorázovou registraci vygenerujte, až budete u Docker serveru. Nová registrace neodpojí stávajícího Agenta, dokud se nepoužije.',
  'Generate enrollment': 'Vygenerovat registraci',
  // components/organisms/AllocationDialog.tsx
  '{cpu} CPU · {memory} MB · {processes} processes':
    '{cpu} CPU · {memory} MB · {processes} procesů',
  'cleanup {schedule}': 'úklid {schedule}',
  'no automatic cleanup': 'bez automatického úklidu',
  'Edit workspace access': 'Upravit přístup workspace',
  'Enable workspace access': 'Povolit přístup workspace',
  'Set this workspace’s deployment limits on the server.':
    'Nastavte limity nasazení tohoto workspace na serveru.',
  'About the workspace namespace': 'O namespace workspace',
  Namespace: 'Namespace',
  'InitPad derives an isolated namespace from the workspace.':
    'InitPad odvodí izolovaný namespace z workspace.',
  Credentials: 'Přihlašovací údaje',
  'Server credentials stay separate and are never copied into the workspace.':
    'Přihlašovací údaje serveru zůstávají oddělené a do workspace se nikdy nekopírují.',
  Server: 'Server',
  'About allowed runtimes': 'O povolených runtimech',
  'Access can use all or only some of the runtimes supported by this server.':
    'Přístup může využívat všechny runtimy, které server podporuje, nebo jen některé.',
  'Allowed runtimes': 'Povolené runtimy',
  'Environment quota': 'Kvóta prostředí',
  'How many environments this workspace may run on the server.':
    'Kolik prostředí smí tento workspace na serveru provozovat.',
  'Limits, cleanup and address': 'Limity, úklid a adresa',
  'CPU (millicores)': 'CPU (milicory)',
  'Memory (MB)': 'Paměť (MB)',
  Processes: 'Procesy',
  'Applied to every environment of this workspace on the server.':
    'Platí pro každé prostředí tohoto workspace na serveru.',
  'About automatic cleanup': 'O automatickém úklidu',
  'Expired dev/test workloads are removed automatically. Repositories and production are never affected.':
    'Workloady dev a test se po vypršení automaticky odstraní. Repozitářů ani produkce se to nikdy netýká.',
  'Dev lifetime (hours)': 'Životnost dev (hodiny)',
  'Keep until removed': 'Ponechat do odstranění',
  'Test lifetime (hours)': 'Životnost test (hodiny)',
  'About the public URL override': 'O vlastní veřejné URL',
  'Leave this blank to inherit the server address. Shared platform servers add the workspace namespace automatically.':
    'Nechte prázdné, pokud se má převzít adresa serveru. Sdílené servery platformy přidávají namespace workspace automaticky.',
  'Public URL override': 'Vlastní veřejná URL',
  'Derived from the server': 'Odvozena ze serveru',
  Cancel: 'Zrušit',
  'Save access': 'Uložit přístup',
  'Enable access': 'Povolit přístup',
  // components/organisms/CommitList.tsx
  'CI failed': 'CI selhalo',
  'CI running': 'CI běží',
  'awaiting CI': 'čeká na CI',
  'deploy failed': 'nasazení selhalo',
  deploying: 'nasazuje se',
  'deploy required': 'čeká na nasazení',
  passed: 'prošlo',
  'No commits yet — clone the repository and push to trigger the CI/CD pipeline.':
    'Zatím žádné commity — naklonujte repozitář a pushněte, tím se spustí CI/CD pipeline.',
  'Collapse commit {sha}: {message}': 'Sbalit commit {sha}: {message}',
  'Expand commit {sha}: {message}': 'Rozbalit commit {sha}: {message}',
  'View commit in {provider}': 'Zobrazit commit v {provider}',
  'View this publication in InitPad deployment history':
    'Zobrazit tuto publikaci v historii nasazení InitPadu',
  'View job log in {provider}': 'Zobrazit log úlohy v {provider}',
  'The original SCM handoff job failed. InitPad later published the same verified build successfully, so another runner was not started.':
    'Původní předávací úloha v SCM selhala. InitPad později stejný ověřený build úspěšně publikoval, takže se další runner nespouštěl.',
  'Waiting for the {provider} Actions runner to pick up this commit.':
    'Čeká se, až si tento commit převezme runner {provider} Actions.',
  'CI has verified this commit. Deploy the existing build through InitPad; another runner is not required.':
    'CI tento commit ověřilo. Nasaďte stávající build přes InitPad; další runner není potřeba.',
  'CI has verified this commit, but its latest InitPad deployment failed. The verified build remains available for retry.':
    'CI tento commit ověřilo, ale jeho poslední nasazení přes InitPad selhalo. Ověřený build je stále k dispozici pro další pokus.',
  'View run & logs in {provider}': 'Zobrazit běh a logy v {provider}',
  // components/organisms/CreateWorkspaceDialog.tsx
  'Add new workspace': 'Přidat nový workspace',
  'Create a shared space for a team. You will become its owner and can invite members afterwards.':
    'Vytvořte sdílený prostor pro tým. Stanete se jeho vlastníkem a poté můžete pozvat členy.',
  'Workspace name': 'Název workspace',
  'Platform team': 'Platformní tým',
  'Workspace slug': 'Slug workspace',
  'About the workspace slug': 'O slugu workspace',
  'A stable identifier used in namespaces and URLs. Use lowercase letters, numbers and hyphens.':
    'Stabilní identifikátor používaný v namespace a URL. Použijte malá písmena, číslice a pomlčky.',
  'Use 2–40 characters, start with a letter and avoid the reserved personal- prefix.':
    'Použijte 2–40 znaků, začněte písmenem a vyhněte se vyhrazené předponě personal-.',
  'Creating…': 'Vytváří se…',
  'Create workspace': 'Vytvořit workspace',
  // components/organisms/DeleteProjectDialog.tsx
  'Delete project': 'Smazat projekt',
  'InitPad will remove every managed deployment before deleting its project record. Cleanup must succeed on every target by default. Protected leftovers can only be detached through a separate explicit acknowledgement.':
    'InitPad před smazáním záznamu projektu odstraní všechna spravovaná nasazení. Úklid musí ve výchozím stavu uspět na každém cíli. Chráněné pozůstatky lze odpojit jen samostatným výslovným potvrzením.',
  'Cleanup plan': 'Plán úklidu',
  '{name} deployment': 'Nasazení {name}',
  'No active deployments': 'Žádná aktivní nasazení',
  '{name} cleanup pending': '{name}: úklid čeká na dokončení',
  'Generated images and packages': 'Vygenerované image a balíčky',
  remove: 'odstranit',
  'InitPad project record': 'Záznam projektu v InitPadu',
  'remove · release workspace name': 'odstranit · uvolnit název ve workspace',
  'Deployment targets and unrelated server files are never deleted.':
    'Cíle nasazení ani nesouvisející soubory na serveru se nikdy nemažou.',
  'Remove the production deployment': 'Odstranit produkční nasazení',
  'Production will become unavailable and its deployed files will be deleted.':
    'Produkce přestane být dostupná a její nasazené soubory se smažou.',
  'Delete the InitPad record with protected cleanup still pending':
    'Smazat záznam v InitPadu, i když chráněný úklid ještě čeká',
  'The public application is already gone. A target administrator must still delete the listed quarantined paths. InitPad cannot retry that cleanup after this project record is deleted.':
    'Veřejná aplikace už je pryč. Správce cíle musí uvedené cesty v karanténě ještě smazat ručně. Po smazání záznamu projektu už InitPad tento úklid zopakovat nemůže.',
  'Also delete the source repository and release its name':
    'Smazat také zdrojový repozitář a uvolnit jeho název',
  'Optional and irreversible. If you preserve the repository, its name remains occupied in Gitea and should later be added back as an existing project. Delete it if a brand-new project must reuse the same name.':
    'Volitelné a nevratné. Pokud repozitář ponecháte, jeho název zůstane v Gitee obsazený a později ho bude potřeba přidat zpět jako existující projekt. Smažte ho, pokud má stejný název použít úplně nový projekt.',
  'Type <b>{projectName}</b> to confirm:': 'Pro potvrzení napište <b>{projectName}</b>:',
  'deleting…': 'maže se…',
  // components/organisms/DeploymentActivity.tsx
  'run {runId}': 'běh {runId}',
  'No deployment activity yet.': 'Zatím žádná aktivita nasazení.',
  'Deployment completed': 'Nasazení dokončeno',
  // components/organisms/EnvironmentPipeline.tsx
  'Verified build': 'Ověřený build',
  'Verified build sha256:{digest}': 'Ověřený build sha256:{digest}',
  'build {digest}': 'build {digest}',
  'Push to the default branch and wait for CI verification.':
    'Pushněte do výchozí větve a počkejte na ověření v CI.',
  'Request verified build for production': 'Požádat o nasazení ověřeného buildu do produkce',
  'Request this verified build for production':
    'Požádat o nasazení tohoto ověřeného buildu do produkce',
  'A verified build and available production target are required':
    'Je potřeba ověřený build a dostupný produkční cíl',
  'Request prod': 'Žádost o prod',
  'View InitPad deployment history': 'Zobrazit historii nasazení InitPadu',
  queued: 've frontě',
  'Environment actions': 'Akce prostředí',
  'Re-run failed GitHub jobs': 'Znovu spustit neúspěšné úlohy na GitHubu',
  'Deploy verified build': 'Nasadit ověřený build',
  Deploy: 'Nasadit',
  'Request production redeploy': 'Požádat o opětovné nasazení produkce',
  'Redeploy verified build': 'Znovu nasadit ověřený build',
  'Request production rollback…': 'Požádat o rollback produkce…',
  'Roll back to previous version…': 'Vrátit na předchozí verzi…',
  'Workload diagnostics…': 'Diagnostika workloadu…',
  Start: 'Spustit',
  Stop: 'Zastavit',
  'Change target': 'Změnit cíl',
  'Cancel deploy': 'Zrušit nasazení',
  'Retry cleanup': 'Zopakovat úklid',
  'Remove deployment': 'Odstranit nasazení',
  'Nothing deployed yet': 'Zatím nic nasazeno',
  yours: 'vlastní',
  'Server is {state}. The URL may remain online, but InitPad management is unavailable. <link>Reconnect server</link>.':
    'Server je ve stavu „{state}“. URL může zůstat dostupná, ale správa přes InitPad nefunguje. <link>Znovu připojit server</link>.',
  'Workspace access is paused. Existing workloads remain manageable, but deploy, redeploy and rollback are unavailable. <link>Manage access</link>.':
    'Přístup workspace je pozastavený. Stávající workloady lze dál spravovat, ale nasazení, opětovné nasazení a rollback nejsou dostupné. <link>Spravovat přístup</link>.',
  'Target change pending — resume workspace access before deploying.':
    'Změna cíle čeká — před nasazením obnovte přístup workspace.',
  'Target changed — deploy to apply it.': 'Cíl se změnil — nasaďte, aby se změna projevila.',
  'Deploying…': 'Nasazuje se…',
  '{name} deployment progress': 'Průběh nasazení {name}',
  Deploying: 'Nasazuje se',
  'Scheduled cleanup {date}. Redeploy to renew.':
    'Plánovaný úklid {date}. Opětovným nasazením ho odložíte.',
  'in sync': 'shodné',
  'deploying…': 'nasazuje se…',
  'Request v{version} from {name} for production':
    'Požádat o nasazení v{version} z {name} do produkce',
  'Deploy v{version} from {name} to {next}': 'Nasadit v{version} z {name} do {next}',
  'Resume workspace access before deploying to {next}':
    'Před nasazením do {next} obnovte přístup workspace',
  'Reconnect the {next} server before deploying': 'Před nasazením znovu připojte server pro {next}',
  'Deploy to {name} first': 'Nejdřív nasaďte do {name}',
  'Deploy to {next}': 'Nasadit do {next}',
  // components/organisms/EnvironmentTargetFields.tsx
  Selection: 'Výběr',
  'Choose a deployment server for each environment. One server may host several environments.':
    'Pro každé prostředí zvolte server pro nasazení. Jeden server může hostovat několik prostředí.',
  Isolation: 'Izolace',
  'InitPad keeps dev, test and prod workloads separate.':
    'InitPad drží workloady dev, test a prod oddělené.',
  'Private servers': 'Soukromé servery',
  'Local or private Docker servers connect outbound through InitPad Agent.':
    'Místní nebo soukromé Docker servery se připojují odchozím spojením přes InitPad Agenta.',
  Defaults: 'Výchozí hodnoty',
  'Self-hosted deployment targets are selected automatically when compatible.':
    'Cíle nasazení v self-hosted instalaci se vyberou automaticky, pokud jsou kompatibilní.',
  Changes: 'Změny',
  'Each environment can use a different target, now or from the project detail later.':
    'Každé prostředí může používat jiný cíl — hned, nebo později z detailu projektu.',
  retired: 'vyřazeno',
  'reconnect first': 'nejdřív znovu připojte',
  'update or enable Agent': 'aktualizujte nebo povolte Agenta',
  'enroll Agent': 'zaregistrujte Agenta',
  'verify first': 'nejdřív ověřte',
  'Environments & targets': 'Prostředí a cíle',
  'About environment targets': 'O cílech prostředí',
  '{environment} target': 'Cíl pro {environment}',
  'Choose target…': 'Vyberte cíl…',
  'No connected and verified target can run <b>{template}</b>. <link>Add or reconnect a server</link> before creating the project.':
    'Žádný připojený a ověřený cíl neumí spustit <b>{template}</b>. Před vytvořením projektu <link>přidejte nebo znovu připojte server</link>.',
  'Some compatible targets are disabled until their connection or Agent is ready in <link>Servers</link>.':
    'Některé kompatibilní cíle jsou vypnuté, dokud v sekci <link>Servery</link> nebude připravené jejich připojení nebo Agent.',
  // components/organisms/EnvVarsDialog.tsx
  'Replace {normalizedKey} in {env}?': 'Nahradit {normalizedKey} v {env}?',
  'The current value cannot be recovered from InitPad after it is overwritten.':
    'Po přepsání už současnou hodnotu z InitPadu nelze získat zpět.',
  'Replace secret': 'Nahradit tajemství',
  'Replace variable': 'Nahradit proměnnou',
  'The stored secret value is replaced.': 'Uložená hodnota tajemství se nahradí.',
  'The stored configuration value is replaced.': 'Uložená konfigurační hodnota se nahradí.',
  'The running workload is unchanged until the environment is redeployed.':
    'Běžící workload se nezmění, dokud prostředí znovu nenasadíte.',
  'Saved {normalizedKey}': 'Uloženo: {normalizedKey}',
  'Delete {k} from {env}?': 'Smazat {k} z {env}?',
  'The encrypted secret value cannot be recovered after deletion.':
    'Šifrovanou hodnotu tajemství po smazání nelze obnovit.',
  'The configuration value cannot be recovered after deletion.':
    'Konfigurační hodnotu po smazání nelze obnovit.',
  'Delete secret': 'Smazat tajemství',
  'Delete variable': 'Smazat proměnnou',
  'The variable is removed from the next deployment configuration.':
    'Proměnná se odstraní z konfigurace příštího nasazení.',
  'The currently running workload is unchanged until the environment is redeployed.':
    'Aktuálně běžící workload se nezmění, dokud prostředí znovu nenasadíte.',
  'Environment variables — <span>{env}</span>': 'Proměnné prostředí — <span>{env}</span>',
  'Runtime config and secrets injected into this environment on the next deploy. Redeploy to apply changes. Secret values are stored encrypted and never shown again.':
    'Běhová konfigurace a tajemství, které se do tohoto prostředí vloží při příštím nasazení. Změny se projeví po opětovném nasazení. Hodnoty tajemství se ukládají šifrovaně a už se nikdy nezobrazí.',
  'No variables yet.': 'Zatím žádné proměnné.',
  'Delete {key}': 'Smazat {key}',
  'Add or update a variable': 'Přidat nebo upravit proměnnou',
  'Variable key': 'Klíč proměnné',
  'Variable value': 'Hodnota proměnné',
  'Key must be UPPER_SNAKE_CASE (A–Z, 0–9, _).':
    'Klíč musí být ve tvaru UPPER_SNAKE_CASE (A–Z, 0–9, _).',
  'Secret<span>(encrypted, hidden)</span>': 'Tajemství<span>(šifrované, skryté)</span>',
  Save: 'Uložit',
  // components/organisms/infrastructure/InfrastructureTargetList.tsx
  'Deployment servers': 'Servery pro nasazení',
  'How infrastructure is organized': 'Jak je infrastruktura uspořádaná',
  'The machine or hosting endpoint that receives deployments.':
    'Stroj nebo hosting, na který se nasazuje.',
  'Workspace access': 'Přístup workspace',
  'The isolated namespace, allowed runtimes and quota for {workspaceName}.':
    'Izolovaný namespace, povolené runtimy a kvóta pro {workspaceName}.',
  Environment: 'Prostředí',
  'A project’s dev, test or prod application deployed through that access.':
    'Aplikace projektu ve stupni dev, test nebo prod nasazená přes tento přístup.',
  'No deployment servers': 'Žádné servery pro nasazení',
  'Connect a Docker server through InitPad Agent, or add compatible SFTP hosting for PHP and static sites.':
    'Připojte Docker server přes InitPad Agenta, nebo přidejte kompatibilní SFTP hosting pro PHP a statické weby.',
  'Add server': 'Přidat server',
  // components/organisms/infrastructure/TargetRow.tsx
  'Verified {date}': 'Ověřeno {date}',
  verified: 'ověřeno',
  'not verified': 'neověřeno',
  'InitPad Agent · workspace server': 'InitPad Agent · server workspace',
  'Docker · self-hosted direct': 'Docker · přímý self-hosted',
  'SFTP · self-hosted demo': 'SFTP · self-hosted demo',
  'SFTP · shared web hosting': 'SFTP · sdílený webhosting',
  'No workspace access': 'Bez přístupu workspace',
  'Server {state}': 'Server: {state}',
  'Access paused': 'Přístup pozastaven',
  'Running applications are unaffected. New jobs wait safely until the Agent reconnects.':
    'Běžících aplikací se to netýká. Nové úlohy bezpečně počkají, než se Agent znovu připojí.',
  'Disconnected from InitPad': 'Odpojeno od InitPadu',
  'Existing workloads stay online, but InitPad cannot deploy, stop, inspect or remove them.':
    'Stávající workloady zůstávají online, ale InitPad je nemůže nasazovat, zastavovat, kontrolovat ani odstraňovat.',
  'Retained as unmanaged': 'Ponecháno bez správy',
  'History and URLs remain visible. InitPad no longer manages this server.':
    'Historie a URL zůstávají viditelné. InitPad už tento server nespravuje.',
  'About workspace access': 'O přístupu workspace',
  '{workspaceName} receives a separate namespace on this server.':
    '{workspaceName} dostane na tomto serveru samostatný namespace.',
  Policy: 'Pravidla',
  'Allowed runtimes and the environment quota apply only to this workspace.':
    'Povolené runtimy a kvóta prostředí platí jen pro tento workspace.',
  'server {state}': 'server: {state}',
  paused: 'pozastaveno',
  enabled: 'povoleno',
  'Isolated namespace': 'Izolovaný namespace',
  'Environment usage': 'Využití prostředí',
  '{inUse} of {maxEnvironments}': '{inUse} z {maxEnvironments}',
  'Limits per environment': 'Limity na prostředí',
  'Public address': 'Veřejná adresa',
  'Automatic cleanup': 'Automatický úklid',
  'dev after {hours}h': 'dev po {hours} h',
  'test after {hours}h': 'test po {hours} h',
  'Access settings are preserved, but management remains unavailable until the server is reconnected.':
    'Nastavení přístupu zůstává zachované, ale správa není dostupná, dokud server znovu nepřipojíte.',
  'Edit access': 'Upravit přístup',
  'Reconnect the server before resuming access': 'Před obnovením přístupu znovu připojte server',
  'Resume access': 'Obnovit přístup',
  'Pause access': 'Pozastavit přístup',
  'Remove workspace access': 'Odebrat přístup workspace',
  'Remove access': 'Odebrat přístup',
  'Not enabled for this workspace': 'Pro tento workspace není povoleno',
  'Enable access before assigning environments to this server.':
    'Než k tomuto serveru přiřadíte prostředí, povolte přístup.',
  'Reconnect the server before enabling workspace access':
    'Před povolením přístupu workspace znovu připojte server',
  'Enable for {workspaceName}': 'Povolit pro {workspaceName}',
  'Server connection and settings': 'Připojení a nastavení serveru',
  Connection: 'Připojení',
  'Outbound InitPad Agent': 'Odchozí InitPad Agent',
  'Platform configuration': 'Konfigurace platformy',
  'Application address': 'Adresa aplikací',
  'Assigned during deployment': 'Přidělí se při nasazení',
  'Server supports': 'Server podporuje',
  'Manage Agent': 'Spravovat Agenta',
  'Test connection': 'Otestovat připojení',
  'Verify & reconnect': 'Ověřit a znovu připojit',
  Reconnect: 'Znovu připojit',
  Restore: 'Obnovit',
  'Restore or reconnect this server before editing it':
    'Před úpravou tento server obnovte nebo znovu připojte',
  'Edit server': 'Upravit server',
  'More actions for {name}': 'Další akce pro {name}',
  Disconnect: 'Odpojit',
  Retire: 'Vyřadit',
  'in use': 'používá se',
  // components/organisms/PipelinePresetField.tsx
  Pipeline: 'Pipeline',
  // components/organisms/PipelinePresetSettings.tsx
  'Removing {removed} is allowed only after its deployment and pending cleanup are gone. Deployment history for the removed stage is deleted with that environment; the audit event remains.':
    'Odebrat {removed} lze až poté, co zmizí jeho nasazení i čekající úklid. Historie nasazení odebraného stupně se smaže spolu s prostředím; auditní záznam zůstane.',
  'A maintainer, admin or owner can change the project pipeline.':
    'Pipeline projektu může změnit správce, administrátor nebo vlastník.',
  'Saving…': 'Ukládá se…',
  'Save pipeline': 'Uložit pipeline',
  // components/organisms/ProductionApprovalCard.tsx
  'Production promote request': 'Žádost o povýšení do produkce',
  'Production redeploy request': 'Žádost o opětovné nasazení produkce',
  'Production rollback request': 'Žádost o rollback produkce',
  'Production approval': 'Schválení produkce',
  'Requested by {requester} · {date}': 'Požádal(a) {requester} · {date}',
  'Approve and deploy': 'Schválit a nasadit',
  Reject: 'Zamítnout',
  'Cancel request': 'Zrušit žádost',
  Source: 'Zdroj',
  Target: 'Cíl',
  'Artifact digest': 'Digest artefaktu',
  'Not available for this legacy build': 'U tohoto staršího buildu není k dispozici',
  'Owners, admins and maintainers can review production requests.':
    'Žádosti o produkci mohou posuzovat vlastníci, administrátoři a správci.',
  'A different workspace owner, admin or maintainer must approve this request.':
    'Tuto žádost musí schválit jiný vlastník, administrátor nebo správce workspace.',
  'Reviewed by {reviewer} · {date}': 'Posoudil(a) {reviewer} · {date}',
  'Reviewed by {reviewer}': 'Posoudil(a) {reviewer}',
  'Deployment {status} · {phase}': 'Nasazení: {status} · {phase}',
  // components/organisms/ProjectHistory.tsx
  'Deployment activity': 'Aktivita nasazení',
  'Source build': 'Zdrojový build',
  'CI builds and tests one immutable artifact.': 'CI sestaví a otestuje jeden neměnný artefakt.',
  'Deploy and redeploy': 'Nasazení a opětovné nasazení',
  'Publish that verified artifact without starting another CI runner.':
    'Publikují tento ověřený artefakt, aniž by spouštěly další CI runner.',
  'Show all deployments': 'Zobrazit všechna nasazení',
  Commits: 'Commity',
  'Show all commits': 'Zobrazit všechny commity',
  // components/organisms/ProjectRepository.tsx
  Repository: 'Repozitář',
  'Private GitHub repository — open it in a browser signed into an authorized GitHub account. For cloning, use your normal GitHub credential manager, SSH key or <code>gh auth login</code>.':
    'Soukromý repozitář na GitHubu — otevřete ho v prohlížeči přihlášeném k oprávněnému účtu GitHub. Pro klonování použijte svého běžného správce přihlašovacích údajů GitHubu, SSH klíč nebo <code>gh auth login</code>.',
  'Private repository — first time? <link>Connect Git</link> once and cloning works without a password.':
    'Soukromý repozitář — jste tu poprvé? Stačí jednou <link>připojit Git</link> a klonování funguje bez hesla.',
  // components/organisms/ProjectSummary.tsx
  '{template} · created {date}': '{template} · vytvořeno {date}',
  'Open repository': 'Otevřít repozitář',
  'Open repo': 'Otevřít repozitář',
  'More actions': 'Další akce',
  'Setup ({kind}) failed at the {step} step': 'Zakládání ({kind}) selhalo v kroku {step}',
  'Setting up ({kind})…': 'Zakládá se ({kind})…',
  'No further detail was recorded.': 'Žádné další podrobnosti nebyly zaznamenány.',
  'Current step: {step}.': 'Aktuální krok: {step}.',
  'Repository access': 'Přístup k repozitáři',
  'cleanup required': 'vyžaduje úklid',
  // components/organisms/RollbackDialog.tsx
  'Request production rollback': 'Požádat o rollback produkce',
  'Roll back {environment}': 'Rollback prostředí {environment}',
  'Create a reviewable request for the previous verified version. Nothing is published until an authorized reviewer approves the unchanged request.':
    'Vytvoří se žádost o předchozí ověřenou verzi k posouzení. Nic se nepublikuje, dokud nezměněnou žádost neschválí oprávněný posuzovatel.',
  'Publish the previous verified version to the currently assigned target. InitPad will not run CI or build new application code.':
    'Na aktuálně přiřazený cíl se publikuje předchozí ověřená verze. InitPad nespustí CI ani nesestaví nový kód aplikace.',
  'Current version': 'Aktuální verze',
  'Rollback version': 'Verze pro rollback',
  'Verified output': 'Ověřený výstup',
  'OCI tag {rollbackVersion}': 'OCI tag {rollbackVersion}',
  'The selected target will replace its current workload with version <span>{rollbackVersion}</span>. Publication still has to pass the target health check. Stable-routing targets keep their URL and a managed gateway keeps the last healthy revision online until that succeeds; a direct-port target may allocate a new port. Current environment variables and secrets stay in place; rollback changes application code, not configuration.':
    'Vybraný cíl nahradí svůj současný workload verzí <span>{rollbackVersion}</span>. Publikace musí i tak projít kontrolou stavu na cíli. Cíle se stabilním routováním si ponechají URL a spravovaná brána drží poslední zdravou revizi online, dokud kontrola neuspěje; cíl s přímým portem může dostat nový port. Stávající proměnné prostředí a tajemství zůstávají; rollback mění kód aplikace, ne konfiguraci.',
  'Source deployment succeeded on {date}. Any target or environment or configuration change after this dialog opened will cancel the request for review.':
    'Zdrojové nasazení uspělo {date}. Jakákoli změna cíle, prostředí nebo konfigurace po otevření tohoto dialogu žádost o posouzení zruší.',
  'Submit rollback request': 'Odeslat žádost o rollback',
  // components/organisms/settings/EmailVerificationSettings.tsx
  'Verification e-mail queued': 'Ověřovací e-mail zařazen k odeslání',
  'Verification link created': 'Ověřovací odkaz vytvořen',
  'Verify your e-mail': 'Ověřte svůj e-mail',
  'Confirm <b>{email}</b> to secure account recovery. Configured instances deliver the link by e-mail; otherwise it is shown here once.':
    'Potvrďte <b>{email}</b>, ať je obnova účtu zabezpečená. Nakonfigurované instance pošlou odkaz e-mailem; jinak se zobrazí jednorázově zde.',
  'Check your inbox. The single-use verification link has been queued for delivery.':
    'Podívejte se do schránky. Jednorázový ověřovací odkaz byl zařazen k odeslání.',
  'Send verification link': 'Odeslat ověřovací odkaz',
  'Open this link to verify (shown once)':
    'Pro ověření otevřete tento odkaz (zobrazí se jen jednou)',
  // components/organisms/settings/GitAccessSettings.tsx
  'Connect Git': 'Připojit Git',
  'Clone, pull and push from this machine without a password prompt.':
    'Klonujte, stahujte a pushujte z tohoto počítače bez zadávání hesla.',
  'Link this machine to the platform Git server once.':
    'Tento počítač jednorázově propojíte s Git serverem platformy.',
  Authentication: 'Ověřování',
  'Future clone, pull and push commands work without a password prompt.':
    'Další příkazy clone, pull a push fungují bez výzvy k heslu.',
  'Loading…': 'Načítání…',
  'Show setup command': 'Zobrazit příkaz pro nastavení',
  '1. Run this once in your terminal': '1. Spusťte jednou v terminálu',
  '2. Clone any project with the plain URL shown on its page':
    '2. Naklonujte libovolný projekt přes běžnou URL uvedenou na jeho stránce',
  'The command embeds your personal Gitea token in <code>~/.gitconfig</code>. Keep it private; you can revoke it anytime in <link>Gitea → Settings → Applications {icon}</link>.':
    'Příkaz uloží váš osobní token Gitey do <code>~/.gitconfig</code>. Uchovejte ho v tajnosti; kdykoli ho můžete zneplatnit v <link>Gitea → Settings → Applications {icon}</link>.',
  'No personal access token is available. Generate one in Gitea with repository scope and use it as the password when cloning.':
    'Osobní přístupový token není k dispozici. Vygenerujte si ho v Gitee s oprávněním k repozitářům a při klonování ho použijte jako heslo.',
  'Open Gitea token settings': 'Otevřít nastavení tokenů v Gitee',
  // components/organisms/settings/GitHubIntegrationSettings.tsx
  'Opening GitHub…': 'Otevírá se GitHub…',
  'GitHub account linked': 'Účet GitHub propojen',
  'GitHub App authorized for {account}': 'GitHub App autorizována pro {account}',
  'GitHub App authorized': 'GitHub App autorizována',
  'GitHub organization owner has been asked to approve the App':
    'Vlastník organizace na GitHubu byl požádán o schválení aplikace',
  'Could not authorize GitHub installation': 'Instalaci na GitHubu se nepodařilo autorizovat',
  'Could not link GitHub account': 'Účet GitHub se nepodařilo propojit',
  'Allow pop-ups for InitPad to connect GitHub':
    'Pro připojení GitHubu povolte InitPadu vyskakovací okna',
  'Allow pop-ups for InitPad to install the GitHub App':
    'Pro instalaci GitHub App povolte InitPadu vyskakovací okna',
  'Unlink {account}?': 'Odpojit {account}?',
  'This removes the GitHub identity from your InitPad account.':
    'Identita GitHubu se odebere z vašeho účtu InitPad.',
  'Unlink GitHub': 'Odpojit GitHub',
  'GitHub sign-in through this identity stops working.':
    'Přihlášení přes GitHub touto identitou přestane fungovat.',
  'Existing projects and GitHub App installations are not deleted.':
    'Stávající projekty ani instalace GitHub App se nesmažou.',
  'GitHub account unlinked': 'Účet GitHub odpojen',
  'GitHub account': 'Účet GitHub',
  'Sign in with GitHub and let InitPad create or import selected repositories.':
    'Přihlašujte se přes GitHub a nechte InitPad vytvářet nebo importovat vybrané repozitáře.',
  Account: 'Účet',
  'Links your GitHub identity as a sign-in method.':
    'Propojí vaši identitu na GitHubu jako způsob přihlášení.',
  'GitHub App': 'GitHub App',
  'Gives InitPad access to create or import selected repositories.':
    'Dává InitPadu přístup k vytváření nebo importu vybraných repozitářů.',
  Permissions: 'Oprávnění',
  'Job retry needs Actions read and write. No organization or account permission is required.':
    'Opakování úloh vyžaduje čtení a zápis pro Actions. Žádné oprávnění k organizaci ani účtu není potřeba.',
  'Link GitHub account': 'Propojit účet GitHub',
  'App authorized': 'Aplikace autorizována',
  'linked {date}': 'propojeno {date}',
  'App installation suspended': 'Instalace aplikace pozastavena',
  'App installed': 'Aplikace nainstalována',
  'App not installed': 'Aplikace není nainstalována',
  'Add installation': 'Přidat instalaci',
  'Install GitHub App': 'Nainstalovat GitHub App',
  'Renew authorization': 'Obnovit autorizaci',
  'This is your only sign-in method': 'Je to váš jediný způsob přihlášení',
  Unlink: 'Odpojit',
  'Required for sign-in': 'Nutné pro přihlášení',
  'all repositories': 'všechny repozitáře',
  'selected repositories': 'vybrané repozitáře',
  suspended: 'pozastaveno',
  'authorized for {workspace}': 'autorizováno pro {workspace}',
  'this workspace': 'tento workspace',
  'GitHub sign-in is available, but repository access has not been configured by the platform administrator.':
    'Přihlášení přes GitHub je dostupné, ale přístup k repozitářům správce platformy zatím nenastavil.',
  'GitHub delivery is paused': 'Doručování z GitHubu je pozastavené',
  '{issue} The platform administrator must configure a public HTTPS <code>INITPAD_PUBLIC_URL</code>. Current value: <value>{url}</value>.':
    '{issue} Správce platformy musí nastavit veřejnou HTTPS adresu <code>INITPAD_PUBLIC_URL</code>. Současná hodnota: <value>{url}</value>.',
  'not set': 'nenastaveno',
  // components/organisms/settings/WorkspaceAdministrationSettings.tsx
  'Workspace renamed': 'Workspace přejmenován',
  'Delete workspace {workspaceName}?': 'Smazat workspace {workspaceName}?',
  'A team workspace is the tenant boundary for its members, resources and audit timeline.':
    'Týmový workspace je hranice, která odděluje jeho členy, zdroje a auditní historii.',
  'Delete workspace': 'Smazat workspace',
  'Membership and the workspace audit timeline are permanently removed.':
    'Členství a auditní historie workspace se trvale odstraní.',
  'Deletion succeeds only after all projects, targets and allocations have been removed.':
    'Smazání uspěje až po odebrání všech projektů, cílů a přidělení.',
  'The workspace name and slug can then be reused.': 'Název a slug workspace pak lze použít znovu.',
  'Workspace deleted': 'Workspace smazán',
  'Allow production self-approval?': 'Povolit schvalování vlastních žádostí o produkci?',
  'A requester who is an owner, admin or maintainer will be able to approve their own production request.':
    'Žadatel, který je vlastníkem, administrátorem nebo správcem, bude moci schválit svou vlastní žádost o produkci.',
  'Allow self-approval': 'Povolit vlastní schválení',
  'Every production deployment still requires a separate request and approval action.':
    'Každé produkční nasazení i nadále vyžaduje samostatnou žádost a schválení.',
  'The two-person review requirement will no longer be enforced for this workspace.':
    'Požadavek na posouzení druhou osobou se pro tento workspace přestane vynucovat.',
  'Production approval policy updated': 'Pravidla schvalování produkce byla upravena',
  'Current team workspace': 'Aktuální týmový workspace',
  Rename: 'Přejmenovat',
  'Changes the workspace display name.': 'Změní zobrazovaný název workspace.',
  Delete: 'Smazat',
  'Available only after its projects and servers have been removed.':
    'Dostupné až po odebrání jeho projektů a serverů.',
  'Current workspace name': 'Název aktuálního workspace',
  'Require a different reviewer': 'Vyžadovat jiného posuzovatele',
  'Update policy': 'Upravit pravidla',
  'Who may approve a production deployment request in this workspace.':
    'Kdo smí v tomto workspace schválit žádost o produkční nasazení.',
  'Only the workspace owner can change this policy.':
    'Tato pravidla může změnit jen vlastník workspace.',
  'Delete this workspace': 'Smazat tento workspace',
  'Possible only after its projects and servers have been removed.':
    'Možné až po odebrání jeho projektů a serverů.',
  'Delete empty workspace': 'Smazat prázdný workspace',
  // components/organisms/settings/WorkspaceCapacitySettings.tsx
  'Artifact storage': 'Úložiště artefaktů',
  'Workspace capacity': 'Kapacita workspace',
  'Control-plane limits': 'Limity řídicí roviny',
  'Projects, members, servers and simultaneous provisioning or deployment operations share this workspace policy.':
    'Projekty, členové, servery a souběžné operace zakládání či nasazení sdílejí tato pravidla workspace.',
  'Server limits': 'Limity serverů',
  'CPU, memory, process and environment limits remain specific to each server access.':
    'Limity CPU, paměti, procesů a prostředí zůstávají specifické pro každý přístup k serveru.',
  'Loading workspace capacity': 'Načítání kapacity workspace',
  'Platform administrators manage these limits. Reaching one blocks only new work; existing projects and workloads are preserved.':
    'Tyto limity spravují administrátoři platformy. Dosažení limitu blokuje jen novou práci; stávající projekty a workloady zůstávají zachované.',
  // components/organisms/settings/WorkspaceMembersSettings.tsx
  Member: 'Člen',
  Maintainer: 'Správce',
  Viewer: 'Čtenář',
  Admin: 'Administrátor',
  'Add {identity} as workspace admin?': 'Přidat {identity} jako administrátora workspace?',
  'Administrators can manage members and infrastructure in {name}.':
    'Administrátoři mohou ve workspace {name} spravovat členy a infrastrukturu.',
  'Add workspace admin': 'Přidat administrátora workspace',
  'This account receives elevated workspace permissions immediately.':
    'Tento účet okamžitě získá rozšířená oprávnění ve workspace.',
  'The workspace owner can later change or remove the role.':
    'Vlastník workspace může roli později změnit nebo odebrat.',
  'Workspace member added': 'Člen workspace přidán',
  "Change @{username}'s role?": 'Změnit roli uživatele @{username}?',
  'Workspace role changes take effect immediately across projects and infrastructure.':
    'Změny rolí ve workspace se okamžitě projeví ve všech projektech a infrastruktuře.',
  'Change role to {role}': 'Změnit roli na: {role}',
  'Current role': 'Současná role',
  'New role': 'Nová role',
  'The member gains permission to manage workspace membership and infrastructure.':
    'Člen získá oprávnění spravovat členství a infrastrukturu workspace.',
  'The member can maintain deployments and review production requests without workspace administration rights.':
    'Člen může spravovat nasazení a posuzovat žádosti o produkci bez práv k administraci workspace.',
  'The member may immediately lose access to actions allowed by the current role.':
    'Člen může okamžitě ztratit přístup k akcím, které povolovala současná role.',
  'Private repository access is reconciled to the new role.':
    'Přístup k soukromým repozitářům se sladí s novou rolí.',
  'Updated @{username}': 'Uživatel @{username} upraven',
  'Remove @{username} from {name}?': 'Odebrat @{username} z {name}?',
  'The user account remains active, but its access to this team workspace is revoked.':
    'Uživatelský účet zůstane aktivní, ale jeho přístup k tomuto týmovému workspace se zruší.',
  'Remove member': 'Odebrat člena',
  'Workspace projects, infrastructure and audit events are no longer visible to this member.':
    'Projekty, infrastruktura a auditní události workspace už pro tohoto člena nebudou viditelné.',
  'Private repository access is removed during reconciliation.':
    'Přístup k soukromým repozitářům se odebere při slaďování.',
  'Removed @{username}': 'Uživatel @{username} odebrán',
  'Workspace members': 'Členové workspace',
  "People who can see and work on this workspace's projects.":
    'Lidé, kteří vidí projekty tohoto workspace a mohou na nich pracovat.',
  'Username or e-mail': 'Uživatelské jméno nebo e-mail',
  'New member username or e-mail': 'Uživatelské jméno nebo e-mail nového člena',
  'New member role': 'Role nového člena',
  'Add member': 'Přidat člena',
  'Maintainers can manage deployments, rollbacks and production reviews without managing workspace membership or policy.':
    'Správci mohou řídit nasazení, rollbacky a posuzování produkce, aniž by spravovali členství nebo pravidla workspace.',
  'Personal workspaces stay private. Use “Add new workspace” in the workspace switcher to create a shared team space.':
    'Osobní workspace zůstává soukromý. Sdílený týmový prostor vytvoříte volbou „Přidat nový workspace“ v přepínači workspace.',
  'Loading members…': 'Načítání členů…',
  'No workspace members found.': 'Žádní členové workspace nenalezeni.',
  'Role for {username}': 'Role uživatele {username}',
  'Remove {username}': 'Odebrat {username}',
  // components/organisms/Sidebar.tsx
  Overview: 'Přehled',
  Deployments: 'Nasazení',
  'Project templates': 'Šablony projektů',
  'Development activity': 'Vývojová aktivita',
  'Audit log': 'Auditní log',
  Workspace: 'Workspace',
  'InitPad overview': 'Přehled InitPadu',
  beta: 'beta',
  'Workspace: {name}': 'Workspace: {name}',
  none: 'žádný',
  loading: 'načítání',
  'Switch workspace': 'Přepnout workspace',
  Manage: 'Správa',
  Platform: 'Platforma',
  'Signed in as @{username}': 'Přihlášen(a) jako @{username}',
  'Account settings': 'Nastavení účtu',
  'Sign out': 'Odhlásit se',
  'Open navigation': 'Otevřít navigaci',
  Navigation: 'Navigace',
  // components/organisms/TargetDialog.tsx
  'Enter a valid server host and port first': 'Nejdřív zadejte platný host a port serveru',
  'The server address changed during host-key inspection. Try again.':
    'Adresa serveru se během kontroly klíče hostitele změnila. Zkuste to znovu.',
  'The server identity matches the trusted fingerprint':
    'Identita serveru odpovídá důvěryhodnému otisku',
  'The server identity has changed': 'Identita serveru se změnila',
  'Trust this server identity?': 'Důvěřovat identitě tohoto serveru?',
  'A changed SSH host key can mean that the server was reinstalled, its key was rotated, or the connection is being intercepted.':
    'Změněný SSH klíč hostitele může znamenat, že byl server přeinstalován, jeho klíč byl vyměněn, nebo že někdo spojení odposlouchává.',
  'Compare this fingerprint with the value provided by the server administrator before trusting it.':
    'Než mu začnete důvěřovat, porovnejte tento otisk s hodnotou od správce serveru.',
  'Replace trusted key': 'Nahradit důvěryhodný klíč',
  'Trust and save': 'Důvěřovat a uložit',
  'Key type': 'Typ klíče',
  'Previously trusted': 'Dříve důvěryhodný',
  'New fingerprint': 'Nový otisk',
  Fingerprint: 'Otisk',
  'InitPad will pin this exact key for every future SFTP connection.':
    'InitPad bude přesně tento klíč vyžadovat při každém dalším SFTP připojení.',
  'A different key will stop the connection before any credential is sent.':
    'Jiný klíč spojení ukončí dřív, než se odešlou jakékoli přihlašovací údaje.',
  'Add deployment server': 'Přidat server pro nasazení',
  'Recommended for application workloads. The server connects outbound through InitPad Agent; no inbound SSH credential is stored.':
    'Doporučeno pro aplikační workloady. Server se připojuje odchozím spojením přes InitPad Agenta; žádné příchozí SSH údaje se neukládají.',
  'Compatibility option for shared PHP or static hosting. Connection credentials are encrypted at rest.':
    'Varianta pro kompatibilitu se sdíleným PHP nebo statickým hostingem. Přihlašovací údaje se ukládají šifrovaně.',
  'A new credential is required': 'Jsou potřeba nové přihlašovací údaje',
  'The previous credential was permanently removed. Save a replacement, then run Test connection to resume InitPad management.':
    'Předchozí údaje byly trvale odstraněny. Uložte náhradní a pak spusťte Otestovat připojení, aby se správa přes InitPad obnovila.',
  Name: 'Název',
  'ESO school server': 'Školní server ESO',
  'Connection method': 'Způsob připojení',
  'InitPad Agent for Docker (recommended)': 'InitPad Agent pro Docker (doporučeno)',
  'SFTP shared web hosting': 'Sdílený webhosting přes SFTP',
  Port: 'Port',
  'Application exposure': 'Zpřístupnění aplikací',
  'Direct ports (local / lab)': 'Přímé porty (lokálně / laboratoř)',
  'Managed gateway (production)': 'Spravovaná brána (produkce)',
  'About supported runtimes': 'O podporovaných runtimech',
  'Static sites need SFTP only. PHP enables Nette, Laravel and Symfony and also requires shell access through the same account for isolated, removable releases.':
    'Statickým webům stačí SFTP. PHP umožňuje Nette, Laravel a Symfony a navíc vyžaduje shellový přístup pod stejným účtem kvůli izolovaným, odstranitelným vydáním.',
  'The Agent confirms Docker support after enrollment. Deployment stays disabled until the delivery path is ready.':
    'Agent po registraci potvrdí podporu Dockeru. Nasazení zůstane vypnuté, dokud nebude připravená cesta doručení.',
  'Choose only runtimes installed on this server. Test connection reports the detected command-line runtimes.':
    'Vyberte jen runtimy, které jsou na serveru nainstalované. Otestovat připojení vypíše runtimy zjištěné v příkazové řádce.',
  'Can run': 'Umí spustit',
  Host: 'Host',
  Username: 'Uživatelské jméno',
  Auth: 'Ověření',
  Password: 'Heslo',
  'SSH key': 'SSH klíč',
  'Private key (PEM)': 'Soukromý klíč (PEM)',
  'Paste the replacement OpenSSH private key': 'Vložte náhradní soukromý klíč OpenSSH',
  'Leave blank to keep the existing key': 'Nechte prázdné, pokud má zůstat stávající klíč',
  'Paste an OpenSSH private key': 'Vložte soukromý klíč OpenSSH',
  'Enter a new password': 'Zadejte nové heslo',
  'Leave blank to keep the existing password': 'Nechte prázdné, pokud má zůstat stávající heslo',
  'Host key fingerprint': 'Otisk klíče hostitele',
  'How to verify the server identity': 'Jak ověřit identitu serveru',
  '<b>Trusted source:</b> compare the value with the server administrator.':
    '<b>Důvěryhodný zdroj:</b> porovnejte hodnotu se správcem serveru.',
  'Inspect:': 'Zjištění otisku:',
  'Do not trust the first scan alone on an untrusted network.':
    'Na nedůvěryhodné síti nespoléhejte jen na první sken.',
  'Not trusted yet': 'Zatím nedůvěryhodný',
  'Check identity': 'Zkontrolovat identitu',
  'Get fingerprint': 'Získat otisk',
  'InitPad retrieves the public key without sending the password or private key. You must confirm it before the connection is saved.':
    'InitPad načte veřejný klíč, aniž by odeslal heslo nebo soukromý klíč. Před uložením připojení ho musíte potvrdit.',
  'Remote path': 'Vzdálená cesta',
  'Gateway base URL': 'Základní URL brány',
  'Application base URL': 'Základní URL aplikací',
  'Public URL': 'Veřejná URL',
  'About the application address': 'O adrese aplikací',
  'Use an HTTPS DNS origin for stable application hostnames. Run gateway preflight before the first deployment.':
    'Pro stabilní adresy aplikací použijte HTTPS origin s DNS. Před prvním nasazením spusťte předběžnou kontrolu brány.',
  'Use the browser-reachable address of this server. Each local or lab application receives its own published port.':
    'Použijte adresu tohoto serveru dostupnou z prohlížeče. Každá lokální nebo laboratorní aplikace dostane vlastní publikovaný port.',
  'Save connection': 'Uložit připojení',
  'Save server': 'Uložit server',
  // components/organisms/TargetPickerDialog.tsx
  'Deployment target ({env})': 'Cíl nasazení ({env})',
  'Choose where <b>{env}</b> deploys. Changing it on a live environment tears down the old deployment first.':
    'Zvolte, kam se nasazuje <b>{env}</b>. Změna u běžícího prostředí nejdřív zruší staré nasazení.',
  'No supported and verified replacement target yet. Add or test a server in <link>Servers</link>.':
    'Zatím není k dispozici žádný podporovaný a ověřený náhradní cíl. Přidejte nebo otestujte server v sekci <link>Servery</link>.',
  'built-in': 'vestavěný',
  Verified: 'Ověřeno',
  current: 'současný',
  'Agent not ready': 'Agent není připraven',
  'runs {runtimes}': 'spouští {runtimes}',
  'Confirm target change': 'Potvrďte změnu cíle',
  '{name} will be replaced by {name2}. A live deployment is removed from the old target and must be deployed to the new one.':
    '{name} bude nahrazen cílem {name2}. Běžící nasazení se ze starého cíle odstraní a je nutné ho nasadit na nový.',
  '{name} will become the deployment target for this environment.':
    '{name} se stane cílem nasazení pro toto prostředí.',
  'Manage servers': 'Spravovat servery',
  'Use target': 'Použít cíl',
  // components/organisms/WorkloadDiagnosticsDialog.tsx
  healthy: 'v pořádku',
  unhealthy: 'není v pořádku',
  'not running': 'neběží',
  missing: 'chybí',
  'Workload diagnostics — {environment}': 'Diagnostika workloadu — {environment}',
  'A read-only snapshot from {target}. It does not deploy, restart or execute a shell command in the workload.':
    'Snímek pouze pro čtení z cíle {target}. Nic nenasazuje, nerestartuje ani ve workloadu nespouští shellový příkaz.',
  'the Agent target': 'cíl Agenta',
  'Loading diagnostics': 'Načítání diagnostiky',
  'This request is safely queued and will continue when the Agent reconnects.':
    'Tento požadavek bezpečně čeká ve frontě a bude pokračovat, až se Agent znovu připojí.',
  'The last successful snapshot remains available, but it may no longer describe the current workload.':
    'Poslední úspěšný snímek je stále k dispozici, ale nemusí už odpovídat současnému workloadu.',
  'Diagnostic request': 'Diagnostický požadavek',
  'Not requested yet': 'Zatím nevyžádáno',
  'Waiting for Agent': 'Čeká se na Agenta',
  'Workload diagnostics progress': 'Průběh diagnostiky workloadu',
  'Last successful snapshot': 'Poslední úspěšný snímek',
  'Observed {date}': 'Zjištěno {date}',
  Runtime: 'Běh',
  Health: 'Stav',
  unknown: 'neznámý',
  'Exit code': 'Návratový kód',
  Revision: 'Revize',
  'Application output': 'Výstup aplikace',
  'last 200 lines · max 32 KiB': 'posledních 200 řádků · max. 32 KiB',
  'No output was captured in the bounded window.': 'V omezeném okně nebyl zachycen žádný výstup.',
  'No diagnostic snapshot yet': 'Zatím žádný diagnostický snímek',
  'Run diagnostics to read container state, health, exit code and bounded recent output.':
    'Spusťte diagnostiku a zjistěte stav kontejneru, jeho zdraví, návratový kód a omezený poslední výstup.',
  'Application output can contain sensitive business data. Access is limited to project members who can change the project, and each refresh replaces the previous stored output.':
    'Výstup aplikace může obsahovat citlivá obchodní data. Přístup mají jen členové, kteří mohou projekt měnit, a každé obnovení nahradí předchozí uložený výstup.',
  Close: 'Zavřít',
  'Diagnostics running': 'Diagnostika běží',
  'Refresh diagnostics': 'Obnovit diagnostiku',
  'Run diagnostics': 'Spustit diagnostiku',
  // components/organisms/WorkspaceMetricsDialog.tsx
  '{format} metrics downloaded': 'Metriky ve formátu {format} staženy',
  'Export workspace metrics': 'Export metrik workspace',
  'Deployment counts and durations only. Logs, secrets and account data are excluded.':
    'Pouze počty a doby trvání nasazení. Logy, tajemství ani data účtů se neexportují.',
  From: 'Od',
  Through: 'Do',
  'End date must not be before start date.': 'Koncové datum nesmí být před počátečním.',
  // confirmation.tsx
  'What will happen': 'Co se stane',
  'Type <b>{requireText}</b> to confirm:': 'Pro potvrzení napište <b>{requireText}</b>:',
  // hooks/useAgentProtocol.ts
  'Durable Agent protocol probe queued': 'Test trvalého protokolu Agenta zařazen do fronty',
  'Docker lifecycle test queued': 'Test životního cyklu Dockeru zařazen do fronty',
  'Gateway preflight queued': 'Předběžná kontrola brány zařazena do fronty',
  'Verified Agent update queued': 'Ověřená aktualizace Agenta zařazena do fronty',
  // hooks/useInfrastructure.ts
  'Server saved': 'Server uložen',
  'Server added with workspace access': 'Server přidán včetně přístupu workspace',
  'One-time Agent enrollment created': 'Jednorázová registrace Agenta vytvořena',
  'Agent disconnected; running workloads were left untouched':
    'Agent odpojen; běžící workloady zůstaly nedotčené',
  '{name} disconnected; running workloads were left untouched':
    '{name} odpojen; běžící workloady zůstaly nedotčené',
  '{name} is now retained as unmanaged infrastructure':
    '{name} je nyní veden jako nespravovaná infrastruktura',
  '{name} restored; reconnect its credentials to resume management':
    '{name} obnoven; pro obnovení správy znovu připojte jeho přihlašovací údaje',
  'Removed server {name}': 'Server {name} odebrán',
  'Workspace access saved': 'Přístup workspace uložen',
  'Workspace access enabled': 'Přístup workspace povolen',
  'Workspace access paused': 'Přístup workspace pozastaven',
  'Workspace access resumed': 'Přístup workspace obnoven',
  'Removed workspace access to {targetName}': 'Přístup workspace k {targetName} odebrán',
  // hooks/useProjectDetail.ts
  'Deploying to {target}…': 'Nasazuje se na {target}…',
  'Deploying the verified build to {environment} through InitPad — no new GitHub runner is required.':
    'Ověřený build se nasazuje do {environment} přes InitPad — nový runner na GitHubu není potřeba.',
  'Redeploying {environment}': 'Opětovné nasazení {environment}',
  'No previous verified {environment} deployment is available to roll back.':
    'Pro {environment} není k dispozici žádné předchozí ověřené nasazení, na které by šlo přejít zpět.',
  'Production rollback requested': 'O rollback produkce bylo požádáno',
  'Rolling back {environment} to {rollbackVersion} without a new CI build.':
    'Rollback {environment} na {rollbackVersion} bez nového buildu v CI.',
  'Production deployment requested': 'O nasazení do produkce bylo požádáno',
  'Production redeploy requested': 'O opětovné nasazení produkce bylo požádáno',
  'Production deployment approved and queued':
    'Nasazení do produkce schváleno a zařazeno do fronty',
  'Production request rejected': 'Žádost o produkci zamítnuta',
  'Production request cancelled': 'Žádost o produkci zrušena',
  'Preparing dev deployment through InitPad. An existing verified build is reused when available.':
    'Připravuje se nasazení do dev přes InitPad. Pokud existuje ověřený build, použije se znovu.',
  'Preparing dev deployment…': 'Připravuje se nasazení do dev…',
  'GitHub is re-running failed jobs from run {runId}.':
    'GitHub znovu spouští neúspěšné úlohy z běhu {runId}.',
  'Removed {environment} deployment': 'Nasazení {environment} odstraněno',
  'Updated {environment} target': 'Cíl pro {environment} upraven',
  'Pipeline updated': 'Pipeline upravena',
  'Deleted {name}': '{name} smazán',
  // i18n/index.ts
  'just now': 'právě teď',
  '{count}m ago': 'před {count} min',
  '{count}h ago': 'před {count} h',
  '{count}d ago': 'před {count} d',
  // lib/deployment.ts
  'Public deployment removed; its URL path and project name are free for reuse. {detail}':
    'Veřejné nasazení bylo odstraněno; jeho URL cesta i název projektu jsou volné k dalšímu použití. {detail}',
  // lib/pipeline-presets.ts
  'Development, test, production': 'Vývoj, test, produkce',
  'CI deploys to dev; promote the same verified build through test to production.':
    'CI nasazuje do dev; stejný ověřený build se povyšuje přes test do produkce.',
  'Development, production': 'Vývoj, produkce',
  'CI deploys to dev; request the verified dev build for production.':
    'CI nasazuje do dev; o nasazení ověřeného buildu z dev do produkce se žádá.',
  'Production only': 'Pouze produkce',
  'CI verifies a build without deploying it; production always requires approval.':
    'CI build ověří, ale nenasadí; produkce vždy vyžaduje schválení.',
  // pages/AccountSettings.tsx
  'Sign-in methods and Git access for your own account.':
    'Způsoby přihlášení a přístup ke Gitu pro váš účet.',
  // pages/Activate.tsx
  'Passwords do not match.': 'Hesla se neshodují.',
  'Activate your account': 'Aktivujte svůj účet',
  'Choose a password to finish setting up your InitPad account.':
    'Zvolte heslo a dokončete nastavení účtu InitPad.',
  'Use at least 12 characters.': 'Použijte alespoň 12 znaků.',
  'Confirm password': 'Potvrzení hesla',
  'Please wait…': 'Čekejte prosím…',
  'Activate and sign in': 'Aktivovat a přihlásit se',
  'Back to sign in': 'Zpět na přihlášení',
  // pages/Activity.tsx
  'Recent commits and their pipeline runs across this workspace.':
    'Poslední commity a jejich běhy pipeline napříč tímto workspace.',
  'Loading activity': 'Načítání aktivity',
  'No activity yet': 'Zatím žádná aktivita',
  'Commits and CI runs across your projects will show up here.':
    'Zobrazí se tu commity a běhy CI ze všech vašich projektů.',
  // pages/Admin.tsx
  'Deployed applications can read sessions': 'Nasazené aplikace mohou číst relace',
  'Applications on the built-in Docker server use this InitPad host name over HTTP, so browsers send them the InitPad session of anyone who opens them. Serve InitPad over HTTPS (server profile) or set INITPAD_DEPLOY_PUBLIC_HOST to a different host name before other people deploy here.':
    'Aplikace na vestavěném Docker serveru používají přes HTTP stejný název hostu jako InitPad, takže jim prohlížeč posílá relaci InitPadu každého, kdo je otevře. Než sem začnou nasazovat další lidé, provozujte InitPad přes HTTPS (serverový profil) nebo nastavte INITPAD_DEPLOY_PUBLIC_HOST na jiný název hostu.',
  'Create @{username} as platform administrator?':
    'Vytvořit @{username} jako administrátora platformy?',
  'Platform administrators manage every account in this self-hosted InitPad instance.':
    'Administrátoři platformy spravují všechny účty v této self-hosted instanci InitPadu.',
  'Create administrator': 'Vytvořit administrátora',
  'The new account receives instance-wide user administration permissions.':
    'Nový účet získá oprávnění ke správě uživatelů v celé instanci.',
  'A temporary password is shown once; activation uses e-mail when configured.':
    'Dočasné heslo se zobrazí jen jednou; aktivace využije e-mail, pokud je nastavený.',
  'Created @{username}': 'Uživatel @{username} vytvořen',
  'Deactivate @{username}?': 'Deaktivovat @{username}?',
  'The account will be blocked at both InitPad and its private Gitea SCM.':
    'Účet bude zablokován v InitPadu i v jeho soukromé Gitee.',
  'Deactivate account': 'Deaktivovat účet',
  'All current InitPad sessions are revoked immediately.':
    'Všechna současná přihlášení do InitPadu se okamžitě zruší.',
  'The user cannot sign in or access private repositories until reactivated.':
    'Dokud nebude účet znovu aktivován, uživatel se nepřihlásí ani nezíská přístup k soukromým repozitářům.',
  'Projects, memberships and audit history are preserved.':
    'Projekty, členství a auditní historie zůstávají zachované.',
  'Activated @{username}': 'Uživatel @{username} aktivován',
  'Deactivated @{username}': 'Uživatel @{username} deaktivován',
  "Reset @{username}'s password?": 'Resetovat heslo uživatele @{username}?',
  'A random temporary password will replace the current password.':
    'Současné heslo nahradí náhodné dočasné heslo.',
  'Reset password': 'Resetovat heslo',
  'Every current session for this account is revoked.':
    'Všechna současná přihlášení tohoto účtu se zruší.',
  'The user must change the one-time password at their next sign-in.':
    'Uživatel musí jednorázové heslo při dalším přihlášení změnit.',
  'The temporary password is shown only once.': 'Dočasné heslo se zobrazí jen jednou.',
  'Reset password for @{username}': 'Heslo uživatele @{username} resetováno',
  'Create a new activation link for @{username}?': 'Vytvořit nový aktivační odkaz pro @{username}?',
  'Activation links are single-use credentials that let the user choose a password.':
    'Aktivační odkazy jsou jednorázové přihlašovací údaje, kterými si uživatel zvolí heslo.',
  'Create new link': 'Vytvořit nový odkaz',
  'Any earlier unused activation link for this account becomes invalid.':
    'Dřívější nepoužitý aktivační odkaz tohoto účtu přestane platit.',
  'The new link is e-mailed when delivery is configured; otherwise it is shown once.':
    'Nový odkaz se pošle e-mailem, pokud je doručování nastavené; jinak se zobrazí jednorázově.',
  'Activation e-mail queued for @{username}': 'Aktivační e-mail pro @{username} zařazen k odeslání',
  'Activation link created for @{username}': 'Aktivační odkaz pro @{username} vytvořen',
  'Install InitPad {latestVersion}?': 'Nainstalovat InitPad {latestVersion}?',
  'This signed prerelease is available only because this instance uses the candidate channel. Install it only for acceptance testing.':
    'Toto podepsané předběžné vydání je dostupné jen proto, že instance používá kandidátní kanál. Instalujte ho pouze pro akceptační testy.',
  'The signed release will be installed by the local Supervisor after a verified database backup.':
    'Podepsané vydání nainstaluje místní Supervisor po ověřené záloze databáze.',
  'This version has not completed the live stable-release acceptance gate.':
    'Tato verze ještě neprošla akceptační bránou pro stabilní vydání.',
  'The API and web UI will restart briefly; this page may be unavailable for a moment.':
    'API a webové rozhraní se krátce restartují; tato stránka může být chvíli nedostupná.',
  'Running project workloads are not restarted.': 'Běžící workloady projektů se nerestartují.',
  'If readiness fails, the previous platform images are restored automatically.':
    'Pokud kontrola připravenosti selže, automaticky se obnoví předchozí image platformy.',
  'Only expand-contract, image-compatible database releases are accepted automatically.':
    'Automaticky se přijímají jen vydání s databázovými změnami typu expand-contract kompatibilními s image.',
  'InitPad {latestVersion} update started': 'Aktualizace na InitPad {latestVersion} zahájena',
  'Platform administration': 'Administrace platformy',
  'Instance-wide settings. Only platform administrators can open this page.':
    'Nastavení celé instance. Tuto stránku mohou otevřít jen administrátoři platformy.',
  'Onboarding for @{username}': 'Zprovoznění účtu @{username}',
  'The activation e-mail is queued. Any temporary password below is shown once.':
    'Aktivační e-mail je zařazen k odeslání. Případné dočasné heslo níže se zobrazí jen jednou.',
  'Share securely. Credentials shown here cannot be retrieved again.':
    'Sdílejte bezpečně. Zde zobrazené údaje už nepůjde získat znovu.',
  'Activation link <span>— the user sets their own password</span>':
    'Aktivační odkaz <span>— uživatel si nastaví vlastní heslo</span>',
  'Activation link queued for delivery to the account e-mail address.':
    'Aktivační odkaz je zařazen k odeslání na e-mail účtu.',
  'Temporary password <span>— must be changed at first sign-in</span>':
    'Dočasné heslo <span>— při prvním přihlášení se musí změnit</span>',
  Done: 'Hotovo',
  Users: 'Uživatelé',
  'Accounts on this instance. New users receive a one-time password and must set their own before using the platform.':
    'Účty v této instanci. Noví uživatelé dostanou jednorázové heslo a před používáním platformy si musí nastavit vlastní.',
  'Add user': 'Přidat uživatele',
  'Provision a user': 'Založení uživatele',
  'E-mail': 'E-mail',
  'Full name': 'Celé jméno',
  Optional: 'Nepovinné',
  'Platform role': 'Role v platformě',
  User: 'Uživatel',
  Administrator: 'Administrátor',
  'Create user': 'Vytvořit uživatele',
  'Loading users': 'Načítání uživatelů',
  'Actions for @{username}': 'Akce pro @{username}',
  'New activation link': 'Nový aktivační odkaz',
  Deactivate: 'Deaktivovat',
  Activate: 'Aktivovat',
  Deactivated: 'Deaktivován',
  'Must change password': 'Musí změnit heslo',
  'E-mail unverified': 'E-mail neověřen',
  // components/organisms/AuditEventRow.tsx
  'Workspace limits changed': 'Limity workspace změněny',
  'Signed in': 'Přihlášení',
  'Sign-in failed': 'Neúspěšné přihlášení',
  'Account registered': 'Účet zaregistrován',
  'Account activated': 'Účet aktivován',
  'Password changed': 'Heslo změněno',
  'Password reset requested': 'Žádost o obnovu hesla',
  'Password reset completed': 'Heslo obnoveno',
  'Account created': 'Účet založen',
  'Activation link issued': 'Aktivační odkaz vydán',
  'Account deactivated': 'Účet deaktivován',
  'Account reactivated': 'Účet znovu aktivován',
  'Password reset by an administrator': 'Heslo obnovil administrátor',
  'Signed-out visitor': 'Nepřihlášený návštěvník',
  // components/organisms/admin/PlatformAuditCard.tsx
  'Security log': 'Bezpečnostní záznam',
  'Sign-ins, account administration and deleted workspaces, newest first.':
    'Přihlášení, správa účtů a smazané workspaces, od nejnovějších.',
  'Loading security log': 'Načítám bezpečnostní záznam',
  'No security events yet.': 'Zatím žádné bezpečnostní události.',
  // pages/AuditLog.tsx
  'Workspace created': 'Workspace vytvořen',
  'Workspace updated': 'Workspace upraven',
  'Production policy changed': 'Změna pravidel produkce',
  'Workspace metrics exported': 'Export metrik workspace',
  'Member added': 'Člen přidán',
  'Member role changed': 'Změna role člena',
  'Member removed': 'Člen odebrán',
  'Project created': 'Projekt vytvořen',
  'Project imported': 'Projekt importován',
  'Project creation requested': 'Žádost o vytvoření projektu',
  'Project creation completed': 'Vytvoření projektu dokončeno',
  'Project import requested': 'Žádost o import projektu',
  'Project import completed': 'Import projektu dokončen',
  'Project deleted': 'Projekt smazán',
  'Environment target changed': 'Změna cíle prostředí',
  'Promotion requested': 'Žádost o povýšení',
  'Promotion completed': 'Povýšení dokončeno',
  'Rollback requested': 'Žádost o rollback',
  'Rollback completed': 'Rollback dokončen',
  'Deployment requested': 'Žádost o nasazení',
  'Start requested': 'Žádost o spuštění',
  'Start completed': 'Spuštění dokončeno',
  'Stop requested': 'Žádost o zastavení',
  'Stop completed': 'Zastavení dokončeno',
  'Removal requested': 'Žádost o odstranění',
  'Removal completed': 'Odstranění dokončeno',
  'Diagnostics requested': 'Žádost o diagnostiku',
  'Environment lifetime expired': 'Životnost prostředí vypršela',
  'Production requested': 'Žádost o produkci',
  'Production request approved': 'Žádost o produkci schválena',
  'Production approval accepted': 'Schválení produkce přijato',
  'Production approval failed': 'Schválení produkce selhalo',
  'Production request became stale': 'Žádost o produkci zastarala',
  'Target created': 'Cíl vytvořen',
  'Target updated': 'Cíl upraven',
  'Target connected': 'Cíl připojen',
  'Target disconnected': 'Cíl odpojen',
  'Target retired': 'Cíl vyřazen',
  'Target restored': 'Cíl obnoven',
  'Target deleted': 'Cíl smazán',
  'Allocation created': 'Přidělení vytvořeno',
  'Allocation updated': 'Přidělení upraveno',
  'Allocation deleted': 'Přidělení smazáno',
  'Agent enrollment issued': 'Registrace Agenta vydána',
  'Agent disabled': 'Agent vypnut',
  'Agent update requested': 'Žádost o aktualizaci Agenta',
  'Agent update completed': 'Aktualizace Agenta dokončena',
  'InitPad system': 'Systém InitPad',
  'Who changed what in this workspace, newest first.':
    'Kdo co v tomto workspace změnil, od nejnovějšího.',
  Records: 'Záznamy',
  'Workspace changes with immutable actor and resource snapshots.':
    'Změny ve workspace s neměnnými snímky aktéra a zdroje.',
  Privacy: 'Soukromí',
  'Secrets, configuration values and application logs are never stored here.':
    'Tajemství, konfigurační hodnoty ani logy aplikací se zde nikdy neukládají.',
  'Filter by action': 'Filtrovat podle akce',
  'All actions': 'Všechny akce',
  'Filter by resource': 'Filtrovat podle zdroje',
  'All resources': 'Všechny zdroje',
  Project: 'Projekt',
  Allocation: 'Přidělení',
  Agent: 'Agent',
  'Filter by outcome': 'Filtrovat podle výsledku',
  'All outcomes': 'Všechny výsledky',
  Accepted: 'Přijato',
  Succeeded: 'Úspěch',
  Failed: 'Selhalo',
  Cancelled: 'Zrušeno',
  'Loading audit log': 'Načítání auditního logu',
  'No matching events': 'Žádné odpovídající události',
  'No audit events yet': 'Zatím žádné auditní události',
  'Change or clear the filters to see other workspace events.':
    'Změňte nebo zrušte filtry, abyste viděli další události workspace.',
  'Security-relevant workspace changes will appear here.':
    'Zobrazí se tu změny ve workspace důležité z hlediska bezpečnosti.',
  'Clear filters': 'Zrušit filtry',
  'Load more': 'Načíst další',
  // pages/ChangePassword.tsx
  'New passwords do not match.': 'Nová hesla se neshodují.',
  'Choose a new password': 'Zvolte nové heslo',
  'Signed in as <b>@{username}</b>.': 'Přihlášen(a) jako <b>@{username}</b>.',
  'Your account uses a temporary password. Set a new one to continue.':
    'Váš účet používá dočasné heslo. Pro pokračování si nastavte nové.',
  'Temporary password': 'Dočasné heslo',
  'New password': 'Nové heslo',
  'Confirm new password': 'Potvrzení nového hesla',
  'Update password': 'Změnit heslo',
  // pages/Dashboard.tsx
  'Retry cleanup for {project}?': 'Zopakovat úklid pro {project}?',
  'incomplete project': 'nedokončený projekt',
  'Cleanup reconciles resources left behind by an interrupted or failed setup.':
    'Úklid dá do pořádku zdroje, které zůstaly po přerušeném nebo neúspěšném zakládání.',
  Operation: 'Operace',
  Attempt: 'Pokus',
  'InitPad may delete the partial repository, generated files or project record owned by this failed setup.':
    'InitPad může smazat částečný repozitář, vygenerované soubory nebo záznam projektu, které patří k tomuto neúspěšnému zakládání.',
  'Successfully provisioned unrelated resources are not touched.':
    'Úspěšně založených nesouvisejících zdrojů se to nedotkne.',
  '{name} workspace': 'Workspace {name}',
  'Export metrics': 'Export metrik',
  'New project': 'Nový projekt',
  Running: 'Běží',
  'Needs attention': 'Vyžaduje pozornost',
  'Nothing to clean up': 'Není co uklízet',
  'Pending approvals': 'Čeká na schválení',
  'Production requests': 'Žádosti o produkci',
  'Provisioning needs attention': 'Zakládání vyžaduje pozornost',
  'A project setup did not finish. Retry it, or clean up what it left behind.':
    'Zakládání projektu se nedokončilo. Zopakujte ho, nebo ukliďte, co po něm zůstalo.',
  'Interrupted — external state must be reconciled.':
    'Přerušeno — vnější stav je potřeba dát do pořádku.',
  'Current step: {step}': 'Aktuální krok: {step}',
  'View project': 'Zobrazit projekt',
  'Retry setup': 'Zopakovat zakládání',
  'No projects yet': 'Zatím žádné projekty',
  "Create your first project from a template — you'll get a Git repository, CI/CD pipeline and a running dev environment out of the box.":
    'Vytvořte svůj první projekt ze šablony — hned získáte Git repozitář, CI/CD pipeline a běžící prostředí dev.',
  'Recent projects': 'Poslední projekty',
  'View all': 'Zobrazit vše',
  attention: 'pozor',
  'build {sha} {status}': 'build {sha} {status}',
  'no verified build yet': 'zatím bez ověřeného buildu',
  'Loading projects': 'Načítání projektů',
  // pages/Environments.tsx
  All: 'Vše',
  'Where every project is running right now, grouped by project.':
    'Kde právě teď běží jednotlivé projekty, seskupeno podle projektu.',
  'Loading environments': 'Načítání prostředí',
  'No environments yet': 'Zatím žádná prostředí',
  'Create a project and its configured deployment environments will appear here.':
    'Vytvořte projekt a jeho nastavená prostředí pro nasazení se zobrazí zde.',
  'Filter by environment': 'Filtrovat podle prostředí',
  'No {filter} environments': 'Žádná prostředí {filter}',
  "None of this workspace's projects currently has a {filter} environment.":
    'Žádný projekt tohoto workspace nyní nemá prostředí {filter}.',
  '{name} environments': 'Prostředí projektu {name}',
  'Open project': 'Otevřít projekt',
  'Open {name}': 'Otevřít {name}',
  // pages/ForgotPassword.tsx
  'Reset your password': 'Obnovení hesla',
  'If an account matches that username or e-mail, a reset link has been created. Check your inbox — or, on a self-hosted instance without e-mail, ask your administrator for the link.':
    'Pokud tomuto uživatelskému jménu nebo e-mailu odpovídá nějaký účet, byl vytvořen odkaz pro obnovení. Podívejte se do schránky — nebo v self-hosted instanci bez e-mailu požádejte o odkaz administrátora.',
  'Enter your username or e-mail and we’ll send a reset link.':
    'Zadejte uživatelské jméno nebo e-mail a pošleme vám odkaz pro obnovení.',
  'Send reset link': 'Odeslat odkaz pro obnovení',
  // pages/ImportRepo.tsx
  'Repository imported': 'Repozitář importován',
  'Starter workflow downloaded': 'Výchozí workflow staženo',
  'Import existing repository': 'Import existujícího repozitáře',
  'Connect a repository you already have. InitPad validates it — your code is never rewritten.':
    'Připojte repozitář, který už máte. InitPad ho ověří — váš kód se nikdy nepřepisuje.',
  Import: 'Import',
  'Records the project, connects CI and prepares its environments.':
    'Zaznamená projekt, připojí CI a připraví jeho prostředí.',
  'Source code': 'Zdrojový kód',
  'Your repository contents are validated, never rewritten.':
    'Obsah repozitáře se ověřuje, nikdy se nepřepisuje.',
  'Start from a template': 'Začít ze šablony',
  'Viewer access is read-only. Ask a workspace admin for a member or maintainer role to import projects.':
    'Čtenář má přístup jen pro čtení. O roli člena nebo správce, která umožní import projektů, požádejte administrátora workspace.',
  '{issue} Configure a public HTTPS <code>INITPAD_PUBLIC_URL</code> before importing.':
    '{issue} Před importem nastavte veřejnou HTTPS adresu <code>INITPAD_PUBLIC_URL</code>.',
  'GitHub cannot reach the InitPad CI callback.':
    'GitHub se nedokáže spojit s CI callbackem InitPadu.',
  'Loading repositories': 'Načítání repozitářů',
  'The repository to import and the runtime contract it already follows.':
    'Repozitář k importu a běhový kontrakt, který už dodržuje.',
  'Choose a repository…': 'Vyberte repozitář…',
  'already imported': 'už importován',
  empty: 'prázdný',
  'Runtime template': 'Běhová šablona',
  'About the runtime template': 'O běhové šabloně',
  'Choose the runtime contract this repository already follows. Import validates the repository but never rewrites its code.':
    'Zvolte běhový kontrakt, který tento repozitář už dodržuje. Import repozitář ověří, ale jeho kód nikdy nepřepíše.',
  Template: 'Šablona',
  'No GitHub installation is authorized for this workspace. <link>Open account settings</link>':
    'Pro tento workspace není autorizována žádná instalace GitHubu. <link>Otevřít nastavení účtu</link>',
  'No repositories available to import.': 'K importu nejsou k dispozici žádné repozitáře.',
  'The stages a verified build moves through.': 'Stupně, kterými ověřený build prochází.',
  'Deployment targets': 'Cíle nasazení',
  'Where each environment runs.': 'Kde jednotlivá prostředí běží.',
  'Check and import': 'Kontrola a import',
  'Preflight inspects the repository before anything is changed.':
    'Předběžná kontrola prověří repozitář dřív, než se cokoli změní.',
  'Checking…': 'Kontroluje se…',
  'Run preflight again': 'Spustit kontrolu znovu',
  'Run preflight check': 'Spustit předběžnou kontrolu',
  'Preflight — {repo}': 'Předběžná kontrola — {repo}',
  'Default branch': 'Výchozí větev',
  Dockerfile: 'Dockerfile',
  found: 'nalezen',
  'not found': 'nenalezen',
  'InitPad workflow': 'Workflow InitPadu',
  compatible: 'kompatibilní',
  'Add the starter CI workflow': 'Přidejte výchozí CI workflow',
  'Download it, save it as <code>{path}</code>, review the build and test commands, commit it, then run preflight again.':
    'Stáhněte ho, uložte jako <code>{path}</code>, zkontrolujte příkazy pro build a testy, commitněte ho a pak spusťte předběžnou kontrolu znovu.',
  'Downloading…': 'Stahuje se…',
  'Download starter workflow': 'Stáhnout výchozí workflow',
  'Importing…': 'Importuje se…',
  'Import {name}': 'Importovat {name}',
  repository: 'repozitář',
  'Resolve the issues above before importing.': 'Před importem vyřešte výše uvedené problémy.',
  // pages/Infrastructure.tsx
  'runtime capabilities': 'podporované runtimy',
  'public URL': 'veřejná URL',
  'routing mode': 'režim routování',
  host: 'host',
  port: 'port',
  username: 'uživatelské jméno',
  'authentication method': 'způsob ověření',
  'authentication credentials': 'přihlašovací údaje',
  'host key fingerprint': 'otisk klíče hostitele',
  'remote path': 'vzdálená cesta',
  'environment quota': 'kvóta prostředí',
  'CPU limit': 'limit CPU',
  'memory limit': 'limit paměti',
  'process limit': 'limit procesů',
  'dev lifetime': 'životnost dev',
  'test lifetime': 'životnost test',
  'Save changes to {name}?': 'Uložit změny serveru {name}?',
  'Target settings control where and how future deployments are published.':
    'Nastavení cíle určuje, kam a jak se budou publikovat budoucí nasazení.',
  'Save server changes': 'Uložit změny serveru',
  'Changed settings': 'Změněná nastavení',
  'Existing running deployments are not moved automatically.':
    'Stávající běžící nasazení se automaticky nepřesouvají.',
  'Routing changes reset gateway readiness and require a new preflight.':
    'Změny routování zruší připravenost brány a vyžadují novou předběžnou kontrolu.',
  'Connection or runtime changes clear the previous verification and must be tested again.':
    'Změny připojení nebo runtimů zruší předchozí ověření a je nutné je otestovat znovu.',
  'Save workspace access changes for {targetName}?':
    'Uložit změny přístupu workspace k {targetName}?',
  'Workspace access controls how this workspace may use the deployment server.':
    'Přístup workspace určuje, jak smí tento workspace používat server pro nasazení.',
  'Save access changes': 'Uložit změny přístupu',
  'New deployments immediately use the updated capabilities, quota and URL.':
    'Nová nasazení okamžitě použijí upravené runtimy, kvótu a URL.',
  'Existing running workloads are not restarted by this change.':
    'Stávající běžící workloady se touto změnou nerestartují.',
  'Delete server {name}?': 'Smazat server {name}?',
  'InitPad will forget this server connection. The physical server itself is never deleted.':
    'InitPad toto připojení k serveru zapomene. Fyzický server se nikdy nemaže.',
  'Delete server': 'Smazat server',
  Type: 'Typ',
  'Stored connection settings, workspace access and any Agent identity are permanently removed from InitPad.':
    'Uložené nastavení připojení, přístup workspace a případná identita Agenta se z InitPadu trvale odstraní.',
  'You must add and verify or enroll the server again before reusing it.':
    'Před dalším použitím je nutné server znovu přidat a ověřit nebo zaregistrovat.',
  'Disconnect {name} from InitPad?': 'Odpojit {name} od InitPadu?',
  'Management access is revoked without sending a teardown command to the server.':
    'Přístup pro správu se zruší, aniž by se serveru poslal příkaz k odstranění.',
  'Disconnect server': 'Odpojit server',
  'Bound environments': 'Navázaná prostředí',
  'Existing applications and their public URLs are left untouched.':
    'Stávající aplikace a jejich veřejné URL zůstanou nedotčené.',
  'The Agent credential and unused enrollment token are revoked.':
    'Přihlašovací údaje Agenta a nepoužitý registrační token se zneplatní.',
  'The stored SFTP credential is permanently removed.':
    'Uložené přihlašovací údaje SFTP se trvale odstraní.',
  'Deploy, start, stop, diagnostics and cleanup remain unavailable until this server is reconnected.':
    'Nasazení, spuštění, zastavení, diagnostika a úklid nebudou dostupné, dokud server znovu nepřipojíte.',
  'Retire {name} as unmanaged?': 'Vyřadit {name} ze správy?',
  'Use this when the server and its applications should remain, but InitPad must stop managing them.':
    'Použijte, když mají server i jeho aplikace zůstat, ale InitPad je má přestat spravovat.',
  'Retire server': 'Vyřadit server',
  'Environments retained': 'Ponechaná prostředí',
  'All management credentials are revoked and cannot be recovered.':
    'Všechny přihlašovací údaje pro správu se zneplatní a nelze je obnovit.',
  'Existing workload records, URLs and deployment history remain visible as unmanaged.':
    'Stávající záznamy workloadů, URL a historie nasazení zůstanou viditelné jako nespravované.',
  'Restore the server and provide a new credential or Agent enrollment to manage it again.':
    'Chcete-li server znovu spravovat, obnovte ho a zadejte nové přihlašovací údaje nebo registraci Agenta.',
  'Pause workspace access to {targetName}?': 'Pozastavit přístup workspace k {targetName}?',
  'The {namespace} workspace namespace will stop accepting deployments on this server.':
    'Namespace workspace {namespace} přestane na tomto serveru přijímat nasazení.',
  'Existing running workloads remain untouched.': 'Stávající běžící workloady zůstanou nedotčené.',
  'New deploys through this workspace access are blocked until it is resumed.':
    'Nová nasazení přes tento přístup workspace jsou blokována, dokud ho neobnovíte.',
  'Remove workspace access to {targetName}?': 'Odebrat přístup workspace k {targetName}?',
  'This removes the workspace namespace and quota, not the physical server.':
    'Odebere se namespace a kvóta workspace, nikoli fyzický server.',
  'The workspace loses this namespace, quota and its allowed runtimes on the server.':
    'Workspace na serveru přijde o tento namespace, kvótu i povolené runtimy.',
  'Workspace access must be enabled again before deploying to this server.':
    'Před nasazením na tento server bude nutné přístup workspace znovu povolit.',
  'Machines and hosting that receive deployments, and what this workspace may use on each.':
    'Stroje a hosting, na které se nasazuje, a co na každém z nich smí tento workspace používat.',
  'Loading servers': 'Načítání serverů',
  // pages/Login.tsx
  'Setup token': 'Instalační token',
  'The first account becomes the administrator. Enter the setup token printed at the end of install.sh.':
    'První účet se stane administrátorem. Zadejte instalační token, který vypsal skript install.sh na konci instalace.',
  'Internal developer platform': 'Interní vývojářská platforma',
  'Loading sign-in options…': 'Načítání možností přihlášení…',
  'Authentication service is unavailable. Refresh and try again.':
    'Přihlašovací služba není dostupná. Obnovte stránku a zkuste to znovu.',
  'Continue with GitHub': 'Pokračovat přes GitHub',
  or: 'nebo',
  'Sign in or create an account': 'Přihlásit se nebo vytvořit účet',
  'Sign in': 'Přihlásit se',
  'Create account': 'Vytvořit účet',
  'Forgot your password?': 'Zapomněli jste heslo?',
  'Accounts are created by the instance administrator. Ask your InitPad admin for a sign-in link.':
    'Účty vytváří administrátor instance. O přihlašovací odkaz požádejte svého administrátora InitPadu.',
  'Your GitHub account creates or opens your InitPad account. Repository access is granted separately through the GitHub App.':
    'Váš účet GitHub vytvoří nebo otevře váš účet InitPad. Přístup k repozitářům se uděluje zvlášť přes GitHub App.',
  'GitHub sign-in is not configured for this SaaS installation.':
    'Přihlášení přes GitHub není pro tuto SaaS instalaci nastavené.',
  'No InitPad account is linked to that GitHub account. Sign in another way, then link GitHub in Settings.':
    'K tomuto účtu GitHub není připojen žádný účet InitPad. Přihlaste se jinak a pak GitHub propojte v Nastavení.',
  'This account has been deactivated. Contact your administrator.':
    'Tento účet byl deaktivován. Obraťte se na svého administrátora.',
  'The GitHub sign-in could not be verified. Please try again.':
    'Přihlášení přes GitHub se nepodařilo ověřit. Zkuste to prosím znovu.',
  'GitHub sign-in failed. Please try again.':
    'Přihlášení přes GitHub selhalo. Zkuste to prosím znovu.',
  'GitHub sign-in is not enabled on this instance.':
    'Přihlášení přes GitHub není v této instanci povolené.',
  'Please sign in first, then link your GitHub account.':
    'Nejdřív se prosím přihlaste a pak propojte svůj účet GitHub.',
  // pages/NewProject.tsx
  'Pick a template — InitPad creates the repository, the CI/CD pipeline and the environments.':
    'Vyberte šablonu — InitPad vytvoří repozitář, CI/CD pipeline i prostředí.',
  'Viewer access is read-only. Ask a workspace admin for a member or maintainer role to create projects.':
    'Čtenář má přístup jen pro čtení. O roli člena nebo správce, která umožní vytvářet projekty, požádejte administrátora workspace.',
  'Loading project setup': 'Načítání nastavení projektu',
  'Also used for the repository and the application address.':
    'Použije se také pro repozitář a adresu aplikace.',
  'Project name': 'Název projektu',
  '2–41 lowercase letters, digits or hyphens; starts with a letter.':
    '2–41 malých písmen, číslic nebo pomlček; začíná písmenem.',
  'Use 2–41 lowercase letters, digits or hyphens; start with a letter.':
    'Použijte 2–41 malých písmen, číslic nebo pomlček; začněte písmenem.',
  'GitHub repository owner': 'Vlastník repozitáře na GitHubu',
  'About the repository owner': 'O vlastníkovi repozitáře',
  'InitPad creates a private repository in the selected account.':
    'InitPad vytvoří soukromý repozitář ve vybraném účtu.',
  'Available owners': 'Dostupní vlastníci',
  'Only GitHub App installations authorized for {workspace} appear here.':
    'Zobrazují se jen instalace GitHub App autorizované pro {workspace}.',
  'Choose an account or organization…': 'Vyberte účet nebo organizaci…',
  'account owner only': 'jen vlastník účtu',
  'Link GitHub before creating a hosted project.':
    'Před vytvořením hostovaného projektu propojte GitHub.',
  'Authorize a GitHub App installation for this workspace first.':
    'Nejdřív pro tento workspace autorizujte instalaci GitHub App.',
  'Open account settings': 'Otevřít nastavení účtu',
  'Renew your GitHub authorization in <link>account settings</link> before InitPad can create a repository in your personal account.':
    'Aby InitPad mohl vytvořit repozitář ve vašem osobním účtu, obnovte autorizaci GitHubu v <link>nastavení účtu</link>.',
  '{issue} Configure a public HTTPS <code>INITPAD_PUBLIC_URL</code> and restart InitPad.':
    '{issue} Nastavte veřejnou HTTPS adresu <code>INITPAD_PUBLIC_URL</code> a restartujte InitPad.',
  'The language and runtime to start from.': 'Jazyk a runtime, ze kterých projekt vyjde.',
  'Update target capabilities': 'Upravit runtimy cíle',
  Summary: 'Souhrn',
  Environments: 'Prostředí',
  'No target chosen': 'Cíl není vybrán',
  'The project moves through <b>{stages}</b>.': 'Projekt prochází stupni <b>{stages}</b>.',
  'CI verifies the build without publishing it; request production from the project detail.':
    'CI build ověří, ale nepublikuje; o produkci požádáte z detailu projektu.',
  'The first successful CI run deploys to dev; promote the same build from the project detail.':
    'První úspěšný běh CI nasadí do dev; stejný build pak povýšíte z detailu projektu.',
  'Create project': 'Vytvořit projekt',
  'Setting up “{name}”': 'Zakládá se „{name}“',
  'Creating {provider} repository': 'Vytváří se repozitář v {provider}',
  'Generating project scaffold': 'Generuje se kostra projektu',
  'Configuring CI and deployment secrets': 'Nastavuje se CI a tajemství pro nasazení',
  'Redirecting to your project…': 'Přesměrování na váš projekt…',
  // pages/NotFound.tsx
  'Page not found': 'Stránka nenalezena',
  'Nothing here': 'Nic tu není',
  'This page doesn’t exist or may have moved.': 'Tato stránka neexistuje nebo byla přesunuta.',
  'Back to dashboard': 'Zpět na přehled',
  // pages/ProjectCommits.tsx
  'Back to project': 'Zpět na projekt',
  'Commit history': 'Historie commitů',
  History: 'Historie',
  'The {HISTORY_LIMIT} most recent commits.': 'Posledních {HISTORY_LIMIT} commitů.',
  'Pipeline status': 'Stav pipeline',
  'Stages update from CI/CD and link to their exact runner jobs.':
    'Stupně se aktualizují z CI/CD a odkazují přímo na své úlohy runneru.',
  'Loading commit history': 'Načítání historie commitů',
  // pages/ProjectDeployments.tsx
  'Back to audit log': 'Zpět na auditní log',
  'Deployment history': 'Historie nasazení',
  'The {HISTORY_LIMIT} most recent deployment operations.':
    'Posledních {HISTORY_LIMIT} operací nasazení.',
  'Build reuse': 'Opakované použití buildu',
  'Several deployments can publish the same verified source artifact.':
    'Několik nasazení může publikovat stejný ověřený zdrojový artefakt.',
  'Loading deployment history': 'Načítání historie nasazení',
  // pages/ProjectDetail.tsx
  'Project not found': 'Projekt nenalezen',
  "This project doesn't exist": 'Tento projekt neexistuje',
  'Check the address, or head back to your projects.':
    'Zkontrolujte adresu, nebo se vraťte ke svým projektům.',
  'Back to projects': 'Zpět na projekty',
  'Loading project': 'Načítání projektu',
  'Request production deployment?': 'Požádat o nasazení do produkce?',
  'The exact verified {source} build, target and production configuration revision will be locked for review.':
    'Přesný ověřený build ({source}), cíl a revize produkční konfigurace se uzamknou pro posouzení.',
  source: 'zdroj',
  'Create request': 'Vytvořit žádost',
  Version: 'Verze',
  'not available': 'není k dispozici',
  production: 'produkce',
  'No production workload changes until an authorized reviewer approves.':
    'Produkční workload se nezmění, dokud žádost neschválí oprávněný posuzovatel.',
  'Changing the build, target or production variables invalidates this request.':
    'Změna buildu, cíle nebo produkčních proměnných tuto žádost zneplatní.',
  'Request production redeploy?': 'Požádat o opětovné nasazení produkce?',
  'The current verified production build and configuration revision will be submitted for review.':
    'Současný ověřený produkční build a revize konfigurace se odešlou k posouzení.',
  'Changing the target or production variables invalidates this request.':
    'Změna cíle nebo produkčních proměnných tuto žádost zneplatní.',
  'Approve and deploy to production?': 'Schválit a nasadit do produkce?',
  'Approval starts deployment of the exact reviewed build to the recorded production target.':
    'Schválením se spustí nasazení přesně toho posouzeného buildu na zaznamenaný produkční cíl.',
  'Production is changed only if the reviewed target and configuration revision still match.':
    'Produkce se změní jen tehdy, pokud posouzený cíl a revize konfigurace stále odpovídají.',
  'The action and resulting deployment are recorded separately in the audit log.':
    'Akce i výsledné nasazení se v auditním logu zaznamenají zvlášť.',
  'Reject production request?': 'Zamítnout žádost o produkci?',
  'The reviewed build will not be deployed by this request.':
    'Posouzený build se touto žádostí nenasadí.',
  'Reject request': 'Zamítnout žádost',
  'Cancel production request?': 'Zrušit žádost o produkci?',
  'The pending request will no longer be available for approval.':
    'Čekající žádost už nebude možné schválit.',
  'Stop the {environment} environment?': 'Zastavit prostředí {environment}?',
  'The deployment record is preserved, but the application will stop serving traffic.':
    'Záznam o nasazení zůstane zachován, ale aplikace přestane obsluhovat provoz.',
  'Stop {environment}': 'Zastavit {environment}',
  'The environment becomes unavailable until it is started again.':
    'Prostředí nebude dostupné, dokud ho znovu nespustíte.',
  'The deployed version and configuration remain recorded.':
    'Nasazená verze a konfigurace zůstávají zaznamenané.',
  'Cancel the {environment} deployment?': 'Zrušit nasazení {environment}?',
  'Retry cleanup for {environment}?': 'Zopakovat úklid pro {environment}?',
  'Remove the {environment} deployment?': 'Odstranit nasazení {environment}?',
  'InitPad will cancel the active operation and clean up any managed partial workload.':
    'InitPad zruší probíhající operaci a uklidí případný spravovaný částečný workload.',
  'InitPad will remove the managed workload from its assigned target.':
    'InitPad odstraní spravovaný workload z přiřazeného cíle.',
  'Cancel deployment': 'Zrušit nasazení',
  'The public application for this environment becomes unavailable.':
    'Veřejná aplikace tohoto prostředí přestane být dostupná.',
  'Any earlier verified builds remain in project history and can be deployed again.':
    'Dřívější ověřené buildy zůstávají v historii projektu a lze je nasadit znovu.',
  'The verified build remains in project history and can be deployed again.':
    'Ověřený build zůstává v historii projektu a lze ho nasadit znovu.',
  'InitPad never deletes unrelated files or the physical target.':
    'InitPad nikdy nemaže nesouvisející soubory ani fyzický cíl.',
  'Change project pipeline?': 'Změnit pipeline projektu?',
  'The configured deployment stages will change for future operations.':
    'Nastavené stupně nasazení se změní pro budoucí operace.',
  'Change pipeline': 'Změnit pipeline',
  Preset: 'Předvolba',
  Added: 'Přidáno',
  Removed: 'Odebráno',
  'A removed stage must already be empty and have no pending cleanup.':
    'Odebíraný stupeň už musí být prázdný a nesmí mít čekající úklid.',
  'Production remains protected by a separate approval request.':
    'Produkce zůstává chráněná samostatnou žádostí o schválení.',
  Configuration: 'Konfigurace',
  'Variables and secrets injected at deploy. Redeploy to apply changes.':
    'Proměnné a tajemství vkládané při nasazení. Změny se projeví po opětovném nasazení.',
  '{name} variables': 'Proměnné pro {name}',
  variables: 'proměnné',
  'Pipeline options': 'Možnosti pipeline',
  // pages/Projects.tsx
  'Filter projects…': 'Filtrovat projekty…',
  'Filter projects': 'Filtrovat projekty',
  '{shown} of {total}': '{shown} z {total}',
  'No matches': 'Nic nenalezeno',
  'No projects match “{query}”.': 'Žádný projekt neodpovídá hledání „{query}“.',
  // pages/ResetPassword.tsx
  'Set a new password': 'Nastavte nové heslo',
  'Your password has been reset. Redirecting you to sign in…':
    'Heslo bylo obnoveno. Přesměrováváme vás na přihlášení…',
  'Choose a new password for your account.': 'Zvolte nové heslo pro svůj účet.',
  // pages/RouteError.tsx
  'Something went wrong': 'Něco se pokazilo',
  // pages/Templates.tsx
  'Maintained starting points — pick one and InitPad creates the repository, pipeline and environments.':
    'Udržované výchozí body — vyberte si a InitPad vytvoří repozitář, pipeline i prostředí.',
  'A maintained starting point for a language and runtime.':
    'Udržovaný výchozí bod pro daný jazyk a runtime.',
  Included: 'Obsahuje',
  'Starter code, a Dockerfile and a CI/CD workflow.': 'Výchozí kód, Dockerfile a CI/CD workflow.',
  'Loading templates': 'Načítání šablon',
  'No templates available': 'Žádné šablony nejsou k dispozici',
  'The platform administrator has not installed any project templates yet.':
    'Správce platformy zatím nenainstaloval žádné šablony projektů.',
  'Use template': 'Použít šablonu',
  // pages/VerifyEmail.tsx
  'Verifying your e-mail…': 'Ověřujeme váš e-mail…',
  'E-mail verified': 'E-mail ověřen',
  'Verification failed': 'Ověření selhalo',
  'This only takes a moment.': 'Bude to jen chvilka.',
  'Thanks — your e-mail address is confirmed.': 'Děkujeme — vaše e-mailová adresa je potvrzená.',
  'This link is invalid or has expired.': 'Tento odkaz je neplatný nebo jeho platnost vypršela.',
  'Go to InitPad': 'Přejít do InitPadu',
  // pages/WorkspaceSettings.tsx
  'Workspace settings': 'Nastavení workspace',
  'Members, policy and limits of {name}.': 'Členové, pravidla a limity workspace {name}.',
  // added after the first pass
  '{projects} projects · {members} members · {servers} servers':
    'projekty {projects} · členové {members} · servery {servers}',
  value: 'hodnota',
  'The server did not respond in time. Try again.': 'Server neodpověděl včas. Zkuste to znovu.',
} satisfies Record<string, string>;
