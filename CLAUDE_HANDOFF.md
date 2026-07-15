# InitPad — handoff pro dalšího implementátora

Nejdřív přečti `AGENTS.md`, `DECISIONS.md` (hlavně ADR-027 a ADR-039) a
`PRODUCT_ROADMAP.md`. Pokračuj po malých atomických commitech, neupravuj historii
a zachovej existující uživatelská data.

## Závazný produktový model

- Žádná `Course` doména ani `Join course`. Škola je use case, ne jiný login.
- Jediná organizační/autorizační hranice je `Workspace` + `WorkspaceMember`.
- Public SaaS: GitHub login/link, GitHub App, GitHub Actions a GHCR. Bez SaaS Gitey.
- Self-hosted: vestavěná Gitea; instance admin spravuje onboarding a uživatele.
- GitHub App instalace je nutná pro create/import GitHub repa, ne pro vznik účtu.
- Onboarding (ADR-042): dva registrační režimy — `open` (veřejné, samoobsluha) a
  `admin-provisioned` (soukromé, účty zakládá admin + aktivační odkaz). Do týmu se
  přidávají jen existující účty podle username/e-mailu; žádné tokenové pozvánky.

## Nejbližší milník — identity a workspace onboarding

Kroky 1–4 jsou hotové (ADR-040). Zbývá krok 5 — GitHub adapter.

1. [hotovo] Registration policy zjednodušená na dva režimy (ADR-042): `open`
   (veřejné) a `admin-provisioned` (soukromé); `invite-only`/`first-user`/`closed`
   jsou tiché aliasy. Bezpečný first-user bootstrap administrátora zachován.
2. [hotovo] Platform-admin API a UI pro seznam, vytvoření, deaktivaci a reset
   uživatelů self-hosted instance. Vytvoření vrátí dočasné heslo i **aktivační
   odkaz** (uživatel si nastaví heslo a je přihlášen); ukládá se jen hash a
   serverově se vynutí změnu hesla. Provisioning/rollback konzistentní s Giteou.
3. [hotovo, zjednodušeno v ADR-042] Členství v týmu **jen pro existující účty**
   přes přímé přidání podle username/e-mailu (addMember), se synchronizací Gitea
   collaboratora. Tokenový `WorkspaceInvitation` systém byl odstraněn jako
   redundantní.
4. [hotovo] Ověření e-mailu, bezpečný reset hesla a rate limiting. Tokeny se
   nikdy neukládají v plaintextu a reset zneplatní staré sessions.
5. [rozpracováno] Vytvoř `ScmProvider` a odděl stávající Gitea adapter od GitHub SaaS
   adapteru. GitHub identitu ukládej podle immutable provider user ID; repo access
   řeš krátkodobými installation tokeny a minimálními permissions.
   - Hotovo (ADR-041): rozhraní `ScmProvider` + token `SCM_PROVIDER`, Gitea adapter,
     projektová doména na rozhraní; `ExternalIdentity` podle immutable ID;
     `GitHubAppService` (App JWT + installation tokeny, minimální oprávnění, inertní
     bez konfigurace); GitHub OAuth flow (sign-in/link přes immutable ID) s CSRF
     state + nonce, `/me/identities` list/unlink a UI „Continue with GitHub" a
     propojení v Settings; `GitHubInstallation` evidence instalací synchronizovaná
     podepsanými webhooky (`/scm/github/webhook`), ražení tokenu pro ownera a
     status/preflight (`/scm/github/status`) s „Install GitHub App" v UI; vše
     inertní bez konfigurace.
   - Hotovo (Fáze 3, přes `ScmProvider`, zatím Gitea): import existujícího repa —
     `listRepositories`/`readFile` na rozhraní, `GET /projects/import/repos`,
     `POST /projects/import/preflight` (branch/Dockerfile/runtime/kolize/prázdné) a
     `POST /projects/import` (záznam nad existujícím repem bez přepsání kódu, per-repo
     CI secret, prostředí `empty`, rollback DB delete) + UI stránka Importu.
     Persistentní `ProvisioningOperation` (audit + kroky) pro create i import;
     `GET /projects/:id/provisioning` a banner na detailu projektu.
   - Zbývá: vytvoření GitHub-only účtu při prvním loginu (vyžaduje edition-neutral
     `User` — `giteaId`/`accessToken` volitelné); GitHub `ScmProvider` adapter
     (create/import/list/checks/secrets) za stejným tokenem, který použije
     `GitHubInstallationService.tokenForOwner`. Plná GitHub implementace nesmí
     blokovat Gitea E2E; GitLab až potom.

## Povinné ověření

- API unit testy, API/web production build, Prisma migration na existující DB,
  `docker compose config` a browser acceptance test.
- Otestuj nejméně: normální registraci, admin-provisioned forced password
  change, pozvání dvou účtů do týmu, role v privátním SCM a tenant isolation.
- Po browser testu smaž všechny dočasné účty, workspaces a repozitáře.
- U každého milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` a napiš,
  zda a jak jej lze uživatelsky otestovat.
