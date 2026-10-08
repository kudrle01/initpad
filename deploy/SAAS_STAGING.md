# Staging veřejného SaaS podle ADR-132

Tento postup sestavuje neveřejný staging z vrstev zvolených v
[ADR-132](../docs/adr/ADR-132.md). Doplňuje obecný
[kontrakt SaaS profilu](./README.md#kontrakt-veřejného-saas-stagingu) o
konkrétní projekci secretů, edge tunel a collector.

Dne 8. října 2026 byly s releasem 0.2.14 naživo provedeny tyto části: projekce
třinácti souborů se secrety, start API proti externí databázi a úložišti, start
webu a připojení tunelu. Veřejný origin zvenku vrátil přihlašovací stránku a
`/api/health/ready` potvrdil databázi i úložiště artefaktů. Prošly také
kontroly `./saas-acceptance.sh dependencies` a `./saas-acceptance.sh email`.
**Obnova, úplný průchod GitHub App ani ostatní gate ze
[SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md) zatím neproběhly.**

Web z releasu 0.2.14 se v SaaS profilu sám nespustí, protože profil odebíral
nginxu i oprávnění potřebná ke startu. Oprava je v `saas.compose.yml` od
releasu 0.2.16; staging na něj přešel 9. října 2026 a web se spustil bez
úprav. Pouze nasazení tagu `initpad-v0.2.14` vyžaduje ke každému volání
`docker compose` nad `saas.compose.yml` ještě dočasný soubor mimo checkout,
připojený dalším přepínačem `-f`:

```yaml
services:
  web:
    cap_add: [CHOWN, SETGID, SETUID, NET_BIND_SERVICE]
```

Postup nepokrývá default-deny egress ani sběr JSON logů kontejnerů. Oba body
zůstávají samostatnými gate podle [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md) a
[pravidel observability](../docs/OBSERVABILITY.md).

## Účty a hodnoty

Každý účet zakládá provozovatel. Hodnoty označené jako secret patří pouze do
správce secretů, nikdy do env souboru, repozitáře ani chatu.

| Služba        | Co založit                                                                 | Co z ní InitPad potřebuje                                  |
| ------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Doména        | vlastní doména s nameservery přesměrovanými na Cloudflare                  | veřejný origin `https://<origin>`                          |
| Cloudflare    | zónu domény a vzdáleně spravovaný Tunnel s hostname `<origin>` na `http://127.0.0.1:8080` | secret: token tunelu                        |
| Cloudflare R2 | privátní bucket a API token omezený na čtení a zápis objektů tohoto bucketu | endpoint, název bucketu; secret: access key ID a secret key |
| Hetzner Cloud | server s Ubuntu LTS, 2 vCPU a 4 GB; firewall povolující příchozí pouze SSH z adresy provozovatele | přístup přes SSH klíč                    |
| Supabase      | projekt v regionu EU                                                       | secret: connection string session pooleru s `sslmode=require` |
| Infisical     | projekt, prostředí `staging` a machine identity s Universal Auth a právem číst | ID projektu; secret: client ID a client secret          |
| Brevo         | ověřenou odesílací doménu s DKIM a SMTP klíč                               | SMTP host, port 587, login; secret: SMTP klíč              |
| Grafana Cloud | stack v regionu EU a token pro zápis přes OTLP                             | secret: OTLP endpoint a hlavička `Basic <base64(ID:token)>` |
| GitHub        | testovací organizaci a GitHub App podle [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md#github-app-a-ruční-e2e-instalace) | App ID, Client ID, slug; secret: client secret, privátní klíč, webhook secret |

Firewall serveru nesmí otevírat porty 80 ani 443. Jedinou veřejnou cestou je
tunel, který z hostu navazuje pouze odchozí spojení.

Poskytovatelé VM často blokují odchozí SMTP porty. Hetzner Cloud blokuje porty
25 a 465, port 587 používaný s povinným STARTTLS nikoli. Poskytovatel, který
blokuje i port 587, vyžaduje alternativní port relay serveru, u Breva 2525;
skutečné předání zprávy ověří `./saas-acceptance.sh email`. Odesílací doménu
ověřujte na samostatné subdoméně, například `mail.<doména>`. Jméno, na kterém
tunel vytvořil záznam pro `<origin>`, další DNS záznamy nést nemůže.

Bucket R2 vytvořený v jurisdikci EU je dostupný pouze přes endpoint
`https://<ID účtu>.eu.r2.cloudflarestorage.com`. Bezplatný limit úložiště je
menší než výchozí kvóta artefaktů jednoho workspace, proto na stagingu zkraťte
`INITPAD_ARTIFACT_RETENTION_DAYS` a snižte kvótu workspace.

## Secrety v Infisicalu

Do prostředí `staging` uložte tyto položky. Agent každou z nich zapíše do
jednoho souboru v `/secure/runtime/secrets/`.

| Název v Infisicalu                      | Soubor                 | Původ                              |
| --------------------------------------- | ---------------------- | ---------------------------------- |
| `DATABASE_URL`                          | `database_url`         | Supabase                           |
| `INITPAD_JWT_SECRET`                    | `jwt_secret`           | vygenerovat                        |
| `INITPAD_ENCRYPTION_KEY`                | `encryption_key`       | vygenerovat, po nasazení neměnit   |
| `INITPAD_SCM_WEBHOOK_TOKEN`             | `scm_webhook_token`    | vygenerovat                        |
| `INITPAD_OIDC_CLIENT_SECRET`            | `oidc_client_secret`   | vygenerovat                        |
| `INITPAD_SMTP_PASSWORD`                 | `smtp_password`        | Brevo                              |
| `INITPAD_GITHUB_CLIENT_SECRET`          | `github_client_secret` | GitHub App                         |
| `INITPAD_GITHUB_PRIVATE_KEY`            | `github_private_key`   | GitHub App, celý PEM               |
| `INITPAD_GITHUB_WEBHOOK_SECRET`         | `github_webhook_secret` | vygenerovat, stejná hodnota v App |
| `INITPAD_ARTIFACT_S3_ACCESS_KEY_ID`     | `s3_access_key_id`     | Cloudflare R2                      |
| `INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY` | `s3_secret_access_key` | Cloudflare R2                      |
| `CLOUDFLARE_TUNNEL_TOKEN`               | `tunnel_token`         | Cloudflare Tunnel                  |
| `OTEL_BACKEND_OTLP_ENDPOINT`            | `otel_collector.env`   | Grafana Cloud                      |
| `OTEL_BACKEND_AUTHORIZATION`            | `otel_collector.env`   | Grafana Cloud                      |

Vygenerované hodnoty vytvořte náhodně, například `openssl rand -base64 48`, a
vložte je přímo do správce secretů. Změna `INITPAD_ENCRYPTION_KEY` po prvním
startu znepřístupní dříve zašifrovaná data.

## Příprava hostu

Všechny příkazy spouštějte jako root. Adresář se secrety je čitelný pouze pro
roota, proto jej Compose ani preflight pod jiným uživatelem nepřečtou.

1. Nainstalujte Docker Engine s pluginem Compose podle oficiální dokumentace.
2. Naklonujte repozitář na tag nasazovaného releasu a přejděte do `deploy/`.
3. Vytvořte runtime adresáře mimo checkout:

   ```bash
   install -d -m 0700 /secure/runtime /secure/runtime/secrets /secure/runtime/infisical
   ```

4. Do `/secure/runtime/infisical/client-id` a
   `/secure/runtime/infisical/client-secret` uložte údaje machine identity s
   právy `0400`. Je to jediný secret, který se na host přenáší ručně. Client ID
   je údaj metody Universal Auth, nikoli ID samotné identity, a client secret
   se zobrazí pouze jednou při vytvoření. Záměna končí v logu agenta chybou
   `401 Invalid credentials`.
5. Vytvořte konfiguraci agenta s ID projektu a spusťte projekci:

   ```bash
   sed 's/INFISICAL_PROJECT_ID/<ID projektu>/g' staging/infisical-agent.example.yaml \
     > /secure/runtime/infisical-agent.yaml
   docker compose -f staging/secrets.compose.yml up -d
   ```

   Účet v evropském cloudu Infisicalu vyžaduje v konfiguraci evropskou adresu
   instance.

6. Ověřte pouze názvy a velikosti souborů, nikdy jejich obsah:

   ```bash
   ls -l /secure/runtime/secrets
   ```

   Adresář musí obsahovat všech třináct neprázdných souborů z tabulky výše.

## Env soubor a spuštění

1. Zkopírujte `.env.saas.example` do `/secure/runtime/initpad-saas.env` a
   doplňte veřejné hodnoty. Cesty `*_FILE` z příkladu odpovídají souborům, které
   vytváří agent, a není nutné je měnit.
2. Immutable reference API, webu a Agenta převezměte z podepsaných release
   manifestů až poté, co pro daný tag projde
   `npm run audit:public-release -- --tag <tag>`.
3. Spusťte preflight a control plane:

   ```bash
   ./saas-check.sh /secure/runtime/initpad-saas.env
   docker compose --env-file /secure/runtime/initpad-saas.env -f saas.compose.yml up -d
   ```

4. Teprve potom spusťte tunel a collector. Připojují se k síti, kterou vytvořil
   předchozí krok:

   ```bash
   docker compose -f staging/edge.compose.yml up -d
   ```

   Dokud se tunel nepřipojí, vrací veřejný origin chybu Cloudflare 1033.

5. Pokračujte kontrolou závislostí a dalšími kroky ze
   [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md).

## Rotace secretu

Změňte hodnotu v Infisicalu a počkejte na další dotaz agenta, nejvýše pět
minut. Soubor na hostu se přepíše, běžící kontejner ale používá hodnotu načtenou
při startu. Službu, které se secret týká, proto restartujte, například
`docker compose --env-file /secure/runtime/initpad-saas.env -f saas.compose.yml restart api`,
a zopakujte kontrolu závislostí. Restart stačí, protože Docker při každém startu
kontejneru připojí soubory znovu; nové vytvoření kontejneru je nutné až při
změně konfigurace. Restart samotného agenta secretů službu neobnoví. Do záznamu
uveďte název secretu, čas a výsledek, nikoli hodnotu.

## Zrušení stagingu

Zastavte oba pomocné projekty i control plane, smažte server, tunel, bucket,
databázový projekt a machine identity a zneplatněte všechny vydané tokeny.
Staging je disposable; jeho data nejsou zálohou.
