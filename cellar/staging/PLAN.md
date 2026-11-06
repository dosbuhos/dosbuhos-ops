# Overnight plan

One night at a time. Eric approves each morning before the next night runs.
Nights 1–2: usability and display only, phone first — no new features. Later nights are proposals until approved.

## Night 1 — Barricas on the phone (UX/UI only) · status: in progress (runs 1–2 of 3 done)
Screens: Bodega → Barricas → Mapa (room map, front view, barrel card with its 4 tabs, crush pad, ánfora card, Mover flow,
Editar pasillo) and → Lista (table rows, filters sheet, bulk bar, Registro masivo sheet).
- [x] App chrome on phones (run 1: labels fit, tighter gaps, 38px Mapa/Lista; more height could be saved — see backlog): Vineyard/Winery bars + Vinos/Tanques/Barricas/Embotellado + Mapa/Lista eat ~40% of the screen
      before any barrel shows. Make it compact on phones (collapse, condense, sticky where it helps) without hiding anything.
- [x] Room map at 390px (run 1: tap areas 26–37px, selected outline, bigger numbers; rotation asked in Preguntas): barrel numbers/labels are tiny; make sections easier to hit (bigger hit areas, clearer selected state).
- [x] Front view at 390px (run 1: larger condensed type under barrels; swipe not needed for now): everything is scaled down to fit; check legibility of number, SO₂, wine line, "+N d" — consider a
      better minimum scale with horizontal swipe, or larger type, whichever reads better.
- [x] Barrel card (run 2: banner = due date, calmer SO₂/Relleno tiles, 2 tiles on phones, 36–44px controls, 16px fields; tab bar stays mid-card — see backlog): order of information (what must be seen first?), tile density, status line wording, tab bar reachable with
      the thumb, form fields 16px+ (no iOS zoom), clear save feedback.
- [ ] Mover / Poner barrica / Editar pasillo: is it obvious what to tap and how to cancel? Bottom bar legible and reachable.
- [x] Lista on phones (run 2: sort moved into Filtros, aligned rows, SO₂/📍 labels, 22px checkboxes; bulk bar checked, fine): row layout, what each row shows first, filter chips, bulk bar, selection of many rows quickly.
- [ ] Consistency: Spanish copy everywhere on these screens (some English remains), terms (Relleno/Rellenar, Vacía, Mover),
      date format, colours (one red, one yellow, one green), icon/button styles.
- [ ] Empty, loading and error states on these screens (slow 4G in the cellar).

## Night 2 — the rest of the app on the phone (UX/UI only) · status: proposed
Work orders (today list, Closed today, Canceladas, edit sheet, "Anotar resultados"), Vinos, Tanques, Embotellado, Labs,
Calendar, Audit, navigation between them, the chat bubble and zoom control overlapping content, header and footer.
Same checklist: hierarchy, tap targets, Spanish copy, one scroll, no overlaps, states.

## Night 3 — fewer taps for daily cellar work · proposal
Topping round and SO₂ round from the map (round mode: one date/person, tap barrels to mark), closing work orders from the
phone, quick re-check of yesterday's work. Prototype on staging only; Eric decides.

## Night 4 — cellar-practice research → proposals
Molecular SO₂ from pH + free SO₂ (house targets ~20 ppm free in barrel), topping/ullage tracking, barrel age and use count,
ánfora care (await maker's instructions), lab results flow (Uva y Vino). Written proposals with sources; small prototypes
behind a flag only if clearly useful.

## Night 5 — data quality · proposal
Duplicate wines, "Por confirmar" barrels, map vs list vs Excellovint consistency, audit view. Report + fixes that only
touch display; any data change is a proposal for Eric.

## Night 6 — speed and reliability · proposal
Load time on slow connections, caching, offline tolerance for the cellar, error messages, sync status that people trust.

## Night 7 — polish, accessibility, crew onboarding · proposal
Contrast, font sizes, screen readers, first-run help in Spanish for the crew, consistent icons. Final cleanup.

## Backlog (findings for later nights)
- Bottling: edit / add bottlings in Embotellado, and "embotellar este lote" (archive lot → bottling record). Eric asked for it.
- Barrel card: "Tinto" chip is the barrel's Tipo (use), not the wine — wording question for Eric (Preguntas).
- Barrel card (phone): tabs sit mid-card; a sticky tab row when the form scrolls would keep them under the thumb. Try on Night 2.
- SO₂ thresholds differ between card (low < 12, goal 20) and Lista (low < 10) — one rule once Eric confirms (consistency item).
- Lista (phone): a non-default sort is only visible from the group headers; maybe a small "Orden: Número ×" chip.
- Bottom nav labels are English (Wines, Protocols) — Night 2, waiting for Eric.
- Chrome: "Registrando como … cambiar" (inside the map frame) could sit on the Mapa/Lista row to save another ~24px.
- Room map rotated 90° on phones (~2.5× bigger) — waiting for Eric.
