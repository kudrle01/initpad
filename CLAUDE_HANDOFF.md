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

## Nejbližší milník — identity a workspace onboarding

Kroky 1–4 jsou hotové (ADR-040). Zbývá krok 5 — GitHub adapter.

1. [hotovo] Edition-aware registration policy: `open`, `invite-only`,
   `admin-provisioned`; bezpečný first-user bootstrap administrátora zachován.
2. [hotovo] Platform-admin API a UI pro seznam, vytvoření, deaktivaci a reset
   uživatelů self-hosted instance. Vytvoření vrátí náhodné dočasné heslo pouze
   jednou, uloží jen hash a serverově vynutí změnu hesla před ostatními operacemi.
   Provisioning/rollback zůstává konzistentní s Giteou.
3. [hotovo] Skutečné workspace invitations pro existující i nový e-mail:
   hashovaný jednorázový token, expirace, role, revoke, accept a audit. Bez SMTP
   se odkaz zobrazí ownerovi jednou; po přijetí se synchronizuje Gitea collaborator.
4. [hotovo] Ověření e-mailu, bezpečný reset hesla a rate limiting. Tokeny se
   nikdy neukládají v plaintextu a reset zneplatní staré sessions.
5. [další krok] Vytvoř `ScmProvider` a odděl stávající Gitea adapter od GitHub SaaS
   adapteru. GitHub identitu ukládej podle immutable provider user ID; repo access
   řeš krátkodobými installation tokeny a minimálními permissions.

## Povinné ověření

- API unit testy, API/web production build, Prisma migration na existující DB,
  `docker compose config` a browser acceptance test.
- Otestuj nejméně: normální registraci, admin-provisioned forced password
  change, pozvání dvou účtů do týmu, role v privátním SCM a tenant isolation.
- Po browser testu smaž všechny dočasné účty, workspaces a repozitáře.
- U každého milníku aktualizuj `DECISIONS.md`, `PRODUCT_ROADMAP.md` a napiš,
  zda a jak jej lze uživatelsky otestovat.
