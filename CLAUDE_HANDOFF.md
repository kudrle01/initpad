# InitPad — aktuální handoff pro dalšího implementátora

Nejdřív přečti `AGENTS.md`, `DECISIONS.md` (zejména ADR-027, ADR-030,
ADR-039 a ADR-042–046) a `PRODUCT_ROADMAP.md`. Pokračuj po malých atomických
commitech, neupravuj historii a zachovej existující data. Tvrzení „hotovo“ musí
být podložené testem; existence rozhraní nebo nepoužívaného registru nestačí.

## Závazný produktový model

- Žádná `Course` doména ani `Join course`; škola je use case nad workspaces.
- Autorizační hranice je `Workspace` + `WorkspaceMember`.
- Self-hosted: vestavěná Gitea a `open` nebo `admin-provisioned` onboarding.
- Public SaaS: GitHub login, GitHub App a GitHub Actions; bez SaaS Gitey a bez
  vlastních hesel InitPadu. GHCR push funguje, produkční private-image pull z
  control plane je otevřená artifact/agent hranice popsaná v ADR-046.
- GitHub App instalace je podmínka create/import repozitáře, ne vytvoření účtu.
- Do týmu se přidávají existující účty podle username/e-mailu; tokenové
  workspace pozvánky byly odstraněny v ADR-042.

## Co je skutečně dokončeno

- Workspaces/RBAC, edition-aware identity lifecycle, platform-admin správa
  self-hosted účtů, aktivační odkazy, forced password change, reset/verifikace
  a přidání existujícího účtu do týmu se synchronizací Gitea collaboratora.
- `ScmProvider` + `ScmRegistry`; edice určuje create/import provider a každý
  existující projekt následně používá adapter ze své uložené SCM identity.
- Explicitní SCM identita projektu: provider, immutable repository ID,
  owner/name/full name, default branch a installation binding. Import vybírá
  podle ID; CI/reconcile/archive/deploy/delete používají `ScmRepositoryRef`.
  Legacy Gitea řádky dostanou bezpečný backfill a provider reconciliation.
- Import Gitea/GitHub repozitáře: seznam všech workspace grantů, serverový
  preflight, import bez přepsání kódu, per-repo CI secret, prostředí `empty` a
  základní `ProvisioningOperation`. Non-static vyžaduje Dockerfile a každý
  provider kompatibilní InitPad workflow.
- GitHub OAuth sign-in/link podle immutable user ID, CSRF state+nonce,
  `ExternalIdentity`, podepsané installation webhooky a krátkodobé tokeny.
- GitHub App setup podle ADR-044: immutable installation account ID, osobní/
  organizační účet, hashovaný single-use state, serverové ověření callbacku,
  owner/admin re-check a explicitní user/workspace grant. Rename zachová vazbu;
  uninstall je auditní tombstone a zablokuje token. Osobní instalace má
  bezpečný recovery tok pro případ, že GitHub nevyvolá Setup callback:
  platný pending state + owner/admin + shoda immutable GitHub user ID; pro
  organizace se tento fallback nepoužívá. Organizace prochází user-bound OAuth
  kontrolou `/user` + `/user/installations`; krátkodobý token se neukládá.
- `GitHubScmProvider` obsahuje čtecí i write/provision operace. Osobní create
  používá rotovatelný šifrovaný user credential, organization create a další
  operace krátkodobé installation tokeny. Adapter umí bezpečný scaffold push,
  rollback nového repa, sealed-box Actions secrets, archiv, collaborators,
  retry tag, delete/detach/packages a GitHub Actions Check Runs.
- Create/import zapisuje před každým ne-transakčním zásahem durable
  `ProvisioningEffect`. Import při chybě odstraní platformní secrets, obnoví
  původní přímou Gitea/GitHub collaborator roli a smaže Project jen po úplné
  kompenzaci; jinak jej ponechá viditelný s `cleanup required` efektem.
- New project v SaaS nabízí aktivní osobní/organizační instalace aktuálního
  workspace; API cizí installation ID znovu odmítne. Chybějící/legacy OAuth
  credential má v Settings „Renew authorization“. Self-hosted UI zůstává Gitea.
