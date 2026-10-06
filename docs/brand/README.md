# Vizuální identita InitPadu

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

- primární zelená `#075E54`
- krémová `#FBF8F0`
- espresso `#4E220F`
- akcent `#B4472E`

## Barvy webového rozhraní

Webová aplikace používá vlastní sadu tokenů (světlý i tmavý režim) definovanou v
`apps/web/src/index.css`. Se značkou sdílí primární zelenou `#075E54`; symbol se
v UI vykresluje přes token `--primary`, takže v tmavém režimu přebírá jeho
zesvětlenou variantu `#00A884`. Neutrální plochy rozhraní jsou chladně šedé
(`#F0F2F5` / `#0B141A`), nikoli krémové.

## Použití v repozitáři

Webová aplikace do produkčního buildu přebírá potřebné velikosti z
`apps/web/public/brand` a `favicon.ico` z `apps/web/public`. Nové exporty musí
vycházet z `approved-master.png`, aby symbol zůstal konzistentní napříč UI,
instalátorem a dokumentací.
