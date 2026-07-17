# InitPad — aktuální handoff pro dalšího implementátora

Nejdřív přečti `AGENTS.md`, `DECISIONS.md` (zejména ADR-027, ADR-030,
ADR-039 a ADR-042/043) a `PRODUCT_ROADMAP.md`. Pokračuj po malých atomických
commitech, neupravuj historii a zachovej existující data. Tvrzení „hotovo“ musí
být podložené testem; existence rozhraní nebo nepoužívaného registru nestačí.

## Závazný produktový model

- Žádná `Course` doména ani `Join course`; škola je use case nad workspaces.
- Autorizační hranice je `Workspace` + `WorkspaceMember`.
- Self-hosted: vestavěná Gitea a `open` nebo `admin-provisioned` onboarding.
- Public SaaS: GitHub login, GitHub App, GitHub Actions a GHCR; bez SaaS Gitey
  a bez vlastních hesel InitPadu.
- GitHub App instalace je podmínka create/import repozitáře, ne vytvoření účtu.
- Do týmu se přidávají existující účty podle username/e-mailu; tokenové
  workspace pozvánky byly odstraněny v ADR-042.

## Co je skutečně dokončeno

- Workspaces/RBAC, edition-aware identity lifecycle, platform-admin správa
  self-hosted účtů, aktivační odkazy, forced password change, reset/verifikace
  a přidání existujícího účtu do týmu se synchronizací Gitea collaboratora.
- `ScmProvider` šev s aktivním Gitea adapterem.
- Explicitní SCM identita projektu: provider, immutable repository ID,
  owner/name/full name, default branch a installation binding. Import vybírá
  podle ID; CI/reconcile/archive/deploy/delete používají `ScmRepositoryRef`.
  Legacy Gitea řádky dostanou bezpečný backfill a provider reconciliation.
- Import osobního Gitea repozitáře: list, preflight, import bez přepsání kódu,
  per-repo CI secret, prostředí `empty` a základní `ProvisioningOperation`.
- GitHub OAuth sign-in/link podle immutable user ID, CSRF state+nonce,
  `ExternalIdentity`, podepsané installation webhooky a krátkodobé tokeny.
- `GitHubScmProvider` obsahuje čtecí operace a část HTTP mutací. Jeho tokeny jsou
  operation-specific; webhook při chybě persistence vrací 5xx.
- Audit 2026-07-17 opravil: native auth v SaaS, automatického prvního SaaS admina,
  odpojení poslední použitelné identity, ověření GitHub e-mailu, atomický claim
  jednorázových tokenů, oddělení platformního hesla od lokálního hesla Gitey a
  OIDC kontrolu deaktivace/session generation/forced-change před Gitea SSO.

## Co dokončeno není

- `ScmRegistry` zatím nikdo z projektové domény nepoužívá; `SCM_PROVIDER` je stále
  Gitea. GitHub create/import proto nefunguje.
- `GitHubInstallation` ukládá mutable login, ne immutable account ID; chybí setup
  callback a autorizovaná vazba instalace na uživatele/workspace.
- GitHub `provision`, push scaffoldu, `configureRepoSecrets`, runtime secrets,
  `downloadArchive` a `initLocal` jsou stuby. Actions secrets vyžadují knihovní
  libsodium sealed-box implementaci; nevymýšlet vlastní kryptografii.
- GHCR cleanup nerozlišuje user/org cestu, seznam repozitářů nemá stránkování.
- `ProvisioningOperation` pro create nemá podrobné kroky; rollback importu
  nemusí vrátit všechny externí změny a neúspěšný create bez Project ID není v UI.
- Neexistuje reálný public-SaaS deploy profil bez Gitey.
- Není připojený SMTP/e-mail provider. Self-hosted odkazy v UI/logu jsou demo
  mechanismus, ne produkční důkaz vlastnictví e-mailu; SaaS ukládá jen GitHubem
  ověřenou adresu.

## Nejbližší implementační pořadí

1. Rozšiř GitHub installation model o immutable account ID, setup callback,
   user/workspace binding a podporu organizací/rename.
2. Dokonči GitHub create/import, libsodium Actions secrets, archive a push.
3. Zapoj `ScmRegistry` podle provideru uloženého u projektu a proveď rollback/
   reconciliation testy.
4. Až poté spusť živý GitHub E2E a vytvoř skutečný SaaS deploy profil.

GitLab je až následující adapter a nesmí blokovat Gitea školní E2E.

## Ověření před dalším handoffem

- Aktuálně: 30 API suites / 162 testů, API build a web `tsc -b && vite build`
  jsou zelené. Compose config a Prisma schema validate prošly.
- Lokální existující Docker DB migraci aplikovala úspěšně; tři legacy
  projekty zachovaly URL a dostaly reálná Gitea repository ID. Health a
  nepřihlášený browser smoke prošly.
- Stále je nutný autentizovaný browser acceptance a živý GitHub App E2E.
  Lokální `deploy/.env` je nyní `saas`, ale nemá nakonfigurovaný GitHub login,
  takže browser správně skončil na hlášce o chybějící konfiguraci.
- Identity acceptance: self-hosted open/admin-provisioned onboarding, forced
  change, reset/deaktivace; v týmu přidej dva existující účty a ověř role v
  privátním SCM i tenant isolation.
- SaaS acceptance: GitHub-only login, žádný password formulář/API fallback,
  první účet zůstane běžný uživatel a poslední sign-in identitu nelze odpojit.
- Po browser testu odstraň dočasné účty, workspaces a repozitáře.
- U každého milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` a uveď, zda a
  jak je uživatelsky testovatelný.
