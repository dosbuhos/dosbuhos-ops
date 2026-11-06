# Cellar app — running change log

Newest first. One line per change: date · what · why · commit. Each run reads this first.

## 2026-11-06 — phone UX from the staging night, ported to production
- Room map: invisible bigger tap areas per section, green outline on the selected one, TÚ no longer blocks taps, bigger column numbers on phones · easier to hit with gloves · 5aed69b
- Front view on phones: lines under each barrel in Barlow Condensed, larger · readable at arm's length · afbfb24
- Bodega chrome on phones: all four tabs fit, tighter gaps, 38px Mapa/Lista · more barrels on screen · 73cd00c
- Barrel card: banner says when it's due ("tocaba el …" / "el próximo toca el …"), calmer SO₂ and Relleno tiles, 2 tiles on phones, 44px controls, 16px Notas · less red noise, no iOS zoom · aa97c61 (kept the discarded-barrel case)
- Lista on phones: sort moves into Filtros, rows line up, "SO₂ 12.4" and "📍 9.3" labels, wine names wrap, 22px checkboxes · scannable rows · 0b71875 (kept .cr-disc)
- App bar: "Bodega" instead of "Wines" · Spanish · f330bb0
- Editar pasillo on phones: rows of 3, glove-size + and ×, one-line hint · 6f237c4
- Note: the front-view lines need the Barlow Condensed web font; until it loads on a slow connection the labels fall back to a wider font and can crowd.

## Open questions for Eric
- (a) Rotate the room map 90° on phones (~2.5× bigger)?
- (b) Shorten "rellenar +5 d" to "+5 d" on phones?
- (c) The "Tinto" chip on the card is the barrel's type, not the wine — rename to "Barrica de tinto"?
- (d) Bottom nav in Spanish (Bodega, Protocolos…)?
- (e) SO₂ thresholds differ: card low < 12 / goal 20, Lista low < 10 — which is right?
