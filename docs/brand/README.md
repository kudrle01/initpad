# InitPad — finální logo balíček

## Myšlenka
Znak kombinuje estetiku vybraného konceptu 1 s významem konceptu 3:
otevřený zaoblený rám představuje bezpečný workspace a bod v jeho otevřeném výstupu představuje projekt,
který je po inicializaci připraven a řízeně předán do dalšího kroku.

Geometrie je vytvořena přímo jako vektorové křivky; nejde o automaticky trasovanou bitmapu.

## Primární použití
- Primární barva: #3A6B40
- Krémové pozadí: #FBF8F0
- Espresso: #4E220F
- Volitelný malý akcent bodu: #B4472E
- Jednobarevně používat černou nebo bílou variantu.

## Minimální velikost
- Samostatná ikona: 16 px.
- Doporučené běžné UI použití: 24–32 px.
- Horizontální wordmark: doporučená minimální výška 24 px.

## Ochranná zóna
Kolem samostatného symbolu ponechat minimálně prostor odpovídající přibližně poloměru kruhového bodu.
U wordmarku ponechat stejnou zónu kolem celého spojení.

## PWA maskable
`initpad-maskable.svg` a `initpad-maskable-512.png` drží znak uvnitř bezpečné centrální zóny
a používají bílé logo na primární zelené ploše.

## Wordmark
SVG wordmark používá živý text s rodinou `Inter Display, Inter, Arial, sans-serif`,
aby zůstal editovatelný. Před definitivním tiskovým exportem je vhodné text převést na křivky
v grafickém editoru s definitivně zvoleným licencovaným fontem.

## Soubory
- `initpad-icon-primary.svg`
- `initpad-icon-accent.svg`
- `initpad-icon-black.svg`
- `initpad-icon-white.svg`
- `initpad-icon-negative-espresso.svg`
- `initpad-icon-negative-black.svg`
- PNG: 16, 32, 64, 128, 256, 512 px
- `favicon.ico`
- `initpad-maskable.svg`, `initpad-maskable-512.png`
- horizontální wordmark varianty v SVG a PNG
- `initpad-brand-preview.png`

## Použití v repozitáři

Tato složka je zdrojový brand balíček a obsahuje i tiskové varianty a náhled.
Web do produkčního buildu přebírá pouze potřebné soubory z
`apps/web/public/brand`; favicony jsou v `apps/web/public`. V rozhraní se používá
samostatný symbol a název zůstává HTML textem kvůli ostrosti a přístupnosti.
