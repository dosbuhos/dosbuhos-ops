# Cellar app — running change log

Newest first. One line per change: date · what · why · commit. Each run reads this first.

## Próximas mejoras (running upgrade list — Eric picks, one at a time)
Size S/M/L · ⚑ = needs Eric's decision first.
1. Órdenes del día on phones: bigger rows, action at thumb reach, "Anotar resultados" one tap, Cerradas/Canceladas folded · the crew's main screen · M
2. Spanish everywhere on phones: bottom nav (Wines → Bodega, Protocols → Protocolos), search placeholder ("Find a wine, lot or…"), "Live from Excellovint", "Refresh", "Target", "ML progress" on wine cards · S · ⚑ (d)
3. Front-view labels fit before the web font loads on slow 4G (fallback font sized to match Barlow Condensed) · S
4. Barrel card tabs stay pinned at the top while scrolling on phones · S
5. One SO₂ "low" cutoff everywhere (card < 12 vs Lista < 10) · S · ⚑ (e)
6. Wine cards (Vinos) on phones: tighter tiles, no empty ML-progress bar when there's no data · M
7. Full phone audit with real data at 320/360/412 px (and big system text): every screen, fix any overlap/run-on · M
8. Room map rotated 90° on phones (~2.5× bigger) · M · ⚑ (a)
9. "rellenar +5 d" → "+5 d" on phones · S · ⚑ (b)
10. "Tinto" chip → "Barrica de tinto" · S · ⚑ (c)
11. Rondas from the map: one date/person, tap barrels to mark topped or SO₂ read · L
12. Recording a rack updates both barrels on the map (source empty, destination filled) — check, then fix if needed · M
13. Molecular SO₂ shown from pH + free SO₂ on the card and Lista · M
14. Slow-connection states: loading, empty and error messages that say what to do · M

## 2026-11-06 (later) — phone fixes from Eric's screenshots
- Vinos/Tanques/Barricas/Embotellado never overlap: count under the label on narrow phones, row scrolls if system text is very large, selected tab kept in view · labels were running into each other · mobile.css
- Room map fills its card on phones: no SUR / ÁREA DE PRENSA side labels, frame hugs the walls and crush pad, thinner padding (~10% bigger) · wasted space beside the room · barricas.html

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
