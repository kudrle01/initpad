# InitPad brand assets

Tato složka obsahuje kanonické zdroje a exporty vizuální identity InitPadu.

## Obsah

- `approved-master.png` — kanonický zdroj symbolu
- PNG exporty 16, 32, 64, 128, 256 a 512 px
- `favicon.ico`
- `initpad-maskable-512.png`
- PNG varianty symbolu a horizontálního wordmarku
- `initpad-brand-preview.png`
- `VECTOR_POLICY.md` — pravidla pro případný budoucí vektorový master

## Barvy

- primární zelená `#3A6B40`
- krémová `#FBF8F0`
- espresso `#4E220F`
- akcent `#B4472E`

## Použití v repozitáři

Web do produkčního buildu přebírá potřebné velikosti z
`apps/web/public/brand` a `favicon.ico` z `apps/web/public`. Nové exporty musí
vycházet z `approved-master.png`, aby symbol zůstal konzistentní napříč UI,
instalátorem a dokumentací.
