# Hranice OpenTelemetry Collectoru

Soubor `otel-collector.example.yaml` je technologicky neutrálním výchozím
bodem pro Collector spravovaný provozovatelem infrastruktury. Přijímá pouze
OTLP/HTTP traces a metriky z replik InitPad API, uplatňuje paměťové a dávkové
limity a předává oba typy signálů do privátního backendu.

Collector spusťte ve stejné privátní síti jako API a nastavte:

```ini
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

Adresa backendu a autorizační hlavička jsou secrety Collectoru:

```ini
INITPAD_OBSERVABILITY_BACKEND_OTLP_ENDPOINT=https://observability.example/otlp
INITPAD_OBSERVABILITY_BACKEND_AUTHORIZATION=Bearer REPLACE
```

Tyto hodnoty nevkládejte do souboru InitPad `.env` ani je necommitujte.
Zkontrolovanou konfiguraci Collectoru připojte pouze pro čtení a její secrety
vložte prostřednictvím správce secretů daného prostředí. Strukturované JSON
logy API na standardním výstupu zpracovává běžný log collector runtime
prostředí. Export logů z OpenTelemetry JavaScript se nepoužívá, dokud je jeho
SDK experimentální.

Ukázková konfigurace záměrně neurčuje konkrétní úložiště. Před produkčním
nasazením připojte udržovaný backend, zaveďte pravidla retence, přístupu a
alertingu popsaná v [pravidlech observability](../../docs/OBSERVABILITY.md) a
proveďte jejich staging acceptance. Collector, který signály pouze vypisuje,
není produkční řešení.
