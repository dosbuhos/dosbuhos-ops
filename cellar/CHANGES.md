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

## 2026-11-10 — Vinos: active filter tile stands out; "no wines match" hint in bold · v1.19.2
- The summary tile you tap to filter (e.g. "No lab in 3+ weeks") now turns light maroon with a maroon border and label when it's on, and the "Clear the search or the filter above" line is bold · Eric lost the wine list to a filter he didn't notice was on · app/cellar-targets.html (CSS + empty-row text)

## 2026-11-10 — Guarda: barrel numbers on each wine · v1.19.1
- Each wine row in Guarda shows its barrels under the lot code (BBL 68, 69, …), from the barrel registry (barrels whose wine is that lot) · Eric wanted lot + barrels at a glance · app/cellar-room.js publishes window.cellarBarrelsByLot; app/cellar-targets.html shows it in Guarda only

## 2026-11-10 — Vinos: «Guarda» tab · v1.19.0
- New tab next to Vinos: «Guarda» lists the older-vintage wines aging in barrel (lots in phase "cellar") in the same wine table, with their numbers and work orders. Vinos keeps only this year's production; Barricas is unchanged · Eric wanted the 2023–25 reds as lot records without breaking the Barricas layout · app/cellar-targets.html
- Data (no code): new Excellovint tabs L27 CF24, L28 CF25, L29 CS25, L30 MM25 (+ Monte25/MM), L31 MONTE25, L32 MONTE24, L33 MONTE23, L34 GR25 (+ GR25/TE23), L35 AG25, linked to Paris's w-nv-* lots (code + sheet). Named L27+ because every tab filter in the app reads /^L\d/.

## 2026-11-09 — Photos on work orders · v1.18.0
- «Anotar resultados» on a work order has «📷 Agregar fotos» (several at once); photos are shrunk on the phone (≤1600 px JPEG), stored in R2 (`wo/…`, same bucket as lab files) with a `wophotos` doc tied to the Excellovint tab + row, and shown as thumbnails under the order (tap = full size) · Eric: fridge-test jar photos
- New API: GET/POST /api/wophotos, GET /api/wophotos/file?h= · src/entries.js, src/index.js, app/entries.js, app/entries.css

## 2026-11-09 — Compras: sheets close with × or tapping outside · v1.17.1
- Every Compras / Inventario sheet (edit purchase, provider, inventory forms) has a × at the top right and closes when you tap outside it; before, only Cancelar worked · Eric · public/purchases.html

## 2026-11-09 — Compras: providers directory · v1.17.0
- «Dónde / proveedor» is now free text with suggestions (known providers + every Dónde already used); a new name is added to the new `providers` collection by itself (crew can write it) · Eric: build a provider list as we go
- Tapping a purchase's provider tag opens its card: contacto, teléfono/WhatsApp, email, web, notas, and how many purchases use it
- Fix: editing a purchase whose Dónde wasn't one of the 3 fixed options (e.g. "Hector Ortiz…", "HACER VINO") used to blank it
- Seeded: Hector Ortiz (filters), HACER VINO (Sentia strips), Enología Integral (ML bacteria) · public/purchases.html, src/index.js

## 2026-11-09 — Compras opens on «Activas» · v1.16.3
- New default tab «Activas» = everything not received (sin pedir + por llegar), grouped by priority, not-ordered first, then by arrival date; «Pedidas, por llegar» renamed «Por llegar» so the 4 tabs fit; marking ordered from Activas stays on Activas · Eric · public/purchases.html

## 2026-11-09 — Compras: arrival-date editor full size + "no estimate" · v1.16.2
- The Llegada estimada editor uses full-size controls (date field full width, Guardar / Cancelar same height as the other buttons) · Eric
- New «No sabemos todavía (sin fecha estimada)»: the card shows "Llegada: sin fecha estimada" with «Poner fecha», never late, sorted last (eta = "none") · public/purchases.html

## 2026-11-09 — Compras: progress dots in the stage's color · v1.16.1
- Sin pedir → red dot; Pedida → amber dot and line; Recibida → green dots and line (was black) · Eric · public/purchases.html

