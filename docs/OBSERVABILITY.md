# Kontrakt observability

InitPad produkuje tři odlišné druhy provozních důkazů. Auditní události
odpovídají na to, kdo změnu vyžádal, deployment operace popisují její trvalý
stav a telemetrie pomáhá operátorovi lokalizovat selhání za běhu. Telemetrie
nikdy není autorizační ani konzistenční hranicí.

## Signály

- API zapisuje omezené, redigované JSON logy na standardní výstup. Log collector
  runtime prostředí by měl tyto řádky přijímat bez přepisování `requestId`,
  `correlationId`, `traceId` nebo `spanId`.
- S nastavením `INITPAD_OTEL_ENABLED=true` každá replika API exportuje traces a
  metriky přes OTLP/HTTP na jeden privátní endpoint OpenTelemetry Collectoru.
- Automatická instrumentace pokrývá runtime Node, příchozí i odchozí HTTP,
  Nest/Express a podporované knihovny pro databázi a klienty. Health probes jsou
  z traces vyloučeny. Úspěšné probes jsou vyloučeny také z access logů.
- `initpad.http.requests` a `initpad.http.request.duration` jsou omezené vlastní
  metriky. Jejich atributy obsahují pouze metodu, číselný stav a třídu stavu.
  Surové cesty, query stringy, ID workspace a ID uživatelů v nich záměrně chybějí.
- Každý proces hlásí `service.name`, `service.version` platformy a nové
  `service.instance.id`. Stejná neprůhledná hodnota se objevuje v existující
  hlavičce `X-InitPad-Instance`, takže black-box active-active acceptance
  propojuje s telemetrií, aniž by se stala identitním credentialem.

Export ve self-hosted režimu je ve výchozím stavu vypnutý. Zapnutí vyžaduje:

```ini
INITPAD_OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=initpad-api
OTEL_METRIC_EXPORT_INTERVAL=60000
```

Endpoint může v privátní síti nasazení používat HTTP. Pokud překračuje hranici
důvěry, použijte HTTPS. Credentials, query parametry a fragmenty se odmítají.
Autentizace vůči dodavateli patří na collector, ne do konfigurace API.
Nedostupnost collectoru musí vyvolat alert na mezeru v telemetrii, ale nesmí
způsobit nedostupnost aplikace.

Compose kontrakt SaaS činí export OTLP povinným, ale nepřibaluje backend.
Collector a jeho úložiště jsou služby ve vlastnictví infrastruktury.
Technologicky neutrální výchozí konfigurace je v
[`deploy/observability`](../deploy/observability/README.md).

## Základ retence a přístupu

Dříve než operátor připustí nedůvěryhodné tenanty, zaznamená skutečnou politiku
backendu a ověří automatické mazání:

| Signál                       |         Výchozí minimum | Přístup                                                  |
| ---------------------------- | ----------------------: | -------------------------------------------------------- |
| Metriky                      |                 30 dní | on-call a provozovatelé platformy                        |
| Traces                       |                  7 dní | on-call a provozovatelé platformy                        |
| Strukturované aplikační logy |                 30 dní | on-call, bezpečnostní revize na základě výslovného práva |
| Auditní události             | produktová retenční politika | UI s oprávněním workspace a správci platformy      |

Jde o provozní výchozí hodnoty, nikoli o důvod uchovávat osobní údaje. Těla
požadavků a odpovědí, cookies, autorizační hlavičky, credentials v URL a hodnoty
tajných proměnných prostředí se nesmějí nikdy sbírat. Přístup do backendu i
změny jeho politiky se samy musí auditovat.

## Základ alertů

Názvy alertů jsou stabilní, i když se jazyk dotazů backendu liší:

| Alert                     | Počáteční práh                                                       | První krok                                                        |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `InitPadApiUnavailable`   | readiness selhává 2 minuty                                           | zkontrolujte edge, repliky API a PostgreSQL                       |
| `InitPadHighErrorRate`    | alespoň 20 požadavků a více než 2 % odpovědí 5xx po dobu 5 minut     | seskupte traces podle routy a stavu a prohlédněte související logy |
| `InitPadHighLatency`      | p95 nad 2 sekundy po dobu 10 minut                                   | oddělte latenci databáze, SCM, S3 a targetu                       |
| `InitPadTelemetryGap`     | 5 minut bez telemetrie z očekávané instance API                      | dříve než dashboardům uvěříte, ověřte dosažitelnost collectoru    |
| `InitPadMailOutboxFailed` | jakákoli koncová událost `mail.outbox.failed`                        | zkontrolujte stav relay bez výpisu zašifrovaných payloadů         |
| `InitPadLeaderChurn`      | více než 3 převzetí role leadera za 15 minut                         | zkontrolujte připojení k databázi a restarty replik               |

Prahy upravujte podle měření ze stagingu a počáteční politiku v produkci tiše
neoslabujte.

## Postup při incidentu

1. Zaznamenejte čas alertu, dotčený veřejný origin a verzi releasu. Do záznamu
   incidentu nekopírujte secrety ani těla požadavků.
2. Pomocí `requestId` nebo `correlationId` z odpovědi UI či API najděte
   strukturovaný log. Podle jeho `traceId` přejděte do backendu s traces.
3. Určete, zda selhání souvisí s edge, API, PostgreSQL, object storage, SCM nebo
   deployment targetem. Než označíte active-active incident za specifický pro
   jednu repliku, zkontrolujte alespoň dvě ID instancí API.
4. Upřednostněte zdokumentovaný rollback nebo odpojení targetu před ručními
   zásahy do databáze. Zachovejte historii auditu a deployment operací.
5. Po obnově zaznamenejte mezeru v detekci, dopad na zákazníky, nápravu a to, zda
   alert nebo retenční politika vyžaduje zkontrolovanou změnu.

## Staging acceptance

Gate observability je dokončen až poté, co živý běh na stagingu prokáže, že:

1. dvě repliky API emitují odlišné hodnoty `service.instance.id`,
2. jeden požadavek je propojen mezi access logem a trace pomocí `traceId`,
3. čítače požadavků a histogramy doby trvání přicházejí bez kardinality surových
   URL,
4. zastavení collectoru ponechá readiness API zdravou a vyvolá alert na mezeru v
   telemetrii,
5. jeho restart obnoví export bez restartu API a
6. prošlé testovací logy, traces a metriky backend skutečně smaže.

Konfigurace a unit testy stanovují hranici exportu, ale nepočítají se jako tento
živý produkční důkaz.
