# Dokumentace InitPadu

Tento rozcestník odděluje cestu uživatele a správce od detailů určených
vývojářům projektu. Začni dokumentem, který odpovídá tomu, co právě potřebuješ
udělat.

## Instalace a provoz

- [Nasazení](../deploy/README.md) — požadavky, self-hosted instalace a SaaS
  deployment profil.
- [Provozní runbook](../deploy/OPERATIONS.md) — aktualizace, zálohy, obnova,
  HTTPS a řešení problémů.
- [Self-hosted acceptance](../deploy/SELF_HOSTED_ACCEPTANCE.md) — opakovatelné
  ověření instalace na samostatném Linux hostu.
- [Release readiness](RELEASE_READINESS.md) — co je ověřené a které produkční
  podmínky zůstávají otevřené.

## Architektura a vyhodnocení

- [Architektura](ARCHITECTURE.md) — komponenty, hranice důvěry a hlavní datové
  toky.
- [Architektonická rozhodnutí](adr/README.md) — autoritativní index ADR.
- [Produktová roadmapa](../PRODUCT_ROADMAP.md) — dokončené milníky a další
  práce.
- [Uživatelské ověření](EVALUATION.md) — scénář nezávislého testu a sběr
  výsledků.

## Bezpečnost a vývoj

- [Threat model](../THREAT_MODEL.md) — aktiva, útočníci a produkční hranice.
- [Security policy](../SECURITY.md) — podporované verze a hlášení zranitelností.
- [Contributing](../CONTRIBUTING.md) — vývojové kontroly a pravidla příspěvků.
- [Observability contract](OBSERVABILITY.md) — telemetry boundary, retence a
  alerting.

## InitPad Agent

- [Agent](../apps/agent/README.md) — instalace, bezpečnostní model a lokální lab.
- [Release acceptance](../apps/agent/ACCEPTANCE.md) — ověření vydané verze.
- [Releasing](../apps/agent/RELEASING.md) — sestavení a publikace releasu.

## Jazyk dokumentace

Dokumenty určené k diplomové práci, pilotnímu českému týmu a obsluze
self-hosted instalace jsou česky. Veřejná rozhraní pro přispěvatele,
bezpečnostní proces, distribuci Agenta, SaaS a observability jsou anglicky,
protože cílí také na nástroje a správce mimo české prostředí. Jeden dokument
jazyky nemíchá s výjimkou názvů prvků UI a zavedených technických pojmů.

Osobní poznámky, auditní pracovní záznamy a návody pro konkrétní zařízení do
veřejné dokumentace nepatří. Repository audit jejich náhodné přidání odmítne.
