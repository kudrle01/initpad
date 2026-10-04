# Dokumentace InitPadu

Tento rozcestník odděluje cestu uživatele a správce od detailů určených
vývojářům projektu. Začněte dokumentem, který odpovídá tomu, co potřebujete
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

- [Model hrozeb](../THREAT_MODEL.md) — aktiva, útočníci a produkční hranice.
- [Bezpečnostní zásady](../SECURITY.md) — podporované verze a hlášení zranitelností.
- [Pravidla přispívání](../CONTRIBUTING.md) — vývojové kontroly a pravidla příspěvků.
- [Pravidla observability](OBSERVABILITY.md) — hranice telemetrie, retence a
  alerting.

## InitPad Agent

- [Agent](../apps/agent/README.md) — instalace, bezpečnostní model a lokální lab.
- [Ověření vydané verze](../apps/agent/ACCEPTANCE.md) — acceptance postup pro release.
- [Vydávání Agenta](../apps/agent/RELEASING.md) — sestavení a publikace releasu.

## Jazyk dokumentace

Dokumentace je česky, protože slouží jako podklad pro diplomovou práci a pro
správce self-hosted instalace. Soubory README používají neutrální formulace nebo
zdvořilé vykání. Názvy prvků UI, příkazy, proměnné, názvy protokolových stavů a
zavedené technické pojmy zůstávají v podobě použité v aplikaci a ve zdrojovém
kódu. Jeden dokument jazyky zbytečně nemíchá.

Anglicky zůstávají pouze `CONTRIBUTING.md` a `SECURITY.md`. GitHub je zobrazuje
jako pravidla repozitáře a čtou je přispěvatelé a nahlašovatelé zranitelností
mimo české prostředí. README generovaná do projektů ze šablon patří k produktu a
jejich jazyk určuje šablona, nikoli tento rozcestník.

Osobní poznámky, auditní pracovní záznamy a návody pro konkrétní zařízení do
veřejné dokumentace nepatří. Repository audit jejich náhodné přidání odmítne.