## 2026-11-09 — Compras: estimated arrival date · v1.16.0
- Ordered purchases get «Llegada estimada»: «Marcar como pedida» jumps to Pedidas and opens the date picker; the card shows "Llega aprox. el 19 nov" (Cambiar), the badge "Pedida 9 nov · llega ~19 nov", and turns red "Atrasada · debía llegar…" once the date passes; Pedidas sorts by arrival date; also editable in the purchase form · Eric
- Stored as `eta` on the purchase (app only; the Excellovint Compras tab sync keeps it, it isn't a sheet column) · public/purchases.html

## 2026-11-09 — Path to bottle: Claude rows, Dismiss, phones, stale suggestions; SO₂ estimate per vessel · v1.15.4
- Claude's suggestions are full-width rows (text left, Apply + Dismiss on the right) instead of side-by-side cards · Eric
- Dismiss button on every suggestion (marks it done/dismissed, like the wine card's)
- Phones: each wine is a card; the columns that didn't fit now wrap underneath with their own labels, no sideways scroll
- Suggestions that are already true are hidden (the field — or for the vessel, the wine's own location — already says it); the vessel shown comes from the wine's location, so it can't drift from the Wines tab · Eric: stale "vessel" suggestion
- Free SO₂ estimate fixes (SB tank showed ~42, real 16): an addition counts only for the vessel it was made in; "if short, add…" is a plan, not an addition; a vessel racked out ("VC-03 → VC-04") drops out; each wine only averages the vessels in its own location (SB tank = VC-04, not the puncheon) · cellar-targets.html

## 2026-11-09 — Path to bottle in plain words, one language · v1.15.3
- Every step says the action ("Needs bentonite · 20–40 g/hL", "Protein stable: no bentonite", "Pad filter · after bentonite", "Sterile filter at bottling") with a "Why:" line, instead of a green "sí" pill under a Spanish header; headers, readings (Free SO₂, Malic, VA, Heat test Δ … NTU), tabs, footer and the edit dialog all in English (the notes are English) · Eric: Spanish/English mix and "sí" were confusing
- Claude's suggestions name the field in words ("Suggested change to SO₂ to hold (note)") instead of holdNote / protein.p

## 2026-11-09 — Ruta a botella: Pendientes + Claude's notes under each wine · v1.15.2
- The Pendientes column is gone; each wine gets a full-width row underneath with the pending questions and Claude's suggestions as cards side by side (wrapping), instead of a tall stacked column · Eric · cellar-targets.html

## 2026-11-09 — Wine list: bold status next to the name · v1.15.1
- «Archivado · mezclado en L11» (archived lot, or "blended into L11" in its location) and «Embotellado 4/11 · 159 bot.» (bottled, source emptied) shown in bold under the wine name · Eric · cellar-targets.html

## 2026-11-09 — Data: carbonic pinks split into two wines
- lots/carb-pinks ("Carbonic pinks (PS + CF)", L13 + L14) is now **Cab Franc carbónico** (L14 only: VC 230 L, 109 L → CF rosé 18/11); new lots/ps-carb **Petite Sirah carbónico (nouveau)** (L13: bottled 4/11, 159 bottles; the bottling record moved here) · Eric: they won't be blended, show them separately
- Old carb-pinks plan items (blend trial PS+CF, combine in tank, early/standard bottle, weekly sensory) left as they were; Eric to decide whether to close them

## 2026-11-09 — Free SO₂ shown after additions (estimate "~") · v1.15.0
- Every free-SO₂ number (wine table, wine card notes, barrel card, map, Lista) = last reading + SO₂ added since, shown as "~24" with "estimado · lectura 8/12/11" · Eric: the CF rosé showed 11 (the reading taken before the Oct 22 addition)
- Wine table: per vessel (each barrel / tank) reading + its own additions, averaged over vessels read in the last 3 weeks; "ADD 16 MG/L" now counts as an addition (was PPM only), which also fixes the ≈ total SO₂
- Per-barrel results written as text ("BBL 44 CF = 16.7 PPM") now count as readings (server + wine table) · src/xl.js, cellar-targets.html, cellar-room.js, barricas.html

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
