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

Od ADR-144 web spouští nginx bez roota a profil mu žádnou capability nevrací.
Obraz webu a `saas.compose.yml` proto musí pocházet ze stejného releasu.

Od [ADR-158](../docs/adr/ADR-158.md) kit obsahuje také default-deny egress,
sběr JSON logů kontejnerů, pravidla alertů a kontrolu edge. Egress firewall a
kontrola edge prošly na stagingu s releasem 0.2.19 dne 25. října 2026. Sběr logů
na stagingu běží; alerty a telemetry-gap acceptance zatím neproběhly.

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
   Před prvním spuštěním kontejnerů doplňte do `/etc/docker/daemon.json`
   labely pro sběr logů a jejich rotaci a restartujte Docker:

   ```json
   {
     "log-driver": "json-file",
     "log-opts": {
       "labels": "com.docker.compose.project,com.docker.compose.service",
       "max-size": "20m",
       "max-file": "5"
     }
   }
   ```

   Nastavení platí jen pro nově vytvořené kontejnery. Kontejner vytvořený
   dříve je nutné vytvořit znovu, jinak jeho logy collector zahodí.
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
   docker compose --env-file /secure/runtime/initpad-saas.env -f staging/edge.compose.yml up -d
   ```

   Env soubor dodá collectoru veřejný origin pro kontrolu readiness. Dokud se
   tunel nepřipojí, vrací veřejný origin chybu Cloudflare 1033.

5. Pokračujte kontrolou závislostí a dalšími kroky ze
   [SAAS_ACCEPTANCE.md](./SAAS_ACCEPTANCE.md).

## Dashboard v Grafaně

Soubor [`staging/grafana-dashboard.json`](./staging/grafana-dashboard.json)
obsahuje dashboard nad dvěma vlastními metrikami API: počet požadavků a dobu
jejich zpracování. V Grafaně jej naimportujte přes **Dashboards → New →
Import** a jako zdroj dat ponechte Prometheus zdroj stacku. Dashboard
nezobrazuje logy ani traces a jeho prahy odpovídají výchozím alertům z
[pravidel observability](../docs/OBSERVABILITY.md#základ-alertů). API odesílá
metriky jednou za minutu, proto se první hodnoty objeví se zpožděním a jen
tehdy, když na API přicházejí požadavky.

## Sběr logů

Collector z [`staging/otel-collector.yaml`](./staging/otel-collector.yaml) čte
soubory logů kontejnerů pouze pro čtení a ponechá jen řádky projektu
`initpad-saas`. Záznamy API rozloží na atributy včetně `requestId`, `traceId`
a `event`, řádky webu ponechá jako text. Logy odchází přes OTLP do Loki
stacku. Ověření po startu, bez výpisu obsahu:

```bash
docker compose --env-file /secure/runtime/initpad-saas.env -f staging/edge.compose.yml logs otel-collector | grep -ci error
```

Každý řádek dostane `service.name` podle služby, u API tedy `initpad-api`
stejně jako jeho traces a metriky. V Grafaně v **Explore** nad Loki zdrojem
musí dotaz `{service_name="initpad-api"}` vracet záznamy s polem `event`.

## Alerty

Pravidla v [`staging/alert-rules.yaml`](./staging/alert-rules.yaml) odpovídají
[základu alertů](../docs/OBSERVABILITY.md#základ-alertů). Lokálně je
otestujte a do Grafana Cloud nahrajte nástrojem `mimirtool`:

```bash
cd staging
docker run --rm --entrypoint promtool -v "$PWD:/w" -w /w prom/prometheus:v3.5.0 test rules alert-rules.test.yaml
mimirtool rules load alert-rules.yaml \
  --address=<Prometheus URL stacku> --id=<ID uživatele Prometheus> --key=<token s rules:write>
