# Nezávislé uživatelské ověření

Tento protokol slouží pro závěrečné vyhodnocení InitPadu bez průběžné
pomoci autora. Nemění produktové požadavky a sám o sobě není výsledkem
testu. Vyplněné záznamy, screenshoty a identifikovatelná data účastníků
nepatří do veřejného repozitáře.

## Cíl

Ověřit, zda nový uživatel bez znalosti interní implementace dokáže:

1. vytvořit nebo importovat projekt;
2. doručit změnu přes `dev → test → prod` se stejným artifactem;
3. rozpoznat chybu a obnovit předchozí zdravou revizi;
4. spolupracovat ve workspace bez překročení role;
5. pochopit stav CI, deploymentu a targetu bez vysvětlení autora.

Vedle úspěšnosti se měří čas, počet nutných kroků, chyby, zásahy
facilitátora a vnímaná použitelnost.

## Role

- **Účastník A:** student nebo vývojář, který InitPad dosud nepoužíval.
- **Účastník B:** druhý člen týmu; provede review produkční žádosti a
  kontrolu role.
- **Facilitátor:** připraví prostředí, zadá úlohy, měří a zasáhne jen při
  bezpečnostním problému nebo když se účastník definitivně vzdá.

Facilitátor nesmí napovídat umístění tlačítka ani vysvětlovat stavovou
hlášku. Každou vyžádanou nápovědu zapíše jako zásah.

## Příprava prostředí

Použij jednorázovou self-hosted instalaci nebo schválený release-candidate
server. Před testem ověř:

- API readiness vrací `200`;
- SCM a CI runner jsou zdravé;
- alespoň jeden Agent target je `online` a má workspace access pro
  `dev`, `test` a `prod`;
- gateway/DNS funguje, pokud se hodnotí stabilní HTTPS URL;
- účty A a B jsou aktivní, ale testovací workspace ani projekt ještě
  neexistují;
- účastník B bude owner/admin team workspace; A bude member.

Do záznamu uveď commit InitPadu, verzi Agenta, edici, typ targetu, zvolenou
šablonu a kapacitu CI runneru. Nepřikládej `.env`, tokeny ani credentials.

## Pravidla měření

Pro každou úlohu zaznamenej:

| Pole | Význam |
|---|---|
| `startedAt`, `finishedAt` | čas od přečtení zadání do viditelného výsledku |
| `success` | splněno bez zásahu, splněno se zásahem, nesplněno |
| `steps` | počet vědomých akcí uživatele; čekání se nepočítá |
| `errors` | chybové stavy způsobené uživatelem nebo systémem |
| `interventions` | přesné znění pomoci facilitátora |
| `observation` | místo zaváhání, mylné očekávání nebo užitečná poznámka |

Čas fronty CI eviduj zvlášť od aktivního času. Jinak by pomalejší host
zkreslil hodnocení rozhraní.

## Scénář A — nový projekt

Zadání pro účastníka:

> Vytvoř týmový workspace a v něm soukromý projekt `evaluation-app` ze
> zadané šablony. Cílem je otevřít zdravou dev aplikaci. Až bude hotovo,
> ukaž repozitář, výsledek CI a běžící prostředí.

PASS znamená, že repozitář existuje ve správném SCM, workflow je zelené,
dev má zdravé URL a participant umí najít commit i deployment bez přímého
zásahu do Dockeru.

## Scénář B — změna a promotion

Zadání pro účastníka A:

> Změň na domovské stránce viditelný text, commitni a pushni změnu.
> Otevři novou dev verzi, povyš ji do testu a požádej o nasazení stejné
> verze do produkce.

Zadání pro účastníka B:

> Najdi čekající produkční žádost, ověř zobrazenou revizi a schval ji.

Facilitátor potom v detailu operací ověří, že `dev`, `test` a `prod`
odkazují na stejné SHA a digest. V team workspace nesmí A schválit vlastní
žádost, pokud policy vyžaduje druhého člověka.

## Scénář C — chyba a rollback

Facilitátor připraví novou revizi, která neprojde health checkem, nebo použije
připravený bezpečný fault fixture. Zadání:

> Zjisti, proč nové nasazení není aktivní. Zachovej dostupnou poslední
> zdravou verzi a potom obnov dříve ověřenou revizi.

PASS znamená, že nezdravý kandidát nepřepíše aktivní URL, uživatel otevře
správnou operaci nebo externí CI log a rollback skončí zdravý. Návrat na
novější dobrou revizi se provede jejím novým redeployem, nikoli přepisem
historie.

## Scénář D — role a izolace

1. B přidá A do workspace s read-only rolí.
2. A otevře projekt, deploymenty a audit, potom se pokusí změnit target nebo
   spustit deployment.
3. A zkusí přímou URL zdroje z jiného workspace, kterou mu poskytne
   facilitátor jako neprůhledné testovací ID.
4. B změní A na zapisující roli a A zopakuje povolenou projektovou akci.

PASS: read-only data jsou dostupná, mutace vrací `403`, cizí resource `404`
a po změně role projde pouze akce odpovídající novému oprávnění. Owner
vidí v Audit logu správné aktéry a pořadí.

## Volitelné srovnání s ručním postupem

Pro tvrzení o úspoře času nestačí měřit pouze InitPad. Stejný výsledek
nech účastníka vytvořit také předepsaným ručním postupem: soukromé repo,
framework skeleton, Dockerfile, CI, dev nasazení a přístup druhého člena.
Polovině účastníků dej nejprve InitPad a polovině ruční variantu, aby
výsledek neurčoval efekt učení.

Obě varianty musí použít stejný framework, stejný cílový server a shodnou
definici „hotovo“. Do ručního času nepočítej předem hotovou CI šablonu,
pokud její vytvoření započítáváš InitPadu jako přínos.

## Dotazník a rozhovor

Po praktické části vyplní každý účastník standardní desetipoložkový SUS
dotazník ve stejném schváleném překladu. Znění ani skórování během sběru
neupravuj. Následují tři otevřené otázky:

1. Ve kterém okamžiku sis nejméně věřil, co systém udělá?
2. Který ruční krok bys chtěl zachovat pod vlastní kontrolou?
3. Co by ti bránilo použít InitPad v reálném týmu?

## Souhrn výsledku

Ve výsledku odděl:

- automatizované testy od nezávislého uživatelského ověření;
- chyby produktu od chyb testovací infrastruktury;
- medián od jednotlivých odlehlých hodnot;
- pozorovaná fakta od interpretace autora.

Uveď počet a profil účastníků bez zbytečných osobních údajů, míru
dokončení každého scénáře, medián času a kroků, počet intervencí,
SUS skóre a opakující se kvalitativní témata. Neúspěšný scénář je
platný výsledek, ne důvod k jeho vyřazení.
