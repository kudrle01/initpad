# Staging veřejného SaaS podle ADR-132

Tento postup sestavuje neveřejný staging z vrstev zvolených v
[ADR-132](../docs/adr/ADR-132.md). Doplňuje obecný
[kontrakt SaaS profilu](./README.md#kontrakt-veřejného-saas-stagingu) o
konkrétní projekci secretů, edge tunel a collector. Soubory v adresáři
[`staging/`](./staging/) prošly pouze statickou kontrolou a kontraktním testem;
**postup zatím nebyl proveden naživo** a první nasazení jej může upřesnit.

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
| DigitalOcean  | Droplet s Ubuntu LTS, 2 vCPU a 4 GB; firewall povolující příchozí pouze SSH z adresy provozovatele | přístup přes SSH klíč                    |
| Supabase      | projekt v regionu EU                                                       | secret: connection string session pooleru s `sslmode=require` |
| Infisical     | projekt, prostředí `staging` a machine identity s Universal Auth a právem číst | ID projektu; secret: client ID a client secret          |
| Brevo         | ověřenou odesílací doménu s DKIM a SMTP klíč                               | SMTP host, port 587, login; secret: SMTP klíč              |
| Grafana Cloud | stack v regionu EU a token pro zápis přes OTLP                             | secret: OTLP endpoint a hlavička `Basic <base64(ID:token)>` |
| GitHub        | testovací organizaci a GitHub App podle [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md#github-app-a-ruční-e2e-instalace) | App ID, Client ID, slug; secret: client secret, privátní klíč, webhook secret |

Firewall Dropletu nesmí otevírat porty 80 ani 443. Jedinou veřejnou cestou je
tunel, který z hostu navazuje pouze odchozí spojení.

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
   právy `0400`. Je to jediný secret, který se na host přenáší ručně.
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

5. Pokračujte kontrolou závislostí a dalšími kroky ze
   [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md).

## Rotace secretu

Změňte hodnotu v Infisicalu a počkejte na další dotaz agenta, nejvýše pět
minut. Soubor na hostu se přepíše, běžící kontejner ale používá hodnotu načtenou
při startu. Službu, které se secret týká, proto znovu vytvořte, například
`docker compose --env-file /secure/runtime/initpad-saas.env -f saas.compose.yml up -d --force-recreate api`,
a zopakujte kontrolu závislostí. Do záznamu uveďte název secretu, čas a
výsledek, nikoli hodnotu.

## Zrušení stagingu

Zastavte oba pomocné projekty i control plane, smažte Droplet, tunel, bucket,
databázový projekt a machine identity a zneplatněte všechny vydané tokeny.
Staging je disposable; jeho data nejsou zálohou.
