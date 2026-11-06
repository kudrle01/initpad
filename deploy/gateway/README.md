# Spravovaná brána pro Agenta (produkční reference)

> Pro běžnou instalaci to nepotřebujete. Příkaz z **Manage Agent** obsahuje
> `--gateway-domain` a bránu postaví sám (ADR-165, [README Agenta](../../apps/agent/README.md)).
> Tato složka je ruční varianta přes Docker Compose, pro případy, kdy chcete
> bránu mít pod vlastní správou nebo použít vlastní CA.

Referenční nasazení brány, kterou InitPad Agent potřebuje pro režim
**Spravovaná brána** (ADR-073). Dává aplikacím stálé HTTPS adresy
`https://<projekt>-<prostředí>-<id>.<doména>` místo náhodných portů. Zdůvodnění a
bezpečnostní hranice jsou v [ADR-164](../../docs/adr/ADR-164.md).

Funguje stejně v laboratoři i v produkci. Liší se jen zdroj certifikátů:
vlastní vnitřní CA (tento adresář), nebo veřejná CA. Ke každé instalaci
patří vlastní hodnoty v `.env`; nic z této složky nenese secrety.

## Co běží

| Část | Úloha | Poznámka |
|---|---|---|
| `edge` | Caddy na portech 80 a 443, ukončuje TLS | Jediná část publikovaná ven. Certifikáty získává od CA přes ACME a obnovuje je sám. |
| `gateway` | Vnitřní Caddy s labelem `com.initpad.gateway=true` | Agent ho konfiguruje přes Unix socket, publikuje se žádný port. Nemá Docker socket. |
| `ca` | Vnitřní certifikační autorita (`step-ca`) | Volitelná, profil `ca`. Nepotřebujete ji, pokud už vnitřní CA máte. |

Všechny kontejnery mají `read_only`, `cap_drop: ALL`, `no-new-privileges`,
limity paměti, CPU a procesů a image připnuté digestem.

## Požadavky

- Server s Agentem: Linux s Dockerem a Compose pluginem, volné porty 80 a 443.
- **DNS** v zóně, kterou spravujete (např. na DC): záznam `A` pro zvolenou
  doménu a wildcard `A` na stejnou IP serveru.

  | Název | Typ | Hodnota |
  |---|---|---|
  | `apps.example.lan` | A | IP serveru |
  | `*.apps.example.lan` | A | IP serveru |

- Doména **nesmí končit na `.local`**. Ta je vyhrazená pro mDNS a Linux ji
  často nepošle na váš DNS server. Použijte `.lan`, `home.arpa` nebo
  subdoménu domény, kterou vlastníte.
- Kontejner CA musí přeložit jméno brány a dosáhnout na její porty 80 a 443
  (ověření vlastnictví jména). To za vás řeší DNS z předchozího bodu.

## Postup

```sh
cd deploy/gateway
cp .env.example .env        # upravte GATEWAY_DOMAIN a GATEWAY_CA_HOST
sudo ./setup.sh
```

`setup.sh` vytvoří heslo CA (`secrets/ca_password`, zálohujte ho), spustí CA,
exportuje její kořenový certifikát do `ca-root.crt` a spustí bránu. Na konci
vypíše otisk SHA-256 kořene.

### 1. Důvěra v kořenový certifikát

Soubor `ca-root.crt` obsahuje jen veřejný certifikát. Otisk ověřte na každém
stroji, kam ho kopírujete.

- **Prohlížeče a počítače uživatelů:** nainstalujte ho do úložiště důvěryhodných
  kořenových CA (ve Windows doménu to uděláte jednou přes GPO).
- **Agent:** předejte ho instalátoru jako `--ca-file`. Instalátor přijímá jeden
  soubor, ale PEM smí obsahovat víc certifikátů. Pokud už Agent používá CA
  samotného InitPadu, spojte oba do jednoho souboru:

  ```sh
  cat /etc/initpad-agent/ca.crt ca-root.crt > /etc/initpad-agent/trust-bundle.crt
  ```

### 2. Agent

K příkazu z **Manage Agent** přidejte:

```
--gateway-container initpad-gateway \
--gateway-admin-socket /var/lib/initpad-gateway-admin/admin.sock \
--ca-file /etc/initpad-agent/trust-bundle.crt
```

### 3. Server v InitPadu

V **Přidat server** zvolte **Zpřístupnění aplikací → Spravovaná brána** a jako
veřejnou URL zadejte `https://<GATEWAY_DOMAIN>`. Pak v **Manage Agent** spusťte
**Otestovat bránu**. Musí projít DNS, TLS i připravenost Caddy.

## Jak se vydávají certifikáty

- Základní doména se získá při startu.
- Aplikační jména se certifikují při prvním použití. Edge se před každým
  vydáním zeptá lokálního endpointu `127.0.0.1:5555`, který povolí jen jména
  končící na `.<GATEWAY_DOMAIN>`. Cizí jména dostanou odmítnutí, takže přes
  bránu nejde vyžádat certifikát pro jinou doménu.
- Obnovu dělá Caddy sám. `step-ca` vydává certifikáty s výchozí platností
  **24 hodin**, takže CA musí běžet nepřetržitě. Při výpadku delším než zhruba
  16 hodin certifikáty vyprší. Pro méně strmý provoz prodlužte platnost v
  `ca.json` provisioneru `acme` (`claims.defaultTLSCertDuration`).

## Provoz

- **Záloha:** `secrets/ca_password` a volume `ca-data` (privátní klíč CA).
  Bez nich se CA nedá obnovit a všichni klienti by museli důvěřovat novému
  kořeni.
- **Aktualizace:** změňte digest image v `docker-compose.yml` a spusťte
  `docker compose up -d`. Brána drží routy v `gateway-config`, takže přežije
  restart.
- **Ověření:** `docker compose logs edge | grep "certificate obtained"`.
- **Vlastní nebo veřejná CA:** spusťte `./setup.sh --no-ca`, do `.env` dejte
  `GATEWAY_CA_URL` (ACME adresář) a do `ca-root.crt` její kořen. U veřejné CA
  (Let's Encrypt) kořen nepotřebujete, odeberte řádek `acme_ca_root` z
  `Caddyfile`.

## Co tahle reference neřeší

- Vysokou dostupnost. Je to jedna brána na jednom serveru.
- Certifikáty pro wildcard přes DNS-01. Pro veřejnou doménu je vhodné je
  doplnit (ADR-073, bod 4).
- Odvolání certifikátů (CRL, OCSP). Krátká platnost je náhrada.