- Audit 2026-07-17 opravil: native auth v SaaS, automatického prvního SaaS admina,
  odpojení poslední použitelné identity, ověření GitHub e-mailu, atomický claim
  jednorázových tokenů, oddělení platformního hesla od lokálního hesla Gitey a
  OIDC kontrolu deaktivace/session generation/forced-change před Gitea SSO.

## Co dokončeno není

- Effect journal zatím nemá startup crash reconciliation ani idempotentní retry.
  Neúspěšný create bez Project ID proto stále není dostupný z project detailu;
  `applying` efekt po tvrdém pádu musí další podkrok serverově reconciliovat.
- Privátní GHCR image umí workflow pushnout repository-scoped `GITHUB_TOKEN`,
  ale control plane nemá podporovaný krátkodobý registry credential pro pull.
  Nepřidávej uživatelský PAT classic; navrhni managed OCI registry s project-
  scoped credentials, nebo agent-mediated artifact transport (ADR-046).
- Neexistuje reálný public-SaaS deploy profil bez Gitey.
- Není připojený SMTP/e-mail provider. Self-hosted odkazy v UI/logu jsou demo
  mechanismus, ne produkční důkaz vlastnictví e-mailu; SaaS ukládá jen GitHubem
  ověřenou adresu.

## Nejbližší implementační pořadí

1. Proveď živý GitHub E2E nového routingu: personal/org create, kompatibilní
   import, Actions/Check Runs, retry, role, suspend/uninstall a delete/detach.
2. Nad hotový effect journal doplň startup crash reconciliation, workspace
   seznam provisioning operací a idempotentní retry/cleanup.
3. Rozhodni a implementuj SaaS artifact transport (managed OCI registry versus
   agent), potom vytvoř skutečný SaaS deploy profil bez Gitey.

GitLab je až následující adapter a nesmí blokovat Gitea školní E2E.

## Ověření před dalším handoffem

- Aktuálně: 36 API suites / 225 testů, API build a web `tsc -b && vite build`
  jsou zelené. Compose config prošel; API/web kontejnery byly přestavěné a API
  je healthy bez modulárního DI cyklu.
- Lokální existující Docker DB migraci aplikovala úspěšně; tři legacy
  projekty zachovaly URL a dostaly reálná Gitea repository ID. Health a
  nepřihlášený browser smoke prošly. Aditivní migrace
  `20260720200000_provisioning_effect_journal` je na stejné DB aplikovaná a
  přestavěné API je healthy.
- Stále je nutný úplný autentizovaný browser acceptance a živý GitHub App E2E.
  Lokální `deploy/.env` je `saas`; propojení identity a osobní instalace
  `kudrle01` byly uživatelsky ověřeny. Organizace zatím živě ověřena nebyla.
- Identity acceptance: self-hosted open/admin-provisioned onboarding, forced
  change, reset/deaktivace; v týmu přidej dva existující účty a ověř role v
  privátním SCM i tenant isolation.
- SaaS acceptance: GitHub-only login, žádný password formulář/API fallback,
  první účet zůstane běžný uživatel a poslední sign-in identitu nelze odpojit.
- GitHub installation acceptance se živou App: owner/admin spustí setup v
  osobním i týmovém workspace, member jej spustit nesmí; ověř user/org,
  rename, suspend/uninstall a odmítnutý replay callbacku. Setup URL je
  `/api/scm/github/setup/callback`.
- GitHub project acceptance: New project musí ukázat pouze granty aktivního
  workspace; ověř personal i organization repo, `.github/workflows/ci.yml`,
  Actions run a Check Runs. Import bez Dockerfile nebo InitPad workflow musí
  zůstat zablokovaný. Privátní GHCR deploy se zatím neočekává jako produkčně
  zelený, dokud nebude dokončen artifact transport.
- Po browser testu odstraň dočasné účty, workspaces a repozitáře.
- U každého milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` a uveď, zda a
  jak je uživatelsky testovatelný.
