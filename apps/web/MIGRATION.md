# Frontend migrace na Tailwind + shadcn/ui + atomic design

Postupná migrace z ručně psaného `styles.css` na **Tailwind CSS** + **shadcn/ui**
primitiva, s komponentami rozdělenými podle **atomic designu**.

## 1) Instalace (spustit lokálně)

```bash
cd apps/web
npm install
npm run dev
```

`npm install` stáhne nové závislosti (Tailwind, Radix, CVA, tailwind-merge…).
Pozn.: `tailwind.config.ts` je v TypeScriptu; Tailwind 3.4 to umí. Kdyby dělal
problém, přejmenuj na `tailwind.config.js` a uprav `export default`.

## 2) Stav: migrace dokončena ✅ + design pass ✅

- `src/index.css` = Tailwind (`@tailwind base/components/utilities`) + design tokeny + base styly.
- **Preflight je zapnutý** (výchozí) – žádné `corePlugins.preflight: false`.
- `src/styles.css` a `src/components/Icon.tsx` byly smazány (mrtvý kód po migraci).
- Všechny stránky, App shell i toasty běží na Tailwind + shadcn/ui.

### Design pass (po migraci)

**Oprava klíčové chyby migrace:** tokeny byly hex v CSS proměnných
(`--primary: #3a6b40`) mapované jako `var(--primary)` – Tailwind 3 pak ignoruje
alpha modifikátory (`bg-primary/10`, `ring-ring/40`, `bg-foreground/40`…), takže
overlay dialogů, focus ringy a tinty se vykreslovaly rozbitě. Tokeny jsou nyní
**HSL kanály** + mapování `hsl(var(--x) / <alpha-value>)` (standard shadcn).

Další změny:
- `atoms/TemplateIcon` – barevná ikona technologie šablony (návrat k identitě
  z mockupu), použitá v Templates, New project, ProjectRow i detailu.
- `molecules/EmptyState` – jednotné prázdné stavy s CTA (Dashboard, Projects,
  ComingSoon, NotFound, CommitList).
- Sidebar: jemnější aktivní stav (secondary + zelená ikona), na úzkých oknech
  ikonový rail (`w-16 lg:w-60`), avatar otevírá dropdown se Sign out.
- `ui/select.tsx` – stylovaný nativní select (provider prostředí).
- `ui/card.tsx` má border a používá se všude místo ručních `border bg-card` divů.
- Button: nový size `icon-sm`, ghost varianta je muted; ikonová tlačítka
  (redeploy, refresh) jsou `<Button variant="ghost" size="icon-sm">`.
- Focus ringy (`focus-visible:ring-ring/40`) na všech interaktivních prvcích.
- Dashboard má vlastní titulek, ikony statistik a „View all"; Projects mají
  client-side filtr; „Use template" předvybírá šablonu přes `?template=id`;
  pipeline karty ukazují ikonu provideru; CommitList má empty state.

## 3) Struktura (atomic design)

```
src/
  lib/utils.ts            cn() helper (clsx + tailwind-merge)
  components/
    ui/                   shadcn primitiva = „atoms library" (button, badge, card, input, label, dialog, …)
    atoms/                vlastní atomy (StatusDot, Icon, Spinner, Kbd)
    molecules/            složeniny atomů (FormField, StatusBadge, CopyField, ProjectRow)
    organisms/            velké sekce (Sidebar, EnvironmentPipeline, CommitList, DeleteDialog, LogsDialog)
  pages/                  skládají organismy (Dashboard, ProjectDetail, …)
```

- **atom** = nejmenší nedělitelný prvek (tlačítko, tečka, input).
- **molekula** = pár atomů s jednou odpovědností (label+input+chyba).
- **organismus** = ucelená část UI (sidebar, pipeline prostředí, seznam commitů).
- **page** = skládá organismy do obrazovky.

## 4) Design tokeny

Tokeny (earthy paleta) jsou v `src/index.css` v shadcn konvenci a namapované v
`tailwind.config.ts`, takže v komponentách píšeš sémanticky:
`bg-primary text-primary-foreground`, `bg-card`, `text-muted-foreground`,
`border-border`, `text-destructive`, `bg-success`, `bg-warning`.

## 5) Vzor migrace komponenty

Starý CSS třídy → Tailwind utility + shadcn primitivum. Příklad (viz `pages/Login.tsx`):
- `.btn.btn-primary` → `<Button>`
- `.input` → `<Input>`
- `.badge` + `.dot` → `<Badge>` + `<StatusDot status={…} />`
- ruční karta → `<Card>` / `bg-card rounded-lg shadow`

## 6) Hotovo

- [x] Základ: Tailwind, tokeny, `cn`, `ui/` primitiva, preflight zapnutý
- [x] Login
- [x] App shell (`organisms/Sidebar`)
- [x] Dashboard, Projects (`molecules/ProjectRow`)
- [x] Templates
- [x] NewProject (template picker, env select)
- [x] ProjectDetail (`EnvironmentPipeline`, `CommitList`, `EnvLogsDialog`, `DeleteProjectDialog`)
- [x] Environments / Activity / Infrastructure / Settings (`ComingSoon`)
- [x] NotFound / RouteError
- [x] Toasty (Tailwind, centrované)
- [x] `styles.css` a `Icon.tsx` smazány
- [x] Design pass (HSL tokeny, TemplateIcon, EmptyState, responzivní sidebar, focus ringy)

## 7) Doplnění dalších shadcn primitiv

Buď je dopiš ručně do `components/ui/`, nebo použij CLI:
```bash
npx shadcn@latest add dialog dropdown-menu tabs tooltip
```
(CLI potřebuje `components.json` — vygeneruje `npx shadcn@latest init`.)
