# Cellar app — running change log

Newest first. One line per change: date · what · why · commit. Each run reads this first.

## Próximas mejoras (running upgrade list — Eric picks, one at a time)
Size S/M/L · ⚑ = needs Eric's decision first.
1. Work orders as accordions: a one-line heading (what + where), tap to open the numbered steps, "Anotar aquí" in its own box; split automatically from today's text at (1) (2) (3)… — no change to the sheet · much less scrolling for the crew · M
2. Órdenes del día on phones: bigger rows, action at thumb reach, "Anotar resultados" one tap, Cerradas/Canceladas folded · the crew's main screen · M
3. Spanish everywhere on phones: bottom nav (Wines → Bodega, Protocols → Protocolos), search placeholder ("Find a wine, lot or…"), "Live from Excellovint", "Refresh", "Target", "ML progress" on wine cards · S · ⚑ (d)
4. Front-view labels fit before the web font loads on slow 4G (fallback font sized to match Barlow Condensed) · S
5. Barrel card tabs stay pinned at the top while scrolling on phones · S
6. One SO₂ "low" cutoff everywhere (card < 12 vs Lista < 10) · S · ⚑ (e)
7. Wine cards (Vinos) on phones: tighter tiles, no empty ML-progress bar when there's no data · M
8. Full phone audit with real data at 320/360/412 px (and big system text): every screen, fix any overlap/run-on · M
9. Room map rotated 90° on phones (~2.5× bigger) · M · ⚑ (a)
10. "rellenar +5 d" → "+5 d" on phones · S · ⚑ (b)
11. "Tinto" chip → "Barrica de tinto" · S · ⚑ (c)
12. Rondas from the map: one date/person, tap barrels to mark topped or SO₂ read · L
13. Recording a rack updates both barrels on the map (source empty, destination filled) — check, then fix if needed · M
14. Molecular SO₂ shown from pH + free SO₂ on the card and Lista · M
15. Slow-connection states: loading, empty and error messages that say what to do · M

## 2026-11-09 — Work orders on computers: text full width, controls underneath · v1.14.1
- Prioridad · Asignado · Estado moved under the order text, in one line next to «Anotar resultados y notas» (like the phone); the order reads as one wide paragraph instead of a narrow column · Eric · cellar-targets.html (CSS grid; «Anotar» button is now a direct child of the row, phones unchanged)

## 2026-11-09 — Barrel card: position vs. the barrel's own record · v1.14.0
- Position actions are buttons at the top: «Mover» (barrel goes elsewhere, history goes with it) and «No es esta barrica» (another barrel is physically on this spot: type its number; it comes with its own history, the old one goes to "por confirmar") · Eric: moving and editing the number must be separate
- Datos is now a read-only "ficha" (número, contenido, tonelería, madera, año, tamaño, tostado, tipo, notas) with «Editar ficha»; the number can't be typed over in the edit form
- Fixing a number is its own link inside Editar ficha: «Corregir número» (same barrel, wrong number → renumber, whole history moves); refused if that number already has a record
- Only an empty / unnumbered spot asks «¿Qué barrica está aquí?» with a free number field
- Litros (vol) written only when edited, like the specs · barricas.html

## 2026-11-09 — Changing a barrel number on the map (Paris's report) · v1.13.0
- Bug: putting a number on a map spot placed the new barrel there but left the old one on the same spot (5 spots ended up with 2 barrels: 18.3, 19.1, 29.2, 29.4, 33.1), so the map kept showing the old number and the old number couldn't be placed where it belongs; the form also copied the old barrel's tonelería/año/wine onto the new number · barricas.html
- Now, when the number on a spot changes, the app asks: "Aquí está la N (es otra barrica)" → N moves here with its own history, the old one goes to "sin ubicación · por confirmar"; or "Es la misma barrica: su número correcto es N" → renumbered, all its history moves with it (only if N has no record of its own) · Eric
- If N was registered on another spot, that spot keeps a "barrica sin número" marker · one barrel per spot is enforced on save
- Spots with 2 registered barrels show "¿Cuál está aquí?" with one button per number
- Barrel specs are written only when edited, never copied from the barrel that was there
- New POST /api/barrels/rename (crew allowed): moves the registry doc, every barrel_log record, map markers; keeps `formerly` + `renamed` on the barrel so old QR tags, searches, Excellovint lines and SO₂ under the old number still find it · src/moves.js
- Historial: "Antes: BBL X"; admins get "otra barrica" on each record to move a record logged under the wrong number

## 2026-11-06 (afternoon) — Lista on phones rebuilt, slimmer gutters
- Lista: sort by Tonelería (grouped by cooper, then barrel year; no cooper last) — desktop select and phone Filtros · v1.12.4
- Barrel card from the Lista: phone Back closes the card (was leaving the app); × is a quiet 38px round button aligned with the barrel number; card fills the screen width on phones · v1.12.3 · cellar-room.js, barricas.html
- Lista opens on "Con vino" (not every barrel incl. empties) · Eric · cellar-room.js
- Lista rows on phones (v1.12.2, replaces the ▾ version): two dense lines — "BBL 039 ● Aglianico 2026  📍9.3" / "Relleno tarde 44 d · SO₂ 12  Darnajou · Francesa · 2019" (tonelería wraps to a 3rd line only on very narrow screens); no ▾, tapping the row opens the card · Eric found the details panel not useful · cellar-room.js/css
- (superseded) Lista rows on phones: one information column — "BBL 083 · Aglianico 2026", tonelería (cooperage · wood · year), SO₂ (value + age, red when low) and relleno (red when late); ▾ opens location, añada, barrel details, last maintenance, notes and "Abrir tarjeta" in place · location moved into the details · cellar-room.js/css
- Phones: side gutter 6px everywhere (was 12px), map cards use the same gutter · more content per screen · mobile.css
- Barricas: Mapa / Lista toggle in the app bar on phones · list starts higher, toolbar has room · mobile.js
- Lista on phones: toolbar = search + "Filtros" + "Más" (labelled, 44px); "Orden: Tipo de vino ▾" visible above the list (opens Filtros); group headers are plain headings with "Elegir todas" on the right; rows are two clear lines — number + wine, then status · 📍 place · SO₂ (no reading → hidden), no overlaps · cellar-room.js/css

## 2026-11-06 (later) — phone fixes from Eric's screenshots
- Room map and front view nearly edge to edge on phones (cards ~8px from the screen edge); crush pad is its own card under the room — grey bar, its barrels bigger, tap one to open its card, whole bar is the drop target when moving · more map, two clear places · barricas.html, cellar-room.css
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
