/**
 * Czech translations of API messages recognised by lib/api-messages.ts
 * (ADR-185). Keys are the English API messages with their variable parts as
 * `{placeholders}`.
 */
export const csApi = {
  // not found
  'Workspace not found': 'Workspace nebyl nalezen',
  "Project '{name}' not found": 'Projekt {name} nebyl nalezen',
  "Target '{name}' not found": 'Server {name} nebyl nalezen',
  "Environment '{env}' not found": 'Prostředí {env} nebylo nalezeno',
  "Allocation '{name}' not found": 'Přístup workspace {name} nebyl nalezen',
  "Provisioning operation '{name}' not found": 'Zakládání {name} nebylo nalezeno',
  "User '{name}' not found": 'Uživatel {name} nebyl nalezen',
  'User not found': 'Uživatel nebyl nalezen',
  'Workspace member not found': 'Člen workspace nebyl nalezen',
  'Production request not found': 'Žádost o produkci nebyla nalezena',
  // access, roles
  'Workspace read access required': 'Potřebujete přístup k tomuto workspace',
  'Workspace write access required': 'Tato akce vyžaduje v workspace roli member nebo vyšší',
  'Workspace maintain access required': 'Tato akce vyžaduje v workspace roli maintainer nebo vyšší',
  'Workspace admin access required': 'Tato akce vyžaduje v workspace roli admin nebo owner',
  'Workspace admin access required to manage allocations':
    'Přístup workspace k serverům spravuje jen admin nebo owner workspace',
  'Workspace admin access required to manage the Agent':
    'Agenta spravuje jen admin nebo owner workspace',
  'Only the workspace owner can delete it': 'Workspace může smazat jen jeho owner',
  'Only the workspace owner can change the production approval policy':
    'Pravidlo schvalování produkce může změnit jen owner workspace',
  'Only the requester can cancel this production request':
    'Žádost o produkci může zrušit jen ten, kdo ji podal',
  'Workspace owner role cannot be changed': 'Roli ownera workspace nelze změnit',
  'Workspace owner cannot be removed': 'Ownera workspace nelze odebrat',
  'User is already a workspace member': 'Uživatel už je členem workspace',
  'Create a team workspace before adding other members':
    'Před přidáním dalších členů vytvořte týmový workspace',
  'Personal workspaces cannot be deleted': 'Osobní workspace nelze smazat',
  'Personal workspaces always use self-review': 'Osobní workspace vždy schvaluje sám uživatel',
  'Delete or move all projects and targets before deleting this workspace':
    'Před smazáním workspace smažte nebo přesuňte všechny projekty a servery',
  "Workspace slug '{slug}' is already taken": 'Identifikátor workspace {slug} už je obsazený',
  'You can own at most {limit} team workspaces. Delete one you no longer need or ask the platform administrator.':
    'Můžete vlastnit nejvýše {limit} týmových workspace. Smažte některý, který už nepotřebujete, nebo požádejte správce platformy.',
  // auth, session
  'Not authenticated': 'Nejste přihlášeni',
  'Session has been revoked': 'Relace byla ukončena',
  'Session is no longer valid': 'Relace už není platná',
  'Password change required before continuing': 'Před pokračováním je nutné změnit heslo',
  'Invalid username or password': 'Neplatné uživatelské jméno nebo heslo',
  'This account has been deactivated': 'Tento účet byl deaktivován',
  'Too many attempts. Try again later.': 'Příliš mnoho pokusů. Zkuste to později.',
  'Current password is incorrect': 'Současné heslo není správné',
  'New password must differ from the current one': 'Nové heslo se musí lišit od současného',
  'Username or e-mail is already taken': 'Uživatelské jméno nebo e-mail už je obsazený',
  'This link is invalid or has expired': 'Tento odkaz je neplatný nebo jeho platnost vypršela',
  'Account registration is closed. Ask the platform administrator for access.':
    'Registrace účtů je uzavřená. O přístup požádejte správce platformy.',
  'The setup token is not valid. Use the token printed at the end of install.sh.':
    'Instalační token není platný. Použijte token vypsaný na konci install.sh.',
  'E-mail is already verified': 'E-mail už je ověřený',
  'No e-mail address on file': 'U účtu není uložená e-mailová adresa',
  'Password must be at least 12 characters': 'Heslo musí mít alespoň 12 znaků',
  'Password must be at most 128 characters': 'Heslo může mít nejvýše 128 znaků',
  'Valid e-mail required': 'Zadejte platný e-mail',
  'Username: letters, digits, dot, dash, underscore (2–39 chars)':
    'Uživatelské jméno: písmena, číslice, tečka, pomlčka, podtržítko (2–39 znaků)',
  'Sign out to end the current session': 'Aktuální relaci ukončíte odhlášením',
  // projects, import
  "This workspace already has a project named '{name}'":
    'Tento workspace už má projekt s názvem {name}',
  'Name: lowercase letters, digits and hyphens (2–41 chars), must start with a letter':
    'Název: malá písmena, číslice a pomlčky (2–41 znaků), musí začínat písmenem',
  'Slug: lowercase letters, digits and hyphens (2–40 chars); personal-* is reserved':
    'Identifikátor: malá písmena, číslice a pomlčky (2–40 znaků); personal-* je vyhrazené',
  "A repository named '{name}' already exists in {provider}. Choose a different project name, or import the existing repository.":
    'Repozitář {name} už v {provider} existuje. Zvolte jiný název projektu, nebo existující repozitář importujte.',
  "Repository '{name}' is already connected to InitPad": 'Repozitář {name} už je k InitPadu připojený',
  'Repository name is not a valid project name (lowercase letters, digits and hyphens).':
    'Název repozitáře není platný název projektu (malá písmena, číslice a pomlčky).',
  'Cannot import an empty repository — push code first.':
    'Prázdný repozitář nelze importovat — nejdřív do něj nahrajte kód.',
  "Cannot import '{name}': no Dockerfile exists on '{branch}' for the selected runtime.":
    'Repozitář {name} nelze importovat: ve větvi {branch} chybí Dockerfile pro zvolené prostředí běhu.',
  "Cannot import '{name}': add the InitPad starter workflow at '{path}' first. You can download it from the import screen.":
    'Repozitář {name} nelze importovat: nejdřív přidejte startovací workflow InitPadu do {path}. Stáhnete ho na obrazovce importu.',
  'The Git service is temporarily unavailable. Try again in a few minutes.':
    'Služba Git je dočasně nedostupná. Zkuste to za pár minut.',
  'The pipeline preset changed concurrently; reload and retry':
    'Nastavení pipeline mezitím změnil někdo jiný; načtěte stránku znovu a zkuste to znovu',
  'The pipeline preset cannot change while a project operation is running':
    'Nastavení pipeline nelze měnit, dokud u projektu běží operace',
  'Resolve or cancel the pending production request before changing the pipeline preset':
    'Před změnou nastavení pipeline vyřiďte nebo zrušte čekající žádost o produkci',
  "Environment '{env}' is not empty. Remove its deployment and finish any pending cleanup before changing the pipeline preset.":
    'Prostředí {env} není prázdné. Před změnou nastavení pipeline odeberte jeho nasazení a dokončete úklid.',
  'This provisioning operation is no longer retryable': 'Toto zakládání už nelze zopakovat',
  'This provisioning operation has no pending cleanup': 'Toto zakládání nečeká na žádný úklid',
  'This provisioning cleanup is already running': 'Úklid tohoto zakládání už běží',
  'Only a failed provisioning operation can be dismissed': 'Skrýt lze jen neúspěšné zakládání',
  'Retry requested': 'Opakování vyžádáno',
  'Retry could not be started': 'Opakování se nepodařilo spustit',
  'Provisioning cleanup is running': 'Probíhá úklid zakládání',
  'Cleanup completed; this operation is safe to retry':
    'Úklid je hotový; zakládání lze bezpečně zopakovat',
  'A newer attempt has been started': 'Byl spuštěn novější pokus',
  'The API process stopped before provisioning completed; reconciliation is required':
    'Proces API se zastavil před dokončením zakládání; je potřeba stav srovnat',
  'Project deletion requested': 'Vyžádáno smazání projektu',
  // environments, deploys
  "Environment '{env}' is busy. Cancel or wait for its current operation first.":
    'Prostředí {env} je zaneprázdněné. Nejdřív zrušte jeho operaci, nebo počkejte na její dokončení.',
  "Environment '{env}' is busy. Wait for or cancel its operation before changing config.":
    'Prostředí {env} je zaneprázdněné. Před změnou proměnných počkejte na dokončení jeho operace, nebo ji zrušte.',
  "Environment '{env}' is not stopped": 'Prostředí {env} není zastavené',
  "Environment '{env}' is not running": 'Prostředí {env} neběží',
  "Environment '{env}' has nothing to start": 'V prostředí {env} není co spustit',
  "Environment '{env}' has nothing to redeploy": 'V prostředí {env} není co znovu nasadit',
  "Environment '{env}' has an active operation": 'V prostředí {env} už probíhá operace',
  "Environment '{env}' still has pending cleanup. Finish it before changing target.":
    'Prostředí {env} ještě čeká na úklid. Před změnou serveru ho dokončete.',
  "Source environment '{env}' has nothing to promote": 'Ze zdrojového prostředí {env} není co povýšit',
  "Cannot promote to '{env}'": 'Do prostředí {env} nelze povýšit',
  'Environment must be dev, test or prod': 'Prostředí musí být dev, test nebo prod',
  'Dev can only run again after it was cancelled or failed':
    'Dev lze spustit znovu jen po zrušení nebo selhání',
  'No verified default-branch CI build is available':
    'Pro výchozí větev není k dispozici žádný ověřený CI build',
  'No repository commit is available to run': 'V repozitáři není žádný commit ke spuštění',
  'Verified build artifact is no longer available': 'Ověřený build už není k dispozici',
  'Application config changed after this deployment was queued; start a new deployment':
    'Proměnné aplikace se změnily po zařazení nasazení do fronty; spusťte nové nasazení',
  'Artifact ingestion was interrupted by a control-plane restart; run CI again':
    'Příjem buildu přerušil restart InitPadu; spusťte CI znovu',
  'CI failed before it could publish a deployable image ({jobs}). Open the SCM run logs, fix the job and run again.':
    'CI selhalo dřív, než vytvořilo nasaditelný image ({jobs}). Otevřete logy běhu v repozitáři, opravte úlohu a spusťte ji znovu.',
  'CI did not produce a deployable image (CI result: {status}). Open the SCM run logs, fix the failed job and run again.':
    'CI nevytvořilo nasaditelný image (výsledek CI: {status}). Otevřete logy běhu v repozitáři, opravte neúspěšnou úlohu a spusťte ji znovu.',
  'Cleanup pending: {detail}': 'Čeká se na úklid: {detail}',
  'Cleanup failed: {detail}': 'Úklid selhal: {detail}',
  'Could not remove {env} deployment from {target}: {detail}':
    'Nasazení {env} se ze serveru {target} nepodařilo odebrat: {detail}',
  '{detail}; the operation in progress was cancelled': '{detail}; probíhající operace byla zrušena',
  'Cancellation requested — cleaning up': 'Zrušení vyžádáno — probíhá úklid',
  'Cancellation requested by user': 'Zrušeno uživatelem',
  'Cancelled because project deletion was requested': 'Zrušeno kvůli smazání projektu',
  'Cancelled because another workflow step failed': 'Zrušeno, protože selhal jiný krok',
  'Target is no longer connected': 'Server už není připojený',
  'Environment operation failed': 'Operace prostředí selhala',
  'Could not queue Agent operation': 'Operaci pro Agenta se nepodařilo zařadit do fronty',
  'Another operation is already active': 'Už probíhá jiná operace',
  'Gateway route could not be queued': 'Změnu routy brány se nepodařilo zařadit do fronty',
  'Agent delivery could not be prepared': 'Doručení pro Agenta se nepodařilo připravit',
  'Approved production state changed before deployment started':
    'Schválený stav produkce se změnil před začátkem nasazení',
  // production approvals
  'Production deployments must be requested and approved':
    'Nasazení do produkce je nutné vyžádat a nechat schválit',
  'Production redeployments must be requested and approved':
    'Opětovné nasazení produkce je nutné vyžádat a nechat schválit',
  'Production rollbacks must be requested and approved':
    'Návrat produkce je nutné vyžádat a nechat schválit',
  'Production has an operation in progress': 'V produkci probíhá operace',
  'This production request was reviewed concurrently': 'Tuto žádost mezitím posoudil někdo jiný',
  'This production request is no longer pending': 'Tato žádost o produkci už nečeká na posouzení',
  'This production request is already {status}': 'Tato žádost o produkci už je ve stavu {status}',
  'This workspace requires a different person to approve production':
    'V tomto workspace musí produkci schválit někdo jiný než žadatel',
  'Another production request was created at the same time. Reload and review it.':
    'Současně vznikla jiná žádost o produkci. Načtěte stránku znovu a posuďte ji.',
  'Artifact, target, or production configuration changed. Create a new request.':
    'Build, server nebo konfigurace produkce se změnily. Vytvořte novou žádost.',
  'Artifact, target, or production configuration changed. Create a new production request.':
    'Build, server nebo konfigurace produkce se změnily. Vytvořte novou žádost o produkci.',
  'The previous verified deployment changed. Review rollback again.':
    'Předchozí ověřené nasazení se změnilo. Zkontrolujte návrat znovu.',
  'The previous verified production deployment changed. Review rollback again.':
    'Předchozí ověřené nasazení produkce se změnilo. Zkontrolujte návrat znovu.',
  'Production changed after rollback confirmation was opened. Review it again.':
    'Produkce se změnila po otevření potvrzení návratu. Zkontrolujte ho znovu.',
  // servers, workspace access
  "A server named '{name}' already exists": 'Server s názvem {name} už existuje',
  'This target host is reserved or unsafe': 'Adresa serveru je vyhrazená nebo nebezpečná',
  'Built-in targets cannot be modified': 'Vestavěné servery nelze upravit',
  'Target type cannot be changed; create a new target instead':
    'Typ serveru nelze změnit; přidejte místo toho nový server',
  'Public URL must be a safe HTTP(S) address': 'Veřejná URL musí být bezpečná adresa HTTP(S)',
  'Hosted SFTP targets must resolve only to public internet addresses':
    'Hostované SFTP servery musí mířit jen na veřejné internetové adresy',
  'Hosted SFTP public URLs must resolve only to public internet addresses':
    'Veřejná URL hostovaného SFTP musí mířit jen na veřejné internetové adresy',
  'Could not retrieve the SSH host key from this server':
    'Ze serveru se nepodařilo získat SSH klíč hostitele',
  'Host key fingerprint must use the OpenSSH SHA256:<base64> format':
    'Otisk klíče hostitele musí mít formát OpenSSH SHA256:<base64>',
  'Remote path must be an absolute path without spaces or parent traversal':
    'Vzdálená cesta musí být absolutní, bez mezer a bez „..“',
  'Managed gateway routing is available only for Docker Agent targets':
    'Spravovaná brána je dostupná jen pro Docker servery s Agentem',
  'Agent-backed Docker targets are verified by Agent heartbeat, not an inbound connection test':
    'Docker servery s Agentem se ověřují signálem od Agenta, ne testem příchozího připojení',
  'A target in use cannot remove runtime capabilities. Move its environments first.':
    'Používanému serveru nelze odebrat prostředí běhu. Nejdřív přesuňte jeho prostředí.',
  'A target in use cannot change routing mode. Remove or move its environments first.':
    'Používanému serveru nelze změnit způsob zpřístupnění. Nejdřív jeho prostředí odeberte nebo přesuňte.',
  'Capabilities not offered by the target: {list}': 'Server nenabízí: {list}',
  'This target is used by {count} environment(s). Point them at another target first.':
    'Server používají prostředí ({count}). Nejdřív je přesměrujte na jiný server.',
  'This target has {count} deployment operation(s) in progress. Wait for them before editing the target.':
    'Na serveru probíhají operace nasazení ({count}). Před úpravou serveru počkejte na jejich dokončení.',
  'Release the deployments still recorded on this server first: {list}.':
    'Nejdřív uvolněte nasazení, která jsou na serveru stále evidovaná: {list}.',
  'Restore this retired target before editing it': 'Před úpravou vyřazený server obnovte',
  'Restore this retired target before verifying its connection':
    'Před ověřením připojení vyřazený server obnovte',
  'Restore this retired target before disconnecting it': 'Před odpojením vyřazený server obnovte',
  'Restore this retired target before enrolling an Agent':
    'Před registrací Agenta vyřazený server obnovte',
  'Only a retired target can be restored': 'Obnovit lze jen vyřazený server',
  "Target '{name}' must pass Test connection before it can host an environment.":
    'Server {name} musí projít testem připojení, než na něm může běžet prostředí.',
  "Target '{name}' is {state}; reconnect it before assigning an environment.":
    'Server {name} je ve stavu {state}; před přiřazením prostředí ho znovu připojte.',
  "Target '{name}' cannot run {runtime} apps (its capabilities: {capabilities}).":
    'Server {name} neumí spustit aplikace {runtime} (umí: {capabilities}).',
  "Remove the Agent-managed '{env}' deployment before changing its target.":
    'Před změnou serveru odeberte nasazení {env} spravované Agentem.',
  'This workspace already has access to that server': 'Tento workspace už má k serveru přístup',
  'Workspace access to this server is paused; new deployments are disabled.':
    'Přístup workspace k serveru je pozastavený; nová nasazení jsou vypnutá.',
  "Workspace access to '{name}' is paused.": 'Přístup workspace k serveru {name} je pozastavený.',
  'Workspace access quota reached (max {max} environments).':
    'Kvóta přístupu workspace je vyčerpaná (nejvýše {max} prostředí).',
  'Workspace access is used by {count} environment(s). Move them first.':
    'Přístup workspace používají prostředí ({count}). Nejdřív je přesuňte.',
  'Workspace access has {count} deployment operation(s) in progress. Wait for them before editing it.':
    'V přístupu workspace probíhají operace nasazení ({count}). Před úpravou počkejte na jejich dokončení.',
  // Agent
  'Invalid Agent credential': 'Neplatné přihlašovací údaje Agenta',
  'Invalid or expired Agent enrollment token': 'Registrační token Agenta je neplatný nebo vypršel',
  'Target is no longer available for Agent enrollment': 'Server už nelze použít k registraci Agenta',
  'InitPad Agent can only be bound to a Docker target': 'InitPad Agent lze připojit jen k Docker serveru',
  'Enroll the target Agent before deploying to it': 'Před nasazením zaregistrujte Agenta na serveru',
  'Enroll the target Agent before requesting diagnostics':
    'Před diagnostikou zaregistrujte Agenta na serveru',
  "Enroll and enable the Agent for target '{name}' before using it.":
    'Před použitím serveru {name} na něm zaregistrujte a zapněte Agenta.',
  'No newer verified Agent release is available': 'Novější ověřená verze Agenta není k dispozici',
  'The verified Agent release is not currently available':
    'Ověřená verze Agenta teď není k dispozici',
  'Restore the target before updating its Agent': 'Před aktualizací Agenta server obnovte',
  // app variables
  'Key must match ^[A-Z_][A-Z0-9_]* (uppercase letters, digits and underscore)':
    'Klíč musí odpovídat ^[A-Z_][A-Z0-9_]* (velká písmena, číslice a podtržítko)',
  "'{key}' is a reserved platform variable": '{key} je vyhrazená proměnná platformy',
  'Value must be a string up to {max} characters': 'Hodnota může mít nejvýše {max} znaků',
  // deployment and job steps
  'Waiting for Agent': 'Čeká se na Agenta',
  'Claimed by Agent': 'Převzato Agentem',
  'Waiting for an available CI runner': 'Čeká se na volný CI runner',
  'CI runner started the build': 'CI runner spustil build',
  'Waiting for GitHub Actions build': 'Čeká se na build v GitHub Actions',
  'Waiting for CI build; deployment target: {target}': 'Čeká se na CI build; server: {target}',
  'Recovering tested GitHub build; deployment target: {target}':
    'Obnovuje se otestovaný build z GitHubu; server: {target}',
  'Assigned to control plane': 'Převzato InitPadem',
  'Build artifact accepted': 'Build přijat',
  'Preparing deployment': 'Příprava nasazení',
  'Downloading and verifying tested image': 'Stahování a ověření otestovaného image',
  'Fetching & extracting tested artifact': 'Stahování a rozbalení otestovaného buildu',
  'Connecting to target': 'Připojování k serveru',
  'Checking target path': 'Kontrola cesty na serveru',
  'Preparing container runtime': 'Příprava běhového prostředí kontejneru',
  'Preparing release': 'Příprava vydání',
  'Resolving tested image': 'Dohledání otestovaného image',
  'Uploading archive': 'Nahrávání archivu',
  'Uploading files': 'Nahrávání souborů',
  'Uploading {done}/{total} files': 'Nahrávání souborů {done}/{total}',
  'Extracting on the server': 'Rozbalování na serveru',
  'Replacing previous container': 'Výměna předchozího kontejneru',
  'Setting permissions': 'Nastavení oprávnění',
  'Publishing release': 'Publikace vydání',
  Publishing: 'Publikace',
  'Starting container': 'Spouštění kontejneru',
  'Verifying deployment': 'Ověřování nasazení',
  'Receiving verified image artifact': 'Přijímání ověřeného image',
  'Creating isolated candidate workload': 'Vytváření izolované nové verze aplikace',
  'Verifying published workload health': 'Ověřování stavu publikované aplikace',
  'Publishing deployment result': 'Odesílání výsledku nasazení',
  'Inspecting allocation-scoped workload': 'Kontrola aplikace',
  'Recording bounded logs and health result': 'Ukládání logů a výsledku kontroly stavu',
  'Resolving wildcard gateway DNS': 'Ověřování wildcard DNS brány',
  'Verifying trusted TLS on port 443': 'Ověřování důvěryhodného TLS na portu 443',
  'Checking private Caddy adapter readiness': 'Kontrola připravenosti adaptéru Caddy',
  'Gateway DNS, TLS and adapter are ready': 'DNS, TLS a adaptér brány jsou připravené',
  'Gateway DNS, TLS and Caddy adapter preflight passed':
    'Kontrola DNS, TLS a adaptéru Caddy prošla',
  'Connecting gateway to the owned workload network': 'Připojování brány k síti aplikace',
  'Applying atomic Caddy route update': 'Použití změny routy v Caddy',
  'Verifying the public HTTPS application path': 'Ověřování veřejné HTTPS adresy aplikace',
  'Retiring the superseded workload revision': 'Vyřazování předchozí verze aplikace',
  'Waiting for Agent gateway reconcile': 'Čeká se, až Agent srovná bránu',
  'Gateway route updated; waiting for Agent workload cleanup':
    'Routa brány upravena; čeká se na úklid aplikace Agentem',
  'Verifying signed Agent release manifest': 'Ověřování podepsaného manifestu verze Agenta',
  'Handing update to the local rollback supervisor': 'Předání aktualizace místnímu supervisoru',
  'Waiting to update Agent to {version}': 'Čeká se na aktualizaci Agenta na {version}',
} satisfies Record<string, string>;
