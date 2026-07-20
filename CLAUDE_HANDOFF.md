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
- GitHub App setup podle ADR-044: immutable installation account ID, osobní/
  organizační účet, hashovaný single-use state, serverové ověření callbacku,
  owner/admin re-check a explicitní user/workspace grant. Rename zachová vazbu;
  uninstall je auditní tombstone a zablokuje token. Osobní instalace má
  bezpečný recovery tok pro případ, že GitHub nevyvolá Setup callback:
  platný pending state + owner/admin + shoda immutable GitHub user ID; pro
  organizace se tento fallback nepoužívá. Organizace prochází user-bound OAuth
  kontrolou `/user` + `/user/installations`; krátkodobý token se neukládá.
- `GitHubScmProvider` obsahuje čtecí operace a část HTTP mutací. Jeho tokeny jsou
  operation-specific; webhook při chybě persistence vrací 5xx. Adapter má
  stránkování, archiv refu, lokální git init, user/org GHCR cleanup a Actions
  secrets šifrované `libsodium-wrappers` sealed boxem.
- Audit 2026-07-17 opravil: native auth v SaaS, automatického prvního SaaS admina,
  odpojení poslední použitelné identity, ověření GitHub e-mailu, atomický claim
  jednorázových tokenů, oddělení platformního hesla od lokálního hesla Gitey a
  OIDC kontrolu deaktivace/session generation/forced-change před Gitea SSO.

## Co dokončeno není

- `ScmRegistry` zatím nikdo z projektové domény nepoužívá; `SCM_PROVIDER` je stále
  Gitea. GitHub create/import proto nefunguje.
- GitHub `provision` a push scaffoldu jsou stále stuby. Osobní `POST /user/repos`
  vyžaduje rotovatelný GitHub App user token; doplň šifrovaný token vault a
  refresh rotaci. Organizace může vytvořit repo installation tokenem.
- GitHub Actions workflow varianta (`.github/workflows`, automatický
  `GITHUB_TOKEN` pro GHCR) ještě není v šablonách/generátoru.
- `ProvisioningOperation` pro create nemá podrobné kroky; rollback importu
  nemusí vrátit všechny externí změny a neúspěšný create bez Project ID není v UI.
- Neexistuje reálný public-SaaS deploy profil bez Gitey.
- Není připojený SMTP/e-mail provider. Self-hosted odkazy v UI/logu jsou demo
  mechanismus, ne produkční důkaz vlastnictví e-mailu; SaaS ukládá jen GitHubem
  ověřenou adresu.

## Nejbližší implementační pořadí

1. Doplň šifrovaný rotovatelný GitHub user-token vault a GitHub Actions variantu
   šablon; dokonči personal/org create a scaffold push.
2. Zapoj `ScmRegistry` podle workspace instalace/provideru projektu a proveď rollback/
   reconciliation testy.
3. Až poté spusť živý GitHub E2E a vytvoř skutečný SaaS deploy profil.

GitLab je až následující adapter a nesmí blokovat Gitea školní E2E.

## Ověření před dalším handoffem

- Aktuálně: 33 API suites / 191 testů, API build a web `tsc -b && vite build`
  jsou zelené. Compose config a Prisma schema validate prošly.
- Lokální existující Docker DB migraci aplikovala úspěšně; tři legacy
  projekty zachovaly URL a dostaly reálná Gitea repository ID. Health a
  nepřihlášený browser smoke prošly.
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
- Po browser testu odstraň dočasné účty, workspaces a repozitáře.
- U každého milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` a uveď, zda a
  jak je uživatelsky testovatelný.
