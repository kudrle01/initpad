# InitPad — přesný brand balíček

Balíček je postavený přímo ze schváleného PNG masteru, tedy bez změny siluety.

## Obsah

- `approved-master.png` — jediný kanonický zdroj siluety
- PNG exporty 16, 32, 64, 128, 256 a 512 px
- `favicon.ico`
- `initpad-maskable-512.png`
- PNG varianty symbolu a horizontálního wordmarku
- `initpad-brand-preview.png`
- `VECTOR_NOTE.txt`

## Barvy

- primární zelená `#3A6B40`
- krémová `#FBF8F0`
- espresso `#4E220F`
- akcent `#B4472E`

## Použití v repozitáři

Tato složka je zdrojový balíček. Web do produkčního buildu přebírá pouze
potřebné velikosti z `apps/web/public/brand` a `favicon.ico` z
`apps/web/public`. Rozhraní nepoužívá dřívější SVG rekonstrukci; zobrazuje
přímo schválené PNG exporty.

Tři původní soubory `approved-master.png`, `initpad-icon-primary-1254.png` a
`initpad-icon-primary-master.png` byly bajtově totožné. V repozitáři proto zůstává
jen jednoznačně pojmenovaný `approved-master.png`.