```

Token s právem `rules:write` vytvořte jen pro tento krok a poté jej
zneplatněte. V **Alerting → Contact points** nastavte e-mail provozovatele a
ve výchozí notifikační politice jej zvolte jako příjemce. Alert
`InitPadTelemetryGap` se zdrojem `scope: instance` se ozve i po plánovaném
restartu repliky; před jeho uzavřením ověřte, že nové ID instance posílá data.

Grafana Cloud Free drží metriky, logy i traces kratší dobu, než uvádí
výchozí minimum, a retenci neumožňuje změnit. Do záznamu acceptance uveďte
skutečnou retenci stacku a ověřte, že nejstarší testovací data po ní zmizela.

## Egress firewall

[`staging/egress-firewall.sh`](./staging/egress-firewall.sh) vynucuje
default-deny egress podle ADR-158. Spusťte jej až po startu Dockeru:

```bash
./staging/egress-firewall.sh apply
./staging/egress-firewall.sh verify /secure/runtime/initpad-saas.env
./saas-acceptance.sh dependencies /secure/runtime/initpad-saas.env
```

`verify` vypíše jen dosažitelnost testovacích cílů z hostu a z kontejneru v
síti control plane. Následná kontrola závislostí musí projít beze změny;
selže-li, ověřte port databáze a SMTP relay a upravte proměnné
`INITPAD_EGRESS_*` popsané v nápovědě skriptu. Pravidla obnoví po startu i
restartu Dockeru systemd unit:

```bash
sed "s#INITPAD_CHECKOUT#$(git rev-parse --show-toplevel)#" staging/initpad-egress.service \
  > /etc/systemd/system/initpad-egress.service
systemctl daemon-reload && systemctl enable --now initpad-egress.service
```

Odmítnutá spojení jsou v logu jádra s prefixem `initpad-egress-drop`
(`journalctl -k | grep initpad-egress-drop`). `remove` pravidla odstraní.

## Edge a WAF

Cloudflare Free poskytuje DDoS ochranu L3 až L7 automaticky a bez nastavení.
V zóně domény nastavte:

1. **Security → WAF → Managed rules:** zapnutý *Cloudflare Free Managed
   Ruleset*.
2. **Security → WAF → Rate limiting rules:** jedno pravidlo pro cestu
   začínající `/api/`, počítání podle IP, 100 požadavků za 10 sekund, akce
   *Block* na 10 sekund. Bezplatný plán dovoluje jediné pravidlo s pevnou
   periodou; podmínky před nastavením ověřte, v roce 2026 se několikrát měnily.
3. **SSL/TLS → Overview:** režim *Full* zvolený ručně, ne *Automatic*, aby se
   při dalším skenu nezměnil. Provoz přes tunel režim nepoužívá; nastavení
   chrání pouze případné záznamy mimo tunel.
4. **SSL/TLS → Edge Certificates:** *Always Use HTTPS*, *Minimum TLS Version*
   TLS 1.2 a HSTS bez *includeSubDomains* a *Preload*. Disposable stagingu
   stačí *Max Age* jeden měsíc; hlavičku `nosniff` posílá web sám, proto
   volbu *No-Sniff* nechte vypnutou. SaaS profil hlavičku HSTS jinak neposílá.

Z vlastního počítače, nikoli z hostu, pak spusťte:

```bash
./staging/edge-check.sh https://<origin> <veřejná IP serveru>
```

Kontrola ověří odpověď přes edge, zavřené porty originu, odmítnutí těla nad
1 MiB a blokaci dávky pravidlem na edge. Dávka dočasně zablokuje vaši adresu
na deset sekund.

## Incident runbook

Postup se řídí [obecným postupem při incidentu](../docs/OBSERVABILITY.md#postup-při-incidentu).
Na tomto stagingu platí:

| Alert | První kontrola na hostu |
| ----- | ----------------------- |
| `InitPadApiUnavailable` | `docker compose --env-file /secure/runtime/initpad-saas.env -f saas.compose.yml ps`, stav tunelu v Cloudflare a `./saas-acceptance.sh dependencies` |
| `InitPadHighErrorRate` | logy API s `level` `error` v Grafaně, seskupené podle `event` |
| `InitPadHighLatency` | traces nejpomalejších požadavků; databáze Supabase a R2 mají vlastní stavové stránky |
| `InitPadTelemetryGap` | stav kontejneru `otel-collector`, jeho log a platnost tokenu v `otel_collector.env` |
| `InitPadMailOutboxFailed` | stav Breva a `./saas-acceptance.sh email`; obsah zpráv nevypisujte |
| `InitPadLeaderChurn` | restarty replik (`docker events --since 30m`) a dostupnost databáze |

Každý incident zapište s časem, verzí releasu, příčinou a nápravou do
`docs/RELEASE_READINESS.md` nebo roadmapy, bez secretů a těl požadavků.

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
